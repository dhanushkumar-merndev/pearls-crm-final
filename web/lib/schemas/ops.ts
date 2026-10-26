import { z } from "zod";
import { BACKUP_PURPOSES, istDateString, optionalDate, PURGEABLE_PURPOSES, requiredDate } from "@pearl/shared";

const today = () => istDateString(new Date());

/** Backup centre → copy files: at least one kind; "stored before" is optional and not in the future. */
export const backupSchema = z.object({
  purposes: z.array(z.enum(BACKUP_PURPOSES, { error: "choose" })).min(1, { error: "choose" }),
  before: optionalDate().refine((d) => !d || d <= today(), { error: "notFuture" }),
});

/** Backup centre → free up space: heavy media only, stored before a date (required, not in the future). */
export const purgeSchema = z.object({
  purposes: z.array(z.enum(PURGEABLE_PURPOSES, { error: "choose" })).min(1, { error: "choose" }),
  before: requiredDate().refine((d) => d <= today(), { error: "notFuture" }),
});

/** Admin → Sales targets: a whole number, empty = no target. Amounts are typed in rupees. */
export const targetSchema = z.object({
  value: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), { error: "wholeNumber" }),
});
