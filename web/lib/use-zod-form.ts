"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { z } from "zod";
import { issuesByPath } from "@pearl/shared";
import { asAppError } from "./rpc";

type Issue = z.core.$ZodIssue;

/** Falls back on the issue's kind when a schema forgot to name a message. */
const BY_CODE: Record<string, string> = {
  too_big: "tooLong",
  too_small: "required",
  invalid_type: "invalid",
  invalid_format: "invalid",
  invalid_value: "choose",
};

/**
 * One form's checks (CLAUDE.md "Validate every input with zod"):
 *  - `validate(values)` runs the schema before any request; on failure it shows each
 *    message under its field and moves focus to the first bad field (inside the open
 *    dialog if there is one, else on the page), and returns null.
 *  - `error(path)` → the translated message for a Field's `error` prop ("items.0.qty" for rows).
 *  - `clear(path)` when that field is edited.
 *  - `fromServer(err, fields)` puts a database "invalid_input: <detail>" under the field it
 *    names (detail → path via `fields`); returns false when it isn't about a field.
 * Schema messages are keys under `validation` (or a full "namespace.key").
 */
export function useZodForm<S extends z.ZodType>(schema: S) {
  const t = useTranslations();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const translate = useCallback(
    (issue: Pick<Issue, "message" | "code"> & { maximum?: unknown; minimum?: unknown }) => {
      const values = {
        max: typeof issue.maximum === "number" || typeof issue.maximum === "bigint" ? String(issue.maximum) : "",
        min: typeof issue.minimum === "number" || typeof issue.minimum === "bigint" ? String(issue.minimum) : "",
      };
      const key = issue.message.includes(".") ? issue.message : `validation.${issue.message}`;
      if (t.has(key)) return t(key, values);
      return t(`validation.${BY_CODE[issue.code] ?? "invalid"}`, values);
    },
    [t],
  );

  const focusFirst = useCallback(() => {
    // After React paints the messages (aria-invalid is set by Field from the error prop).
    // An open dialog holds the form being saved; otherwise it is on the page.
    requestAnimationFrame(() => {
      const bad =
        document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]') ??
        document.querySelector<HTMLElement>('[aria-invalid="true"]');
      bad?.focus();
      bad?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  const validate = useCallback(
    (values: unknown): z.output<S> | null => {
      const result = schema.safeParse(values);
      if (result.success) {
        setErrors({});
        return result.data;
      }
      const found: Record<string, string> = {};
      for (const [path, issue] of issuesByPath(result.error)) found[path] = translate(issue as Issue & { maximum?: unknown; minimum?: unknown });
      setErrors(found);
      focusFirst();
      return null;
    },
    [schema, translate, focusFirst],
  );

  const clear = useCallback((path: string) => {
    setErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const fromServer = useCallback(
    (err: unknown, fields: Record<string, string> = {}): boolean => {
      const e = asAppError(err);
      if (e.code !== "invalid_input" || !e.detail) return false;
      const path = fields[e.detail] ?? (e.detail in fields ? e.detail : undefined);
      if (!path) return false;
      setErrors((prev) => ({ ...prev, [path]: t("validation.server") }));
      focusFirst();
      return true;
    },
    [t, focusFirst],
  );

  return {
    errors,
    error: (path: string): string | undefined => errors[path],
    hasErrors: Object.keys(errors).length > 0,
    validate,
    clear,
    clearAll: () => setErrors({}),
    setError: (path: string, messageKey: string) => {
      setErrors((prev) => ({ ...prev, [path]: translate({ message: messageKey, code: "custom" }) }));
      focusFirst();
    },
    fromServer,
  };
}
