import { z } from "zod";

/**
 * app_settings sections (PLAN.md C3). Each is checked against its schema before
 * saving; the database fills missing keys with the same defaults (private.setting).
 * Defaults are PLAN.md A2 — app behaviour, never clinic details.
 */
// Messages are keys under `validation` in messages/en.json (shown under the field).
const hhmm = z.string({ error: "time" }).regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { error: "time" });
const num = () => z.number({ error: (iss) => (iss.input === undefined ? "required" : "number") });
const int = (min: number, max: number) => num().int({ error: "wholeNumber" }).min(min, { error: "min" }).max(max, { error: "max" });
/** A chat-bot message: blank → null (the built-in text). */
const botText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, { error: "max" }).nullable())
    .default(null);

export const SETTINGS_SCHEMAS = {
  ui: z.object({ default_theme: z.enum(["dark", "light", "system"]).default("dark") }),
  security: z.object({ idle_logout_minutes: int(0, 240).default(15) }),
  appointments: z
    .object({
      slot_minutes: int(5, 240).default(15),
      capacity_per_slot: int(1, 50).default(3),
      day_start: hhmm.default("10:00"),
      day_end: hhmm.default("20:00"),
      working_days: z.array(int(1, 7)).min(1, { error: "choose" }).max(7).default([1, 2, 3, 4, 5, 6]),
      confirm_hours_before: int(0, 72).default(4),
      reminder_hours_before: int(0, 168).default(24),
      walk_in_queue: z.boolean().default(true),
    })
    .refine((v) => v.day_end > v.day_start, { path: ["day_end"], message: "timeOrder" }),
  billing: z.object({
    tax_inclusive: z.boolean().default(true),
    round_to_rupee: z.boolean().default(false),
    receptionist_max_discount_bp: int(0, 10000).default(2000),
    agreed_price_categories_exclude: z.array(z.string()).default(["pharmacy"]),
    ip_number_mode: z.enum(["separate", "uhid"]).default("separate"),
  }),
  pharmacy: z.object({
    near_expiry_days: z.array(int(1, 365)).min(1, { error: "required" }).max(5, { error: "tooMany" }).default([90, 60, 30]),
    negative_stock: z.enum(["block", "warn"]).default("block"),
    prices_include_gst: z.boolean().default(true),
  }),
  sales: z.object({
    round_robin: z.boolean().default(true),
    targets_enabled: z.boolean().default(false),
    reception_can_play_recordings: z.boolean().default(false),
    /** Call recordings: upload every matched call, or only when a manager asks (Request sync). Staff can override. */
    recording_upload_mode: z.enum(["sync_only", "all_calls"]).default("sync_only"),
    /** Only the first N minutes of a long call are uploaded (with a note that it was cut). */
    recording_max_minutes: int(1, 60).default(10),
    /** Meta Lead Ads: form question key → lead field (Admin → Meta leads). Standard questions need no entry. */
    meta_field_map: z
      .record(
        z.string().min(1).max(100),
        z.enum(["name", "phone", "alt_phone", "email", "treatment_text", "comments1", "comments2", "ignore"]),
      )
      .default({}),
  }),
  /** BDM field app (Phase 13). Times are IST. */
  bdm: z.object({
    require_selfie: z.boolean().default(true),
    heartbeat_minutes: int(1, 30).default(5),
    upload_minutes: int(1, 60).default(5),
    no_heartbeat_alert_minutes: int(5, 180).default(15),
    break_grace_minutes: int(0, 60).default(5),
    late_start_time: hhmm.default("10:30"),
    auto_end_time: hhmm.default("21:00"),
    /** Actual km more than this × the estimate flags the visit ("long route"). */
    long_route_factor: num().min(1, { error: "min" }).max(5, { error: "max" }).default(1.5),
  }),
  /** WhatsApp Cloud API (Phase 10). Automatic messages wait for `enabled` and approved templates. */
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    send_booking_confirmation: z.boolean().default(true),
    send_reminders: z.boolean().default(true),
    /** IST. Automatic messages wait until quiet_end; the same time twice = no quiet hours. */
    quiet_start: hhmm.default("21:00"),
    quiet_end: hhmm.default("09:00"),
    /** Estimated cost per message, shown on the WhatsApp page (Meta bills the real amount). */
    cost_utility_paise: int(0, 100000).default(12),
    cost_marketing_paise: int(0, 100000).default(88),
    /** Sent once after someone writes STOP. Empty = the built-in text. */
    stop_reply: z.string().trim().max(1000, { error: "max" }).nullable().default(null),
  }),
  /**
   * WhatsApp chat bot (Admin → WhatsApp → Chat bot). Texts: empty = the built-in English one;
   * {clinic} {brochure} {website} {name} {phone} {products} {location} are filled in. Treatments: 30
   * characters and 20 items at most (Meta's tick-box limits). flow_id / flow_draft_id are set by
   * "Set up tick-box form" (wa-templates-sync), not typed.
   */
  wa_bot: z
    .object({
      enabled: z.boolean().default(false),
      brochure_url: z
        .url({ protocol: /^https$/, error: "url" })
        .max(500, { error: "max" })
        .nullable()
        .default(null),
      website_url: z
        .url({ protocol: /^https$/, error: "url" })
        .max(500, { error: "max" })
        .nullable()
        .default(null),
      products: z
        .array(z.string().trim().min(1, { error: "required" }).max(30, { error: "max" }))
        .max(20, { error: "tooMany" })
        .refine((list) => new Set(list.map((p) => p.toLowerCase())).size === list.length, { error: "duplicateValue" })
        .default([]),
      daily_chat_limit: int(1, 50).default(5),
      intro_text: botText(1000),
      name_text: botText(500),
      products_text: botText(500),
      location_text: botText(500),
      summary_text: botText(900),
      done_text: botText(500),
      cancelled_text: botText(500),
      sorry_text: botText(200),
      media_text: botText(300),
      form_button: botText(30),
      confirm_button: botText(20),
      cancel_button: botText(20),
      flow_id: z.string().regex(/^[0-9]{5,30}$/).nullable().default(null),
      flow_draft_id: z.string().regex(/^[0-9]{5,30}$/).nullable().default(null),
    })
    .refine((v) => !v.enabled || v.products.length > 0, { path: ["products"], error: "botNeedsProducts" }),
  notifications: z.object({
    daily_summary_enabled: z.boolean().default(true),
    daily_summary_time: hhmm.default("20:00"),
    /** Besides every admin with an email address (Admin → Users). */
    extra_recipients: z.array(z.email({ error: "email" })).max(5, { error: "tooMany" }).default([]),
  }),
  /** What the storage meter measures against (PLAN.md F2 free tiers; raise after upgrading). */
  storage: z.object({
    db_limit_mb: int(100, 1_000_000).default(500),
    files_limit_gb: int(1, 100_000).default(5),
    monthly_writes_limit: int(1000, 100_000_000).default(10000),
    /** Monday 10:00 IST: remind the admins when the last full export is a week old. */
    backup_reminder: z.boolean().default(true),
  }),
} as const;

export type SettingsSection = keyof typeof SETTINGS_SCHEMAS;
export type Settings<S extends SettingsSection> = z.output<(typeof SETTINGS_SCHEMAS)[S]>;

/** Stored JSON (possibly old or partial) → full settings with defaults filled in. */
export function readSettings<S extends SettingsSection>(section: S, stored: unknown): Settings<S> {
  const schema = SETTINGS_SCHEMAS[section] as unknown as z.ZodType<Settings<S>>;
  const parsed = schema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : (schema.parse({}) as Settings<S>);
}

/** Validates a section before saving. Returns the clean value or the first problem's field. */
export function validateSettings<S extends SettingsSection>(
  section: S,
  value: unknown,
): { ok: true; value: Settings<S> } | { ok: false; field: string } {
  const parsed = (SETTINGS_SCHEMAS[section] as unknown as z.ZodType<Settings<S>>).safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, field: parsed.error.issues[0]?.path.join(".") ?? "" };
}
