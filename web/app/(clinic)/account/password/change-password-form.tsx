"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { changePasswordSchema, toLoginEmail } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useZodForm } from "@/lib/use-zod-form";

/** Staff change their own password (there are no email reset links). */
export function ChangePasswordForm({ username }: { username: string }) {
  const t = useTranslations("account");
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const checks = useZodForm(changePasswordSchema);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    checks.clear(key);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!checks.validate(form)) return;

    setBusy(true);
    const supabase = getSupabaseBrowser();
    // Proves it's really them (a shared reception PC may be left open).
    const check = await supabase.auth.signInWithPassword({ email: toLoginEmail(username), password: form.current });
    if (check.error) {
      checks.setError("current", "account.wrongCurrent");
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: form.next });
    setBusy(false);
    if (error) {
      checks.setError("next", "account.weak");
      return;
    }
    setForm({ current: "", next: "", again: "" });
    toast.success(t("changed"));
  }

  return (
    <div className="max-w-lg">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t("current")} error={checks.error("current")}>
            {(a) => <Input {...a} type="password" autoComplete="current-password" value={form.current} onChange={(e) => set("current", e.target.value)} />}
          </Field>
          <Field label={t("new")} hint={t("rules")} error={checks.error("next")}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" value={form.next} onChange={(e) => set("next", e.target.value)} />}
          </Field>
          <Field label={t("again")} error={checks.error("again")}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" value={form.again} onChange={(e) => set("again", e.target.value)} />}
          </Field>
          <Button type="submit" disabled={busy} className="self-start">
            <KeyRound aria-hidden />
            {busy ? t("saving") : t("save")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
