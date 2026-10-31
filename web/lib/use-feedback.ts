"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { asAppError } from "./rpc";

/** Toasts for saves: "Saved ✓" and translated error messages. */
export function useFeedback() {
  const t = useTranslations();
  const errorMessage = useCallback((error: unknown) => {
    const e = asAppError(error);
    if (e.unreachable) return t("errors.unreachable", { detail: e.detail ?? "" });
    // Nothing translated for it: say what the server said instead of only "Something went wrong".
    return e.code === "unknown" && e.detail ? t("errors.unknownWithDetail", { detail: e.detail }) : t(`errors.${e.code}`);
  }, [t]);
  const saved = useCallback((message?: string) => toast.success(message ?? t("common.saved")), [t]);
  const failed = useCallback((error: unknown) => toast.error(errorMessage(error)), [errorMessage]);
  return { saved, failed, errorMessage };
}
