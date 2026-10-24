import { z } from "zod";
import {
  GSTIN_PATTERN,
  lineList,
  newPasswordRule,
  optionalPhone,
  requiredChoice,
  requiredInt,
  STAFF_ROLES,
  trimmedText,
  USERNAME_PATTERN,
  optionalCode,
  optionalEmail,
  optionalPincode,
  optionalText,
  optionalUrl,
  requiredText,
} from "@pearl/shared";

export const BILL_TYPES = ["procedure_receipt", "pharmacy_invoice", "final_bill"] as const;

const digits = (v: string) => v.replace(/\D/g, "").length;

/** Admin → Clinic profile → save_clinic_profile. The same limits the clinic_settings checks hold. */
export const clinicProfileSchema = z
  .object({
    name: requiredText(200),
    legal_name: optionalText(200),
    gstin: optionalCode(GSTIN_PATTERN, "gstin", true),
    llpin: optionalText(20),
    address: lineList(6, 200),
    city: optionalText(80),
    state: optionalText(80),
    state_code: optionalCode(/^[0-9]{2}$/, "clinic.badStateCode"),
    pincode: optionalPincode(),
    phones: lineList(5, 40).refine((list) => list.every((p) => digits(p) >= 8 && digits(p) <= 15), { error: "phone" }),
    email: optionalEmail(200),
    website: optionalUrl(300),
    letterhead_qr_url: optionalUrl(300),
    signatory_label: requiredText(60),
    logo_path: z.string().nullable(),
    terms: z.object(Object.fromEntries(BILL_TYPES.map((b) => [b, lineList(30, 500)])) as Record<(typeof BILL_TYPES)[number], ReturnType<typeof lineList>>),
  })
  .transform(({ address, ...rest }) => ({ ...rest, address_lines: address }));

const username = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string({ error: "required" }).min(1, { error: "required", abort: true }).regex(USERNAME_PATTERN, { error: "username" }),
  );

/** Admin → Users → Add: the admin-users Edge Function's "create" request. */
export const createStaffSchema = z
  .object({
    full_name: requiredText(120),
    role: requiredChoice(STAFF_ROLES),
    username: username(),
    email: optionalEmail(200),
    phone: optionalPhone(),
    password: newPasswordRule(),
  })
  .transform((d) => ({
    action: "create" as const,
    full_name: d.full_name,
    role: d.role,
    username: d.username,
    ...(d.email ? { email: d.email.toLowerCase() } : {}),
    ...(d.phone ? { phone_e164: d.phone } : {}),
    password: d.password,
  }));

export const editStaffSchema = z.object({
  full_name: requiredText(120),
  role: requiredChoice(STAFF_ROLES),
  phone: optionalPhone(),
  bdm_start_anywhere: z.boolean(),
  reason: optionalText(300),
});

export const setPasswordSchema = z.object({ password: newPasswordRule() });

export const deactivateSchema = z.object({
  reason: requiredText(300).refine((v) => v.length >= 3, { error: "users.reasonNeeded" }),
});

/** Admin → Settings → Bill and patient numbers. The next number can't go back below one already used. */
export const numberSeriesSchema = (minNext: number) =>
  z.object({
    prefix: trimmedText(20),
    format: requiredText(60).refine((v) => v.includes("{n}"), { error: "settings.series.formatNeedsN" }),
    next_value: requiredInt(Math.max(1, minNext), 1_000_000_000),
    padding: requiredInt(0, 10),
  });
