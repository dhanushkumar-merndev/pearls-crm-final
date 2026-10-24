import { z } from "zod";
import { rupeesToPaise } from "./money";
import { normalizePhone } from "./phone";

/**
 * Field rules every form uses (CLAUDE.md "Validate every input with zod"). Each message is
 * a key under `validation` in messages/en.json; `{max}` / `{min}` come from the issue.
 * Inputs are what form controls hold (strings, numbers, booleans, picked items); outputs
 * are what the RPCs take (trimmed text or null, E.164 phones, paise, ISO dates).
 * Postgres still enforces the real rules — these are for the person typing.
 */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** HSN (goods) and SAC (services) codes: 4 to 8 digits. */
export const HSN_SAC_PATTERN = /^[0-9]{4,8}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null / undefined → "", numbers → text, so a value straight from a table row can be checked. */
const asText = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v);

export function isIsoDate(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** Text that must be filled in: trimmed, 1..max characters. */
export const requiredText = (max = 200) =>
  z.preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }).max(max, { error: "tooLong" }));

/** A reason kept in the change history: at least a few words (3+ characters). */
export const requiredReason = (max = 300) =>
  z.preprocess(
    asText,
    z
      .string({ error: "required" })
      .trim()
      .min(1, { error: "required", abort: true })
      .min(3, { error: "reasonShort", abort: true })
      .max(max, { error: "tooLong" }),
  );

/** Text that may be left empty: trimmed, at most max characters; empty → null. */
export const optionalText = (max = 200) =>
  z.preprocess(asText, z.string({ error: "invalid" }).trim().max(max, { error: "tooLong" })).transform((v) => v || null);

/** Text kept as a string (empty allowed): rows printed as typed, e.g. a medicine's dose. */
export const trimmedText = (max = 200) =>
  z.preprocess(asText, z.string({ error: "invalid" }).trim().max(max, { error: "tooLong" }));

/** A phone number as people type it → E.164 ("+919845012345"). */
export const requiredPhone = () =>
  z
    .preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }))
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) {
        ctx.issues.push({ code: "custom", message: "phone", input: v });
        return z.NEVER;
      }
      return n.e164;
    });

/** Optional phone → E.164 or null. */
export const optionalPhone = () =>
  z.preprocess(asText, z.string({ error: "invalid" }).trim()).transform((v, ctx) => {
    if (!v) return null;
    const n = normalizePhone(v);
    if (!n) {
      ctx.issues.push({ code: "custom", message: "phone", input: v });
      return z.NEVER;
    }
    return n.e164;
  });

export const optionalEmail = (max = 200) =>
  z
    .preprocess(asText, z.string({ error: "invalid" }).trim().max(max, { error: "tooLong" }))
    .refine((v) => !v || EMAIL_PATTERN.test(v), { error: "email" })
    .transform((v) => v || null);

export const optionalPincode = () =>
  z
    .preprocess(asText, z.string({ error: "invalid" }).trim())
    .refine((v) => !v || PINCODE_PATTERN.test(v), { error: "pincode" })
    .transform((v) => v || null);

/** Optional code with a fixed shape (GSTIN, HSN/SAC). Spaces dropped; `upper` for GSTIN. */
export const optionalCode = (pattern: RegExp, message: string, upper = false) =>
  z
    .preprocess(asText, z.string({ error: "invalid" }))
    .transform((v) => (upper ? v.replace(/\s/g, "").toUpperCase() : v.replace(/\s/g, "")))
    .refine((v) => !v || pattern.test(v), { error: message })
    .transform((v) => v || null);

export const optionalUrl = (max = 300) =>
  z
    .preprocess(asText, z.string({ error: "invalid" }).trim().max(max, { error: "tooLong" }))
    .refine((v) => !v || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v), { error: "url" })
    .transform((v) => v || null);

/** "YYYY-MM-DD" from a date input. */
export const requiredDate = () =>
  z
    .preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }))
    .refine(isIsoDate, { error: "date" });

export const optionalDate = () =>
  z
    .preprocess(asText, z.string({ error: "invalid" }).trim())
    .refine((v) => !v || isIsoDate(v), { error: "date" })
    .transform((v) => v || null);

/** "YYYY-MM-DDTHH:mm" from a datetime-local input (read as IST by the caller). */
export const requiredDateTime = () =>
  z
    .preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }))
    .refine((v) => DATE_TIME_LOCAL.test(v) && isIsoDate(v.slice(0, 10)), { error: "dateTime" })
    .transform((v) => v.slice(0, 16));

export const optionalDateTime = () =>
  z
    .preprocess(asText, z.string({ error: "invalid" }).trim())
    .refine((v) => !v || (DATE_TIME_LOCAL.test(v) && isIsoDate(v.slice(0, 10))), { error: "dateTime" })
    .transform((v) => (v ? v.slice(0, 16) : null));

/** Empty → "required"; text that isn't a number (NaN) → "number". */
const numberError = (iss: { input?: unknown }) => (iss.input === undefined || iss.input === null ? "required" : "number");

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
/** "HH:MM" (24-hour) from a time input. */
export const requiredTime = () =>
  z
    .preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }))
    .refine((v) => TIME.test(v), { error: "time" })
    .transform((v) => v.slice(0, 5));

/** A whole number typed or picked (string or number) within [min, max]. */
export const requiredInt = (min: number, max: number) =>
  z
    .preprocess((v) => {
      const t = asText(v);
      return typeof t === "string" ? (t.trim() === "" ? undefined : Number(t.trim())) : t;
    }, z.number({ error: numberError }).refine(Number.isFinite, { error: "number", abort: true }).int({ error: "wholeNumber" }).min(min, { error: "min" }).max(max, { error: "max" }));

export const optionalInt = (min: number, max: number) =>
  z
    .preprocess((v) => {
      const t = asText(v);
      return typeof t === "string" ? (t.trim() === "" ? null : Number(t.trim())) : t;
    }, z.number({ error: "number" }).refine(Number.isFinite, { error: "number", abort: true }).int({ error: "wholeNumber" }).min(min, { error: "min" }).max(max, { error: "max" }).nullable());

/** A decimal number (e.g. a quantity of 2.5 strips) with at most `decimals` places. */
export const requiredDecimal = (min: number, max: number, decimals = 3) =>
  z.preprocess((v) => {
    const t = asText(v);
    return typeof t === "string" ? (t.trim() === "" ? undefined : Number(t.trim().replace(/,/g, ""))) : t;
  }, z
    .number({ error: numberError })
    .refine(Number.isFinite, { error: "number", abort: true })
    .refine((n) => Math.abs(Math.round(n * 10 ** decimals) - n * 10 ** decimals) < 1e-6, { error: "decimals", abort: true })
    .min(min, { error: "min" })
    .max(max, { error: "max" }));

export const optionalDecimal = (min: number, max: number, decimals = 3) =>
  z.preprocess((v) => {
    const t = asText(v);
    return typeof t === "string" ? (t.trim() === "" ? null : Number(t.trim().replace(/,/g, ""))) : t;
  }, z
    .number({ error: "number" })
    .refine(Number.isFinite, { error: "number", abort: true })
    .refine((n) => Math.abs(Math.round(n * 10 ** decimals) - n * 10 ** decimals) < 1e-6, { error: "decimals", abort: true })
    .min(min, { error: "min" })
    .max(max, { error: "max" })
    .nullable());

/** Paise from a MoneyInput (number | null). */
export const requiredPaise = (min = 0, max = 10_000_000_000) =>
  z
    .number({ error: "required" })
    .int({ error: "amount" })
    .min(min, { error: min > 0 ? "amountPositive" : "amount" })
    .max(max, { error: "amountTooLarge" });

export const optionalPaise = (max = 10_000_000_000) =>
  z.number({ error: "amount" }).int({ error: "amount" }).min(0, { error: "amount" }).max(max, { error: "amountTooLarge" }).nullable();

/** Rupees typed as text ("1,500.50") → paise. */
export const requiredRupees = (min = 0) =>
  z
    .preprocess(asText, z.string({ error: "required" }).trim().min(1, { error: "required", abort: true }))
    .transform((v, ctx) => {
      try {
        const paise = rupeesToPaise(v);
        if (paise < min) throw new Error("small");
        return paise;
      } catch {
        ctx.issues.push({ code: "custom", message: min > 0 ? "amountPositive" : "amount", input: v });
        return z.NEVER;
      }
    });

/** A required choice from a dropdown (value "" means nothing chosen). */
export function requiredChoice<T extends string>(values: readonly T[]): z.ZodType<T, unknown>;
export function requiredChoice(): z.ZodType<string, unknown>;
export function requiredChoice<T extends string>(values?: readonly T[]): z.ZodType<string, unknown> {
  const picked = z.preprocess(asText, z.string({ error: "choose" }).min(1, { error: "choose", abort: true }));
  return values ? picked.pipe(z.enum(values as unknown as [T, ...T[]], { error: "choose" })) : picked;
}

/** A record id picked from a list (uuid). */
export const requiredId = () =>
  z.preprocess(asText, z.string({ error: "choose" }).min(1, { error: "choose", abort: true }).regex(UUID, { error: "choose" }));

export const optionalId = () =>
  z
    .preprocess(asText, z.string({ error: "invalid" }))
    .refine((v) => !v || UUID.test(v), { error: "choose" })
    .transform((v) => v || null);

/** An item picked with the LibraryCombobox ({id, label, …} or null) → its id. */
export const requiredItem = () =>
  z
    .object({ id: z.string() }, { error: "choose" })
    .nullable()
    .refine((v) => v !== null, { error: "choose" })
    .transform((v) => v!.id);

export const optionalItem = () =>
  z
    .object({ id: z.string() }, { error: "choose" })
    .nullable()
    .optional()
    .transform((v) => v?.id ?? null);

/** Comma-separated whole numbers ("0, 14, 30") → [0, 14, 30]. */
export const intList = (max = 3650, maxItems = 50) =>
  z.preprocess(asText, z.string()).transform((v, ctx) => {
    const parts = v.split(/[,\s]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > max) || nums.length > maxItems) {
      ctx.issues.push({ code: "custom", message: "intList", input: v });
      return z.NEVER;
    }
    return nums;
  });

/** Comma-separated words ("Penicillin, Dust") → ["Penicillin", "Dust"], each ≤ maxEach. */
export const wordList = (maxEach = 80, maxItems = 20) =>
  z.preprocess(asText, z.string()).transform((v, ctx) => {
    const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length > maxItems || parts.some((p) => p.length > maxEach)) {
      ctx.issues.push({ code: "custom", message: "wordList", input: v });
      return z.NEVER;
    }
    return parts;
  });

/** One entry per line (addresses, phone lists, bill terms) → trimmed non-empty lines. */
export const lineList = (maxItems: number, maxEach: number) =>
  z.preprocess(asText, z.string()).transform((v, ctx) => {
    const lines = v.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > maxItems) {
      ctx.issues.push({ code: "too_big", origin: "array", maximum: maxItems, message: "tooMany", input: v } as never);
      return z.NEVER;
    }
    if (lines.some((l) => l.length > maxEach)) {
      ctx.issues.push({ code: "too_big", origin: "string", maximum: maxEach, message: "tooLong", input: v } as never);
      return z.NEVER;
    }
    return lines;
  });

/** Messages a form shows under its fields, by issue path ("items.0.qty" for nested rows). */
export function issuesByPath(error: z.ZodError): Map<string, z.core.$ZodIssue> {
  const found = new Map<string, z.core.$ZodIssue>();
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    if (!found.has(key)) found.set(key, issue);
  }
  return found;
}

/** Every key a validation message can use (kept in step with messages/en.json → validation). */
export const VALIDATION_MESSAGES = [
  "required", "tooLong", "invalid", "phone", "email", "pincode", "url", "date", "dateTime", "number", "wholeNumber",
  "decimals", "min", "max", "amount", "amountPositive", "amountTooLarge", "choose", "intList", "wordList",
  "dateOrder", "timeOrder", "notFuture", "notPast", "passwordShort", "passwordMismatch", "username", "age",
  "tooMany", "duplicateValue", "gst", "hsn", "gstin", "noRows", "server", "summary", "time", "reasonShort", "pickSlot", "rangeTooLong",
] as const;
