import { z } from "zod";
import {
  optionalDateTime,
  optionalEmail,
  optionalId,
  optionalItem,
  optionalPaise,
  optionalPhone,
  optionalText,
  requiredChoice,
  requiredDate,
  requiredPhone,
  requiredText,
} from "./validation";

/** Lead stages in the order the sales team works them (PLAN.md C2; the lead_stage enum). */
export const LEAD_STAGES = [
  "new", "contacted", "interested", "consultation_booked", "consulted", "surgery_scheduled", "converted",
  "not_reachable", "lost", "junk",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const CALL_DIRECTIONS = ["outgoing", "incoming", "missed"] as const;
export const CALL_OUTCOMES = ["connected", "no_answer", "busy", "switched_off", "wrong_number", "call_back"] as const;

/** New lead (desk / sales manager). Name and mobile are required; the alternate must differ. */
export const newLeadSchema = z
  .object({
    name: requiredText(200),
    phone: requiredPhone(),
    alt_phone: optionalPhone(),
    email: optionalEmail(200),
    treatment: optionalItem(),
    treatment_text: optionalText(200),
    source: optionalItem(),
    referred_by_text: optionalText(200),
    comments1: optionalText(2000),
    due: optionalDateTime(),
    assigned_to: optionalId(),
  })
  .superRefine((d, ctx) => {
    if (d.alt_phone && d.alt_phone === d.phone) ctx.addIssue({ code: "custom", path: ["alt_phone"], message: "leads.altSameAsPhone" });
  });

/** Edit a lead on its page (update_lead patch). */
export const editLeadSchema = z
  .object({
    name: requiredText(200),
    phone: requiredPhone(),
    alt_phone: optionalPhone(),
    email: optionalEmail(200),
    treatment: optionalItem(),
    treatment_text: optionalText(200),
    source: optionalItem(),
    doctor: optionalItem(),
    referred_by_text: optionalText(200),
    appointment_mode: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(["offline", "online"], { error: "choose" }).nullable()),
    surgery_date: z.preprocess((v) => (v === "" || v === undefined ? null : v), requiredDate().nullable()),
    amount_quoted_paise: optionalPaise(),
    comments1: optionalText(2000),
    comments2: optionalText(2000),
  })
  .superRefine((d, ctx) => {
    if (d.alt_phone && d.alt_phone === d.phone) ctx.addIssue({ code: "custom", path: ["alt_phone"], message: "leads.altSameAsPhone" });
  });

/** Stage change: "Lost" needs a reason. */
export const leadStageSchema = z
  .object({ stage: requiredChoice(LEAD_STAGES), reason: optionalItem(), note: optionalText(4000) })
  .superRefine((d, ctx) => {
    if (d.stage === "lost" && !d.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "leads.needLostReason" });
  });

/** A call logged from the web (the phone app logs its own). */
export const logCallSchema = z.object({
  direction: requiredChoice(CALL_DIRECTIONS),
  outcome: requiredChoice(CALL_OUTCOMES),
  duration_min: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
    z.number({ error: "number" }).int({ error: "wholeNumber" }).min(0, { error: "min" }).max(600, { error: "max" }),
  ),
  notes: optionalText(2000),
  next_followup: optionalDateTime(),
});

/** Date range filters on sales tables: at most a year (the server refuses more). */
export const dateRangeSchema = z
  .object({ from: requiredDate(), to: requiredDate() })
  .superRefine((d, ctx) => {
    if (d.to < d.from) ctx.addIssue({ code: "custom", path: ["to"], message: "dateOrder" });
    else if ((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000 > 366) ctx.addIssue({ code: "custom", path: ["to"], message: "rangeTooLong" });
  });
