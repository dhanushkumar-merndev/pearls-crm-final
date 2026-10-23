// public-form: the patient's own phone fills the registration form from the reception QR
// (PLAN.md D3). No login. Every request carries the QR token; a submit also needs a
// Cloudflare Turnstile pass. Only a hash of the caller's IP is kept, for rate limiting.
import { z } from "zod";

const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const text = (max: number) => z.string().trim().max(max).optional();

// The fields a patient may fill in themselves. Anything else is dropped.
export const payloadSchema = z.object({
  title: z.enum(["Mr", "Mrs", "Ms", "Miss", "Master", "Baby", "Dr"]).optional(),
  full_name: z.string().trim().min(1).max(120),
  gender: z.enum(["female", "male", "other", "unknown"]).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  age_years: z.number().int().min(0).max(120).optional(),
  phone_e164: phone,
  whatsapp_e164: phone.optional(),
  email: z.string().trim().email().max(200).optional(),
  address: text(500),
  area: text(120),
  city: text(80),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/).optional(),
  attender_name: text(120),
  attender_relation_id: z.string().uuid().optional(),
  attender_phone_e164: phone.optional(),
  blood_group: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  allergies: z.array(z.string().trim().max(80)).max(20).optional(),
  conditions: z.array(z.string().trim().max(80)).max(20).optional(),
  current_medicines: text(2000),
  previous_surgeries: text(2000),
  chief_complaints: text(2000),
  complaint_since: text(120),
  heard_from_id: z.string().uuid().optional(),
  referred_by_text: text(120),
  occupation: text(120),
  preferred_language: text(40),
  custom_fields: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  consents: z
    .object({
      treatment: z.object({ given: z.boolean() }).optional(),
      whatsapp: z.object({ given: z.boolean() }).optional(),
      marketing: z.object({ given: z.boolean() }).optional(),
    })
    .optional(),
});

export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("info"), token: z.string().min(16).max(128) }),
  z.object({
    action: z.literal("submit"),
    token: z.string().min(16).max(128),
    turnstile_token: z.string().min(1).max(4096),
    payload: payloadSchema,
  }),
]);

type RpcError = { message: string } | null;
export interface Deps {
  /** Service-role RPC (the public_form_* functions are callable by nobody else). */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  verifyTurnstile(token: string, ip: string | null): Promise<boolean>;
  hashIp(ip: string): Promise<string>;
}
export type Result = { status: number; body: Record<string, unknown> };

export async function publicForm(input: unknown, ip: string | null, deps: Deps): Promise<Result> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input", detail: parsed.error.issues[0]?.path.join(".") } };
  const req = parsed.data;

  if (req.action === "info") {
    const { data, error } = await deps.rpc<Record<string, unknown>>("public_form_info", { p_token: req.token });
    if (error) return { status: 500, body: { error: "unknown" } };
    return data?.valid ? { status: 200, body: data } : { status: 410, body: { error: "link_expired" } };
  }

  if (!(await deps.verifyTurnstile(req.turnstile_token, ip))) {
    return { status: 403, body: { error: "bot_check_failed" } };
  }
  const { error } = await deps.rpc("public_form_submit", {
    p_token: req.token,
    p_payload: req.payload,
    p_ip_hash: ip ? await deps.hashIp(ip) : null,
  });
  if (error) {
    const code = error.message;
    const status = code === "link_expired" ? 410 : code === "rate_limited" ? 429 : code === "invalid_input" ? 400 : 500;
    return { status, body: { error: status === 500 ? "unknown" : code } };
  }
  return { status: 200, body: { ok: true } };
}
