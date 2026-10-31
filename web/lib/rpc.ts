import { toErrorCode, type ErrorCode } from "@pearl/shared";
import { getSupabaseBrowser } from "./supabase/client";

/** An RPC or table error, carrying the stable code the UI translates (errors.<code>). */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode | "unknown",
    public readonly detail?: string,
    /** The browser got no answer at all (offline, or this web address isn't allowed to call the function). */
    public readonly unreachable = false,
  ) {
    super(code);
  }
}

/** The server's own words for an error the app has no message for (shown after "Something went wrong"). */
function rawReason(error: unknown): string {
  if (!error || typeof error !== "object") return error ? String(error) : "";
  const e = error as { message?: unknown; code?: unknown; details?: unknown };
  return [e.message, e.details, e.code].filter((x) => x !== undefined && x !== null && String(x) !== "").map(String).join(" · ");
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = toErrorCode(error);
  const detail =
    code === "unknown"
      ? rawReason(error)
      : error && typeof error === "object" && "details" in error
        ? String((error as { details: unknown }).details ?? "")
        : "";
  return new AppError(code, detail || undefined);
}

/** Calls a Postgres function as the signed-in user; throws AppError on failure. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowser().rpc(fn, args);
  if (error) throw asAppError(error);
  return data as T;
}

/** Throws AppError if a supabase-js table call failed; returns its data otherwise. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw asAppError(result.error);
  return result.data as T;
}

/** Calls an Edge Function with the user's login token; throws AppError on failure. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowser().functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError keeps the response; our functions answer { error: "<code>" }.
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const text = await context.text().catch(() => "");
      const payload = parseJson(text) as { error?: string; detail?: string; message?: string } | null;
      if (payload?.error) {
        const code = toErrorCode(payload.error);
        // An error code the app doesn't know: keep the function's own words for the message.
        throw new AppError(code, code === "unknown" ? [payload.error, payload.detail].filter(Boolean).join(" · ") : payload.detail);
      }
      throw new AppError("unknown", `${name}: HTTP ${context.status}${payload?.message ? ` · ${payload.message}` : text ? ` · ${text.slice(0, 200)}` : ""}`);
    }
    // No answer at all (offline, blocked, the function not deployed…).
    throw new AppError("unknown", `${name}: ${(error as { message?: string }).message ?? "no answer"}`, true);
  }
  return data as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
