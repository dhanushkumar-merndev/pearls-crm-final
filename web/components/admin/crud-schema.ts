import { z } from "zod";
import {
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  HSN_SAC_PATTERN,
  intList,
  optionalCode,
  optionalDate,
  optionalDecimal,
  optionalEmail,
  optionalInt,
  optionalItem,
  optionalPaise,
  optionalPhone,
  optionalText,
  optionalUrl,
  requiredChoice,
  requiredDate,
  requiredDecimal,
  requiredInt,
  requiredPaise,
  requiredText,
} from "@pearl/shared";
import type { LibraryKind } from "@/components/library-combobox";

export type FieldDef =
  | {
      key: string;
      label: string;
      type: "text" | "textarea" | "email" | "url" | "tel";
      required?: boolean;
      maxLength?: number;
      hint?: string;
      /** A fixed shape the database also checks: HSN/SAC codes, GSTIN. */
      format?: "hsn_sac" | "gstin";
    }
  | { key: string; label: string; type: "number"; required?: boolean; min?: number; max?: number; step?: number; hint?: string }
  | { key: string; label: string; type: "money"; required?: boolean; hint?: string }
  | { key: string; label: string; type: "gst"; hint?: string }
  | { key: string; label: string; type: "boolean"; hint?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; hint?: string }
  | { key: string; label: string; type: "int_list"; hint?: string }
  | { key: string; label: string; type: "date"; required?: boolean; hint?: string }
  /** A foreign key picked with the LibraryCombobox; labelPath reads the joined label for editing. */
  | { key: string; label: string; type: "lookup"; kind: LibraryKind; labelPath: string; hint?: string };

/** The zod schema for a config's form: the same limits the table's CHECK constraints hold. */
export function crudSchema(config: { fields: FieldDef[]; hasActive?: boolean }) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of config.fields) {
    switch (f.type) {
      case "text":
      case "textarea": {
        const max = f.maxLength ?? (f.type === "textarea" ? 2000 : 200);
        if (f.format === "hsn_sac") shape[f.key] = optionalCode(HSN_SAC_PATTERN, "hsn");
        else if (f.format === "gstin") shape[f.key] = optionalCode(GSTIN_PATTERN, "gstin", true);
        else shape[f.key] = f.required ? requiredText(max) : optionalText(max);
        break;
      }
      case "email":
        shape[f.key] = f.required
          ? requiredText(f.maxLength ?? 200).refine((v) => EMAIL_PATTERN.test(v), { error: "email" })
          : optionalEmail(f.maxLength ?? 200);
        break;
      case "url":
        shape[f.key] = optionalUrl(f.maxLength ?? 300);
        break;
      case "tel":
        // Stored as typed (some suppliers give landlines with extensions); must still look like a number.
        shape[f.key] = f.required ? requiredText(f.maxLength ?? 40) : optionalText(f.maxLength ?? 40);
        shape[f.key] = shape[f.key]!.refine((v) => !v || optionalPhone().safeParse(v).success, { error: "phone" });
        break;
      case "number": {
        const min = f.min ?? 0;
        const max = f.max ?? 1_000_000;
        const decimals = f.step !== undefined && f.step < 1;
        shape[f.key] = decimals
          ? f.required
            ? requiredDecimal(min, max)
            : optionalDecimal(min, max)
          : f.required
            ? requiredInt(min, max)
            : optionalInt(min, max);
        break;
      }
      case "money":
        shape[f.key] = f.required ? requiredPaise() : optionalPaise();
        break;
      case "gst":
        shape[f.key] = z.number({ error: "gst" }).int().min(0).max(4000);
        break;
      case "boolean":
        shape[f.key] = z.boolean();
        break;
      case "select":
        shape[f.key] = f.required
          ? requiredChoice(f.options.map((o) => o.value))
          : z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(f.options.map((o) => o.value) as [string, ...string[]], { error: "choose" }).nullable());
        break;
      case "int_list":
        shape[f.key] = intList().transform((list) => (list.length ? list : [0]));
        break;
      case "date":
        shape[f.key] = f.required ? requiredDate() : optionalDate();
        break;
      case "lookup":
        shape[f.key] = optionalItem();
        break;
    }
  }
  if (config.hasActive) shape.active = z.boolean();
  return z.object(shape);
}

