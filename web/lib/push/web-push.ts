// Pop-up notifications on this computer (Phase 20a): the browser's Firebase Cloud Messaging token is
// registered for the signed-in person (register_device … 'web'); push-send then delivers each bell
// notification to it and public/push-sw.js shows it. Same Firebase project as the phone. Turning it
// off, or signing out, forgets the token here and on the server (a shared reception computer must not
// show the previous person's notifications).
import { getSupabaseBrowser } from "@/lib/supabase/client";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey?: string;
}

/** The browser-safe Firebase web app keys (root .env → web/.env.local), or null when not set up. */
export function firebaseWebConfig(
  env: Record<string, string | undefined>,
): FirebaseWebConfig | null {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  if (!apiKey || !projectId || !messagingSenderId || !appId) return null;
  return {
    apiKey,
    projectId,
    messagingSenderId,
    appId,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    // Optional: Firebase uses its default Web Push key without one.
    vapidKey: env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || undefined,
  };
}

// Written out in full so Next.js puts the values into the browser bundle.
export const FIREBASE_WEB = firebaseWebConfig({
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
});

export const PUSH_SW_PATH = "/push-sw.js";
const TOKEN_KEY = "pearl.push.token";

/**
 * What this browser can do:
 * - off: not set up for the clinic (no Firebase web keys) — the switch is hidden
 * - unsupported: this browser can't (old browser, private window, an iPhone not added to the home screen)
 * - blocked: the person said "Block" — only the browser's site settings can undo it
 * - ask / on: the switch works; "on" when this browser has a token for the signed-in person
 */
export type PushState = "off" | "unsupported" | "blocked" | "ask" | "on";

export function pushState(input: {
  configured: boolean;
  supported: boolean;
  permission: NotificationPermission | null;
  hasToken: boolean;
}): PushState {
  if (!input.configured) return "off";
  if (!input.supported || input.permission === null) return "unsupported";
  if (input.permission === "denied") return "blocked";
  return input.permission === "granted" && input.hasToken ? "on" : "ask";
}

function savedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private window: the switch just shows "off" next time.
  }
}

function browserSupports(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** The state right now (no network). */
export function currentPushState(): PushState {
  const supported = browserSupports();
  return pushState({
    configured: FIREBASE_WEB !== null,
    supported,
    permission: supported ? Notification.permission : null,
    hasToken: supported && savedToken() !== null,
  });
}

async function messaging() {
  const [{ getApps, initializeApp }, msg] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!FIREBASE_WEB || !(await msg.isSupported())) throw new Error("push_unsupported");
  const { apiKey, authDomain, projectId, messagingSenderId, appId } = FIREBASE_WEB;
  const app =
    getApps().find((a) => a.name === "pearl-push") ??
    initializeApp({ apiKey, authDomain, projectId, messagingSenderId, appId }, "pearl-push");
  return { m: msg.getMessaging(app), msg };
}

/** Asks the browser, then registers this browser for the signed-in person. Returns the new state. */
export async function turnOnPush(): Promise<PushState> {
  if (!FIREBASE_WEB || !browserSupports()) return currentPushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return currentPushState();
  const registration = await navigator.serviceWorker.register(PUSH_SW_PATH, { scope: "/" });
  await navigator.serviceWorker.ready;
  const { m, msg } = await messaging();
  const token = await msg.getToken(m, {
    serviceWorkerRegistration: registration,
    ...(FIREBASE_WEB.vapidKey ? { vapidKey: FIREBASE_WEB.vapidKey } : {}),
  });
  if (!token) throw new Error("push_no_token");
  const { error } = await getSupabaseBrowser().rpc("register_device", {
    p_token: token,
    p_platform: "web",
    p_app_version: "web",
  });
  if (error) throw error;
  saveToken(token);
  return "on";
}

/** This browser stops popping up the signed-in person's notifications. Best effort, never throws. */
export async function turnOffPush(): Promise<PushState> {
  const token = savedToken();
  saveToken(null);
  if (token) {
    await Promise.allSettled([
      getSupabaseBrowser().rpc("unregister_device", { p_token: token }),
      messaging().then(({ m, msg }) => msg.deleteToken(m)),
    ]);
  }
  return currentPushState();
}

/** On sign-out: forget this browser before the session ends (at most 3 s, so sign-out never hangs). */
export async function forgetThisBrowser(): Promise<void> {
  if (!savedToken()) return;
  await Promise.race([turnOffPush(), new Promise((r) => setTimeout(r, 3000))]);
}
