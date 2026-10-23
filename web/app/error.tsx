"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { reportClientError } from "@/components/client-error-reporter";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations();
  useEffect(() => {
    reportClientError(error.message, error.stack);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("errors.title")}</h1>
      <p className="text-text-secondary">{t("errors.body")}</p>
      <Button onClick={reset}>
        <RefreshCw aria-hidden />
        {t("actions.tryAgain")}
      </Button>
    </main>
  );
}
