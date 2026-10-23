/**
 * Stable error codes raised by RPC functions (`raise exception ... message = '<code>'`)
 * and Edge Functions. The UI translates each code (messages/en.json → "errors.<code>").
 * Add new codes here and in the translation file together.
 */
export const ERROR_CODES = [
  "not_allowed",
  "not_signed_in",
  "staff_inactive",
  "not_found",
  "invalid_input",
  "stale_version",
  "rate_limited",
  "series_below_used",
  "unknown_settings_section",
  "file_too_large",
  "file_type_not_allowed",
  "upload_incomplete",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function toErrorCode(value: unknown): ErrorCode | "unknown" {
  const message =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "message" in value
        ? String((value as { message: unknown }).message)
        : "";
  return (ERROR_CODES as readonly string[]).includes(message) ? (message as ErrorCode) : "unknown";
}
