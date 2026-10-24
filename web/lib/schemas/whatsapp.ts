import { z } from "zod";
import { optionalText, requiredChoice, requiredId, requiredInt, requiredText } from "@pearl/shared";

/** Values that can fill a template's {{1}}, {{2}}… (private.wa_resolve_vars). */
export const WA_VARS = ["name", "first_name", "clinic_name", "clinic_phone", "appt_date", "appt_time", "doctor", "uhid", "treatment"] as const;
/** What the CRM sends a template for (one active template per purpose, except "other"). */
export const WA_PURPOSES = ["appointment_booked", "appointment_reminder", "lead_welcome", "followup", "other"] as const;
export const DRIP_TRIGGERS = ["manual", "lead_created", "consultation_done", "treatment_started", "treatment_completed", "discharged"] as const;
export const DRIP_AUDIENCES = ["patient", "lead"] as const;
/** Lead drips start by hand or when the lead comes in; the other events happen to patients. */
export const LEAD_TRIGGERS: readonly string[] = ["manual", "lead_created"];

/** Admin → WhatsApp → a template → wa_template_update. One value per {{n}} in its text. */
export const templateSchema = (paramCount: number) =>
  z.object({
    purpose: z.enum(["", ...WA_PURPOSES], { error: "choose" }).transform((v) => v || null),
    variable_map: z.array(requiredChoice(WA_VARS)).length(paramCount, { error: "choose" }),
    active: z.boolean(),
  });

// Steps are entered as "days and hours after the start" (Postgres keeps minutes, ≤ 365 days).
const dripStep = z.object({ template_id: requiredId(), days: requiredInt(0, 364), hours: requiredInt(0, 23) });

/** Admin → Drip campaigns → drip_campaign_save. */
export const dripCampaignSchema = z
  .object({
    name: requiredText(120),
    description: optionalText(500),
    trigger: requiredChoice(DRIP_TRIGGERS),
    audience: requiredChoice(DRIP_AUDIENCES),
    stop_on_reply: z.boolean(),
    stop_on_booking: z.boolean(),
    active: z.boolean(),
    steps: z.array(dripStep).min(1, { error: "drips.noSteps" }).max(50, { error: "tooMany" }),
  })
  .superRefine((d, ctx) => {
    if ((d.audience === "lead") !== LEAD_TRIGGERS.includes(d.trigger) && d.trigger !== "manual") {
      ctx.addIssue({ code: "custom", path: ["trigger"], message: "drips.triggerAudience", input: d.trigger });
    }
    let last = -1;
    d.steps.forEach((s, i) => {
      const at = s.days * 1440 + s.hours * 60;
      if (at < last) ctx.addIssue({ code: "custom", path: ["steps", i, "days"], message: "drips.stepOrder", input: s.days });
      last = Math.max(last, at);
    });
  })
  .transform(({ steps, ...d }) => ({
    ...d,
    steps: steps.map((s) => ({ template_id: s.template_id, offset_minutes: s.days * 1440 + s.hours * 60 })),
  }));

/** Patient / lead WhatsApp → wa_send with an approved template. */
export const waTemplateSendSchema = z.object({ template_id: requiredId() });
/** Free text (inside the 24-hour window) or the manual wa.me fallback. */
export const waTextSchema = z.object({ text: requiredText(4096) });
/** Add a patient or lead to a drip campaign. */
export const dripEnrollSchema = z.object({ campaign_id: requiredId() });
