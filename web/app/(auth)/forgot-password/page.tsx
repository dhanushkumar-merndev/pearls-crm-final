import { ArrowLeft, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Forgot password" };

/** Logins are username + password only; the admin sets a new password (no email links). */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("forgot");
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <KeyRound aria-hidden className="size-10 text-text-secondary" />
      <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-prose text-text-secondary">{t("body")}</p>
      <Button asChild variant="secondary">
        <Link href="/login">
          <ArrowLeft aria-hidden />
          {t("back")}
        </Link>
      </Button>
    </div>
  );
}
