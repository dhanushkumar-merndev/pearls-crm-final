"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { isStrongEnough } from "@/lib/password";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function ResetForm() {
  const t = useTranslations("reset");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (!isStrongEnough(password)) return setError(t("weak"));
    if (password !== String(form.get("confirm") ?? "")) return setError(t("mismatch"));
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(t("expired"));
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login?reason=password_changed");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-text-secondary">{t("rules")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <KeyRound aria-hidden />}
        {t("submit")}
      </Button>
    </form>
  );
}
