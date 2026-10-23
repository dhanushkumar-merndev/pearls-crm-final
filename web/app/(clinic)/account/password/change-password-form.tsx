"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { toLoginEmail } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { isStrongEnough } from "@/lib/password";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/** Staff change their own password (there are no email reset links). */
export function ChangePasswordForm({ username }: { username: string }) {
  const t = useTranslations("account");
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.current) next.current = t("required");
    if (!isStrongEnough(form.next)) next.next = t("weak");
    else if (form.next !== form.again) next.again = t("mismatch");
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const supabase = getSupabaseBrowser();
    // Proves it's really them (a shared reception PC may be left open).
    const check = await supabase.auth.signInWithPassword({ email: toLoginEmail(username), password: form.current });
    if (check.error) {
      setErrors({ current: t("wrongCurrent") });
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: form.next });
    setBusy(false);
    if (error) {
      setErrors({ next: t("weak") });
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
          <Field label={t("current")} error={errors.current}>
            {(a) => <Input {...a} type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />}
          </Field>
          <Field label={t("new")} hint={t("rules")} error={errors.next}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />}
          </Field>
          <Field label={t("again")} error={errors.again}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} />}
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
