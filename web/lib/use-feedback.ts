"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { asAppError } from "./rpc";

/** Toasts for saves: "Saved ✓" and translated error messages. */
export function useFeedback() {
  const t = useTranslations();
  const errorMessage = useCallback((error: unknown) => t(`errors.${asAppError(error).code}`), [t]);
  const saved = useCallback((message?: string) => toast.success(message ?? t("common.saved")), [t]);
  const failed = useCallback((error: unknown) => toast.error(errorMessage(error)), [errorMessage]);
  return { saved, failed, errorMessage };
}
