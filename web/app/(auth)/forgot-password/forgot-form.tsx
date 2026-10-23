"use client";

import { ArrowLeft, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function ForgotForm() {
  const t = useTranslations("forgot");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email || busy) return;
    setBusy(true);
    await getSupabaseBrowser()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      })
      .catch(() => undefined);
    // Same message whether or not the email exists (don't reveal who has an account).
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-text-secondary">{t("subtitle")}</p>
      </div>
      {sent ? (
        <p role="status" className="rounded-xl border border-border bg-secondary p-4">
          {t("sent")}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Mail aria-hidden />}
            {t("submit")}
          </Button>
          <p className="text-center text-[0.95rem] text-text-secondary">{t("noEmail")}</p>
        </form>
      )}
      <Link href="/login" className="inline-flex items-center gap-2 self-center text-link underline-offset-4 hover:underline">
        <ArrowLeft aria-hidden className="size-5" />
        {t("back")}
      </Link>
    </div>
  );
}
