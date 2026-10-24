import { z } from "zod";
import {
  fromIstDateTimeLocal,
  intList,
  istDateString,
  optionalDateTime,
  optionalId,
  optionalInt,
  optionalItem,
  optionalPaise,
  optionalText,
  requiredChoice,
  requiredDate,
  requiredDateTime,
  requiredInt,
  requiredItem,
  requiredPaise,
  requiredReason,
  requiredText,
  requiredTime,
  trimmedText,
  wordList,
} from "@pearl/shared";

/** A date that can't be before today (IST). */
export const todayOrLater = () => requiredDate().refine((d) => d >= istDateString(new Date()), { error: "notPast" });

/** One discharge-summary / template section: a heading is needed; the text may use {{placeholders}}. */
export const sectionSchema = z.object({
  key: z.string(),
  title: requiredText(120),
  body: trimmedText(5000),
});

/** One medicine on discharge; only the name is required. */
export const medicationSchema = z.object({
  name: requiredText(120),
  dose: trimmedText(120),
  frequency: trimmedText(120),
  duration: trimmedText(120),
  instructions: trimmedText(200),
  pharmacy_item_id: z.string().nullish(),
});

/** Admin → Discharge templates → Edit. */
export const dischargeTemplateSchema = z.object({
  name: requiredText(200),
  follow_up_days: optionalInt(0, 3650),
  sections: z.array(sectionSchema).max(40, { error: "tooMany" }),
  medications: z.array(medicationSchema).max(50, { error: "tooMany" }),
});

/** Admin → Doctors → Hours: one weekly block. End after start; blank slot/capacity = defaults. */
export const doctorHoursSchema = z
  .object({
    weekday: requiredInt(1, 7),
    start: requiredTime(),
    end: requiredTime(),
    slot: optionalInt(5, 240),
    capacity: optionalInt(1, 50),
  })
  .refine((d) => d.end > d.start, { path: ["end"], error: "timeOrder" });

/** A doctor's leave: whole days, last day on or after the first. */
export const doctorLeaveSchema = z
  .object({
    from: requiredDate(),
    to: requiredDate(),
    reason: optionalText(300),
  })
  .refine((d) => d.to >= d.from, { path: ["to"], error: "dateOrder" });

/** New follow-up / task for a patient. */
export const followupSchema = z.object({
  patient: requiredItem(),
  due: todayOrLater(),
  reason: requiredText(500),
});

/** Closing a follow-up: what happened (optional). */
export const followupOutcomeSchema = z.object({ outcome: optionalText(500) });

const gapList = () => intList(3650, 100).refine((list) => list.length > 0, { error: "intList" });

/** Patient → Treatments → Start. */
export const startTreatmentSchema = z.object({
  template: optionalItem(),
  name: requiredText(200),
  doctor: optionalItem(),
  start: requiredDate(),
  sessions: requiredInt(1, 100),
  gaps: gapList(),
  pricing: requiredChoice(["package", "per_session"] as const),
  price: requiredPaise(),
  agreed: optionalPaise(),
  notes: optionalText(4000),
});

export const TREATMENT_STATUSES = ["active", "on_hold", "completed", "closed", "cancelled"] as const;

/**
 * Edit a treatment. A price change, or closing / cancelling it, needs a reason (kept in the
 * audit trail), as the database insists.
 */
export const editTreatmentSchema = (before: { package_price_paise: number | null; agreed_price_paise: number | null; status: string }) =>
  z
    .object({
      name: requiredText(200),
      doctor: optionalItem(),
      gaps: gapList(),
      price: requiredPaise(),
      agreed: optionalPaise(),
      status: requiredChoice(TREATMENT_STATUSES),
      reason: optionalText(300),
      notes: optionalText(4000),
    })
    .superRefine((d, ctx) => {
      const priceChanged = d.price !== (before.package_price_paise ?? 0) || d.agreed !== before.agreed_price_paise;
      const closing = (d.status === "closed" || d.status === "cancelled") && d.status !== before.status;
      if ((priceChanged || closing) && (d.reason ?? "").length < 3) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "treatments.reasonNeeded" });
      }
    });

export const removeSessionSchema = z.object({ reason: requiredReason(300) });

const SURGEON_ROLES = ["primary", "assistant", "visiting"] as const;
const digits = (v: string) => v.replace(/\D/g, "").length;

/**
 * Admit / edit a stay. Times are datetime-local text (IST). Surgery can't be before admission;
 * a doctor is listed once; after discharge an edit needs a reason.
 */
export const admissionSchema = (afterDischarge: boolean) =>
  z
    .object({
      patient: requiredItem(),
      admitted_at: requiredDateTime(),
      treatment: optionalId(),
      room: optionalItem(),
      room_label: optionalText(60),
      procedures: wordList(200, 20),
      diagnosis: optionalText(500),
      anaesthesia: optionalText(120),
      surgery_at: optionalDateTime(),
      attender_name: optionalText(120),
      attender_phone: optionalText(40).refine((v) => !v || (digits(v) >= 8 && digits(v) <= 15), { error: "phone" }),
      attender_relation: optionalText(40),
      surgeons: z.array(z.object({ doctor: optionalItem(), role: requiredChoice(SURGEON_ROLES) })).max(10, { error: "tooMany" }),
      reason: afterDischarge ? requiredReason(300) : optionalText(300),
    })
    .superRefine((d, ctx) => {
      if (d.surgery_at && d.surgery_at < d.admitted_at) {
        ctx.addIssue({ code: "custom", path: ["surgery_at"], message: "ip.surgeryBeforeAdmission" });
      }
      const seen = new Set<string>();
      d.surgeons.forEach((s, i) => {
        if (!s.doctor) return;
        if (seen.has(s.doctor)) ctx.addIssue({ code: "custom", path: ["surgeons", i, "doctor"], message: "duplicateValue" });
        seen.add(s.doctor);
      });
    });

/** Discharge time: after admission, not in the future (a few minutes' clock difference allowed). */
export const dischargeSchema = (admittedAtIso: string) =>
  z.object({ at: requiredDateTime() }).superRefine((d, ctx) => {
    const iso = fromIstDateTimeLocal(d.at);
    if (!iso) return;
    if (iso < admittedAtIso) ctx.addIssue({ code: "custom", path: ["at"], message: "ip.dischargeBeforeAdmission" });
    else if (new Date(iso).getTime() > Date.now() + 10 * 60_000) ctx.addIssue({ code: "custom", path: ["at"], message: "notFuture" });
  });

export const reasonSchema = z.object({ reason: requiredReason(300) });

/** A discharge summary's editable content, checked before finalize / amend (drafts autosave as typed). */
export const summaryContentSchema = z.object({
  sections: z.array(sectionSchema).min(1, { error: "noRows" }).max(40, { error: "tooMany" }),
  medications: z.array(medicationSchema).max(50, { error: "tooMany" }),
  follow_up_days: optionalInt(0, 3650),
  follow_up_note: trimmedText(500),
  doctor_id: z.string({ error: "discharge.needSigner" }).min(1, { error: "discharge.needSigner" }),
});

export const summaryAmendSchema = summaryContentSchema.extend({ reason: requiredReason(300) });

/** "Save as template": a new one needs a name; replacing an existing one may keep its name. */
export const saveTemplateSchema = z
  .object({ target: optionalId(), name: optionalText(200) })
  .superRefine((d, ctx) => {
    if (!d.target && !d.name) ctx.addIssue({ code: "custom", path: ["name"], message: "required" });
  });

/** Merge this patient into another (admin): who and why. */
export const mergePatientSchema = z.object({ into: requiredItem(), reason: requiredReason(300) });

/** Link a relative to the family. */
export const linkRelativeSchema = z.object({ relative: requiredItem() });

/** Scanned / uploaded document: title (optional, defaults to the kind), date not in the future. */
export const documentSchema = z.object({
  title: optionalText(200),
  date: requiredDate().refine((d) => d <= istDateString(new Date()), { error: "notFuture" }),
});
