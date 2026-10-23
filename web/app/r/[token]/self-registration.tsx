"use client";

import { CircleCheck, LoaderCircle, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { normalizePhone } from "@pearl/shared";
import { ClinicMark } from "@/components/clinic-mark";
import { GENDERS } from "@/components/patients/patient-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";

interface Info {
  clinic: { name: string | null; logo_path: string | null } | null;
  relations: { id: string; label: string }[];
  sources: { id: string; label: string }[];
}
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Never throws: no network, a server error or a bad answer all come back as { error }. */
async function call<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await getSupabaseBrowser().functions.invoke("public-form", { body });
    if (!error) return { data: data as T, error: null };
    // An HTTP error keeps the Response in context; a network failure keeps the TypeError.
    const res = (error as { context?: unknown }).context;
    const payload =
      res instanceof Response ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    return { data: null, error: payload?.error ?? "unknown" };
  } catch {
    return { data: null, error: "unknown" };
  }
}

export function SelfRegistration({ token, siteKey }: { token: string; siteKey: string }) {
  const t = useTranslations("selfReg");
  const g = useTranslations("patientForm.genders");
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<"loading" | "form" | "expired" | "sent" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState("");
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const [form, setForm] = useState({
    full_name: "", gender: "unknown", age_years: "", phone: "", whatsapp_same: true, whatsapp: "", email: "", address: "",
    city: "", pincode: "", allergies: "", chief_complaints: "", heard_from_id: "", referred_by_text: "", attender_name: "",
    attender_relation_id: "", attender_phone: "", consent_treatment: false, consent_whatsapp: false,
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    void call<Info & { valid: boolean }>({ action: "info", token }).then(({ data, error: e }) => {
      if (e === "link_expired") return setState("expired");
      if (!data) return setState("error");
      setInfo(data);
      setState("form");
    });
  }, [token]);

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !widget.current || widgetId.current) return;
    widgetId.current = window.turnstile.render(widget.current, {
      sitekey: siteKey,
      callback: setCaptcha,
      "expired-callback": () => setCaptcha(""),
    });
  }, [siteKey]);
  useEffect(() => {
    if (state === "form") renderWidget();
  }, [state, renderWidget]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = normalizePhone(form.phone);
    if (!form.full_name.trim()) return setError(t("needName"));
    if (!phone) return setError(t("needPhone"));
    const whatsapp = form.whatsapp_same ? phone : normalizePhone(form.whatsapp);
    if (!form.whatsapp_same && form.whatsapp.trim() && !whatsapp) return setError(t("badWhatsapp"));
    if (form.pincode.trim() && !/^[1-9][0-9]{5}$/.test(form.pincode.trim())) return setError(t("badPincode"));
    if (!form.consent_treatment) return setError(t("needConsent"));
    if (!captcha) return setError(t("needCaptcha"));
    setError(null);
    setBusy(true);
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const attender = form.attender_phone.trim() ? normalizePhone(form.attender_phone) : null;
    const { error: err } = await call({
      action: "submit",
      token,
      turnstile_token: captcha,
      payload: {
        full_name: form.full_name.trim(),
        gender: form.gender,
        ...(form.age_years.trim() ? { age_years: Number(form.age_years) } : {}),
        phone_e164: phone.e164,
        ...(whatsapp ? { whatsapp_e164: whatsapp.e164 } : {}),
        email: opt(form.email),
        address: opt(form.address),
        city: opt(form.city),
        pincode: opt(form.pincode),
        allergies: form.allergies.split(",").map((x) => x.trim()).filter(Boolean),
        chief_complaints: opt(form.chief_complaints),
        heard_from_id: opt(form.heard_from_id),
        referred_by_text: opt(form.referred_by_text),
        attender_name: opt(form.attender_name),
        attender_relation_id: opt(form.attender_relation_id),
        ...(attender ? { attender_phone_e164: attender.e164 } : {}),
        consents: { treatment: { given: form.consent_treatment }, whatsapp: { given: form.consent_whatsapp } },
      },
    });
    setBusy(false);
    if (!err) return setState("sent");
    window.turnstile?.reset(widgetId.current);
    setCaptcha("");
    setError(err === "link_expired" ? t("expired") : err === "rate_limited" ? t("tooMany") : err === "invalid_input" ? t("checkFields") : t("failed"));
  }

  if (state === "loading")
    return (
      <p className="flex items-center gap-2 text-text-secondary">
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
        {t("loading")}
      </p>
    );
  if (state === "expired" || state === "error")
    return (
      <Card>
        <h1 className="text-xl font-semibold">{state === "expired" ? t("expiredTitle") : t("failed")}</h1>
        <p className="mt-2 text-text-secondary">{t("expiredBody")}</p>
      </Card>
    );
  if (state === "sent")
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleCheck aria-hidden className="size-12 text-status-good" />
        <h1 className="text-2xl font-semibold">{t("thanksTitle")}</h1>
        <p className="text-text-secondary">{t("thanksBody")}</p>
      </Card>
    );

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} />
      <header className="flex items-center gap-3">
        <ClinicMark name={info?.clinic?.name ?? null} logoPath={info?.clinic?.logo_path ?? null} size={48} />
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-text-secondary">{info?.clinic?.name}</p>
        </div>
      </header>
      <p className="text-text-secondary">{t("intro")}</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("name")}>{(a) => <Input {...a} autoComplete="name" maxLength={120} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("gender")}>
            {(a) => (
              <Select {...a} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                {GENDERS.map((x) => (
                  <option key={x} value={x}>
                    {g(x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("age")}>{(a) => <Input {...a} inputMode="numeric" maxLength={3} value={form.age_years} onChange={(e) => set("age_years", e.target.value.replace(/\D/g, ""))} />}</Field>
        </div>
        <Field label={t("phone")}>{(a) => <Input {...a} type="tel" autoComplete="tel" maxLength={20} value={form.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
        <Checkbox label={t("whatsappSame")} checked={form.whatsapp_same} onChange={(e) => set("whatsapp_same", e.target.checked)} />
        {!form.whatsapp_same && (
          <Field label={t("whatsapp")}>{(a) => <Input {...a} type="tel" maxLength={20} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />}</Field>
        )}
        <Field label={t("email")}>{(a) => <Input {...a} type="email" autoComplete="email" maxLength={200} value={form.email} onChange={(e) => set("email", e.target.value)} />}</Field>
        <Field label={t("address")}>{(a) => <Input {...a} autoComplete="street-address" maxLength={500} value={form.address} onChange={(e) => set("address", e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("city")}>{(a) => <Input {...a} maxLength={80} value={form.city} onChange={(e) => set("city", e.target.value)} />}</Field>
          <Field label={t("pincode")}>{(a) => <Input {...a} inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} />}</Field>
        </div>
        <Field label={t("allergies")} hint={t("allergiesHint")}>{(a) => <Input {...a} maxLength={300} value={form.allergies} onChange={(e) => set("allergies", e.target.value)} />}</Field>
        <Field label={t("complaints")}>{(a) => <Textarea {...a} rows={3} maxLength={2000} value={form.chief_complaints} onChange={(e) => set("chief_complaints", e.target.value)} />}</Field>
        <Field label={t("heardFrom")}>
          {(a) => (
            <Select {...a} value={form.heard_from_id} onChange={(e) => set("heard_from_id", e.target.value)}>
              <option value="">—</option>
              {info?.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("referredBy")}>{(a) => <Input {...a} maxLength={120} value={form.referred_by_text} onChange={(e) => set("referred_by_text", e.target.value)} />}</Field>
        <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <legend className="px-1 font-medium">{t("attender")}</legend>
          <Field label={t("attenderName")}>{(a) => <Input {...a} maxLength={120} value={form.attender_name} onChange={(e) => set("attender_name", e.target.value)} />}</Field>
          <Field label={t("relation")}>
            {(a) => (
              <Select {...a} value={form.attender_relation_id} onChange={(e) => set("attender_relation_id", e.target.value)}>
                <option value="">—</option>
                {info?.relations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("attenderPhone")}>{(a) => <Input {...a} type="tel" maxLength={20} value={form.attender_phone} onChange={(e) => set("attender_phone", e.target.value)} />}</Field>
        </fieldset>
        <Checkbox label={t("consentTreatment")} checked={form.consent_treatment} onChange={(e) => set("consent_treatment", e.target.checked)} />
        <Checkbox label={t("consentWhatsapp")} checked={form.consent_whatsapp} onChange={(e) => set("consent_whatsapp", e.target.checked)} />
        <div ref={widget} />
        {error && (
          <p role="alert" className="text-bad-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          {busy ? t("sending") : t("send")}
        </Button>
      </form>
    </>
  );
}
