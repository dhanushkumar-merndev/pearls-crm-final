import { toErrorCode, type ErrorCode } from "@pearl/shared";
import { getSupabaseBrowser } from "./supabase/client";

/** An RPC or table error, carrying the stable code the UI translates (errors.<code>). */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode | "unknown",
    public readonly detail?: string,
  ) {
    super(code);
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const detail =
    error && typeof error === "object" && "details" in error ? String((error as { details: unknown }).details ?? "") : "";
  return new AppError(toErrorCode(error), detail || undefined);
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
      const payload = (await context.json().catch(() => null)) as { error?: string; detail?: string } | null;
      if (payload?.error) throw new AppError(toErrorCode(payload.error), payload.detail);
    }
    throw new AppError("unknown");
  }
  return data as T;
}

export function newId(): string {
  return crypto.randomUUID();
}
