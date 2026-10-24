"use client";

import { useTranslations } from "next-intl";
import { dateRangeSchema } from "@pearl/shared";

/**
 * Checks a list screen's From / To filter as it changes (CLAUDE.md validation rule): to on or
 * after from, at most a year apart (the server refuses more). While it's wrong the screen shows
 * the message under the field and doesn't query.
 */
export function useDateRangeCheck(from: string, to: string) {
  const t = useTranslations("validation");
  const parsed = dateRangeSchema.safeParse({ from, to });
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "to");
      errors[key] ??= t.has(issue.message) ? t(issue.message) : t("date");
    }
  }
  return { valid: parsed.success, fromError: errors.from, toError: errors.to };
}
