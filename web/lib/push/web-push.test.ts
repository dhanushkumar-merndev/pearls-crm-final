import { describe, expect, it } from "vitest";
import { firebaseWebConfig, pushState } from "./web-push";

const keys = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIza-test",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-project",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc",
};

describe("firebaseWebConfig", () => {
  it("reads the web app keys (auth domain and Web Push key optional)", () => {
    expect(firebaseWebConfig(keys)).toEqual({
      apiKey: "AIza-test",
      projectId: "demo-project",
      messagingSenderId: "123",
      appId: "1:123:web:abc",
      authDomain: undefined,
      vapidKey: undefined,
    });
    expect(firebaseWebConfig({ ...keys, NEXT_PUBLIC_FIREBASE_VAPID_KEY: " BKey " })?.vapidKey).toBe(
      "BKey",
    );
  });

  it("is null (pop-ups hidden) when any required key is missing or blank", () => {
    for (const k of Object.keys(keys)) {
      expect(firebaseWebConfig({ ...keys, [k]: undefined })).toBeNull();
      expect(firebaseWebConfig({ ...keys, [k]: "  " })).toBeNull();
    }
  });
});

describe("pushState", () => {
  const base = {
    configured: true,
    supported: true,
    permission: "default" as NotificationPermission,
    hasToken: false,
  };
  it("hides the switch when the clinic hasn't set it up", () => {
    expect(pushState({ ...base, configured: false })).toBe("off");
  });
  it("says when the browser can't, or the person blocked it", () => {
    expect(pushState({ ...base, supported: false, permission: null })).toBe("unsupported");
    expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
  });
  it("is on only with permission and a registered token", () => {
    expect(pushState(base)).toBe("ask");
    expect(pushState({ ...base, permission: "granted" })).toBe("ask");
    expect(pushState({ ...base, permission: "granted", hasToken: true })).toBe("on");
  });
});
