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
  "merge_conflict",
  "overlap",
  "duplicate",
  "in_use",
  "link_expired",
  "slot_full",
  "doctor_on_leave",
  "holiday",
  "outside_schedule",
  "slot_in_past",
  "invalid_status_change",
  "reason_required",
  "invalid_quantity",
  "discount_exceeds_gross",
  "below_agreed_price",
  "over_allocated",
  "bill_locked",
  "discount_limit",
  "stock_insufficient",
  "expired_batch",
  "batch_required",
  "already_in_final_bill",
  "not_discharged",
  "dates_invalid",
  "surgeon_required",
  "placeholders_left",
  // Phase 8: scanning
  "link_used",
  "too_many_pages",
  "heic_not_supported",
  "file_unreadable",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Postgres errors that reach the app from direct table writes (admin master data).
 * RPCs raise our own codes instead.
 */
const SQLSTATE_CODES: Record<string, ErrorCode> = {
  "23P01": "overlap", // exclusion constraint, e.g. overlapping doctor hours or leaves
  "23505": "duplicate", // unique constraint
  "23503": "in_use", // foreign key: something still points at this row
  "23514": "invalid_input", // check constraint
  "22P02": "invalid_input", // bad text for a number/uuid
  "42501": "not_allowed", // RLS or missing privilege
};

export function toErrorCode(value: unknown): ErrorCode | "unknown" {
  if (!value) return "unknown";
  if (typeof value === "object") {
    const code = "code" in value ? String((value as { code: unknown }).code) : "";
    const message = "message" in value ? String((value as { message: unknown }).message) : "";
    if ((ERROR_CODES as readonly string[]).includes(message)) return message as ErrorCode;
    if (code === "P0001") return "unknown";
    return SQLSTATE_CODES[code] ?? "unknown";
  }
  const message = String(value);
  return (ERROR_CODES as readonly string[]).includes(message) ? (message as ErrorCode) : "unknown";
}
