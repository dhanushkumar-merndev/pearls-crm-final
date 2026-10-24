import { z } from "zod";
import { optionalItem, optionalText, requiredChoice, requiredDate, requiredItem, requiredReason } from "@pearl/shared";

export const APPT_TYPES = ["consultation", "session", "procedure", "surgery", "follow_up", "review"] as const;

const slot = () => z.string({ error: "pickSlot" }).min(1, { error: "pickSlot" });

/** Book: a patient (or a lead), doctor, day, a free slot and the visit type. The database checks capacity. */
export const bookSchema = z.object({
  who: requiredItem(),
  doctor: requiredItem(),
  date: requiredDate(),
  slot: slot(),
  type: requiredChoice(APPT_TYPES),
  notes: optionalText(1000),
  confirm: z.boolean(),
});

export const walkInSchema = z.object({
  patient: requiredItem(),
  doctor: optionalItem(),
  notes: optionalText(1000),
});

export const cancelSchema = z.object({ reason: requiredReason(300) });

export const rescheduleSchema = z.object({
  doctor: requiredItem(),
  date: requiredDate(),
  slot: slot(),
  reason: optionalText(300),
});
