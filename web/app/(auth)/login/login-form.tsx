"use client";

import { Eye, EyeOff, Info, LoaderCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { loginSchema, toLoginEmail, type LoginInput } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";

type LoginField = keyof LoginInput;
const FIELDS: readonly LoginField[] = ["username", "password"];

export function LoginForm({ next, notice, signOutFirst }: { next: string; notice: string | null; signOutFirst: boolean }) {
  const t = useTranslations("login");
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({});

  useEffect(() => {
    if (signOutFirst) void getSupabaseBrowser().auth.signOut();
  }, [signOutFirst]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    // Checked here first: an empty or impossible login never reaches the server.
    const parsed = loginSchema.safeParse({
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (!parsed.success) {
      const found: Partial<Record<LoginField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as LoginField;
        found[field] ??= t(issue.message);
      }
      setFieldErrors(found);
      setError(null);
      const first = FIELDS.find((f) => found[f]);
      if (first) (formEl.elements.namedItem(first) as HTMLInputElement | null)?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await getSupabaseBrowser().auth.signInWithPassword({
        email: toLoginEmail(parsed.data.username),
        password: parsed.data.password,
      });
      if (authError) {
        const status = authError.status ?? 0;
        // 400-range = wrong details; 429 = too many tries; 0/5xx = server not reachable.
        setError(status === 429 ? t("tooMany") : status >= 400 && status < 500 ? t("wrong") : t("offline"));
        setBusy(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError(t("offline"));
      setBusy(false);
    }
  }

  /** Typing in a field clears its own message. */
  function clearFieldError(field: LoginField) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function a11y(field: LoginField) {
    const describedBy = [fieldErrors[field] && `${field}-error`, error && "login-error"].filter(Boolean).join(" ");
    return { "aria-invalid": Boolean(fieldErrors[field] || error), "aria-describedby": describedBy || undefined };
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-balance text-text-secondary">{t("subtitle")}</p>
      </div>

      {notice && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-secondary p-3 text-[0.95rem]" role="status">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          onChange={() => clearFieldError("username")}
          {...a11y("username")}
        />
        <FieldError id="username-error">{fieldErrors.username}</FieldError>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-14"
            onChange={() => clearFieldError("password")}
            {...a11y("password")}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0.5 -translate-y-1/2"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
        <FieldError id="password-error">{fieldErrors.password}</FieldError>
      </div>

      <FieldError id="login-error">{error}</FieldError>

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <LogIn aria-hidden />}
        {busy ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
