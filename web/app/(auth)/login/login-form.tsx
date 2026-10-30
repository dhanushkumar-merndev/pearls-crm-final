"use client";

import { Eye, EyeOff, Info, LoaderCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { loginSchema, toLoginEmail, type LoginInput } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="mb-3 text-center text-[2rem] font-semibold tracking-tight">{t("title")}</h1>

      {notice && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-secondary p-3 text-[0.95rem]" role="status">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Input
            id="username"
            name="username"
            placeholder=" "
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            className={PILL}
            onChange={() => clearFieldError("username")}
            {...a11y("username")}
          />
          <FloatingLabel htmlFor="username">{t("username")}</FloatingLabel>
        </div>
        <FieldError id="username-error">{fieldErrors.username}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder=" "
            autoComplete="current-password"
            required
            className={cn(PILL, "pr-14")}
            onChange={() => clearFieldError("password")}
            {...a11y("password")}
          />
          <FloatingLabel htmlFor="password">{t("password")}</FloatingLabel>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
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

      <Button type="submit" size="lg" disabled={busy} className="min-h-12 w-full rounded-full">
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <LogIn aria-hidden />}
        {busy ? t("submitting") : t("submit")}
      </Button>

      <p className="text-center text-[0.95rem] text-balance text-text-secondary">{t("forgotHint")}</p>
    </form>
  );
}

/** Pill input; the focus colour is the border itself, like the ChatGPT sign-in. */
const PILL = "peer min-h-12 rounded-full px-5 outline-none focus-visible:outline-none focus:border-ring focus:ring-1 focus:ring-ring aria-invalid:focus:border-status-critical aria-invalid:focus:ring-status-critical";

/** Sits inside the empty input like a placeholder; moves up into the border once focused or filled. */
function FloatingLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 bg-background px-1 text-base text-text-secondary transition-all",
        "peer-focus:top-0 peer-focus:text-xs peer-focus:text-ring",
        "peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs",
        "peer-autofill:top-0 peer-autofill:text-xs peer-aria-invalid:text-bad-text",
      )}
    >
      {children}
    </label>
  );
}
