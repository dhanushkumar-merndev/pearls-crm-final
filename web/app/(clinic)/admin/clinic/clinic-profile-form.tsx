"use client";

import { useMutation } from "@tanstack/react-query";
import { ImageUp, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { ClinicMark } from "@/components/clinic-mark";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";

export interface ClinicProfile {
  name: string;
  legal_name: string | null;
  gstin: string | null;
  llpin: string | null;
  address_lines: string[];
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
  logo_path: string | null;
  letterhead_qr_url: string | null;
  signatory_label: string;
  terms: Record<string, string[]>;
}

const BILL_TYPES = ["procedure_receipt", "pharmacy_invoice", "final_bill"] as const;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Clinic details printed on every bill and summary. Nothing here is hard-coded anywhere else. */
export function ClinicProfileForm({ initial }: { initial: ClinicProfile | null }) {
  const t = useTranslations("clinic");
  const c = useTranslations("common");
  const router = useRouter();
  const { saved, failed } = useFeedback();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    legal_name: initial?.legal_name ?? "",
    gstin: initial?.gstin ?? "",
    llpin: initial?.llpin ?? "",
    address: (initial?.address_lines ?? []).join("\n"),
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    state_code: initial?.state_code ?? "",
    pincode: initial?.pincode ?? "",
    phones: (initial?.phones ?? []).join("\n"),
    email: initial?.email ?? "",
    website: initial?.website ?? "",
    letterhead_qr_url: initial?.letterhead_qr_url ?? "",
    signatory_label: initial?.signatory_label ?? "Authorized Signatory",
    logo_path: initial?.logo_path ?? null,
    terms: Object.fromEntries(BILL_TYPES.map((b) => [b, (initial?.terms?.[b] ?? []).join("\n")])) as Record<string, string>,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) throw new Error("file_type_not_allowed");
      if (file.size > 512 * 1024) throw new Error("file_too_large");
      const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
      const path = `clinic/logo-${newId()}.${ext}`;
      const { error } = await getSupabaseBrowser().storage.from("public-assets").upload(path, file, { contentType: file.type });
      if (error) throw error;
      return path;
    },
    onSuccess: (path) => setForm((f) => ({ ...f, logo_path: path })),
    onError: failed,
  });

  const save = useMutation({
    mutationFn: () =>
      rpc("save_clinic_profile", {
        p_profile: {
          name: form.name,
          legal_name: form.legal_name,
          gstin: form.gstin,
          llpin: form.llpin,
          address_lines: lines(form.address),
          city: form.city,
          state: form.state,
          state_code: form.state_code,
          pincode: form.pincode,
          phones: lines(form.phones),
          email: form.email,
          website: form.website,
          logo_path: form.logo_path,
          letterhead_qr_url: form.letterhead_qr_url,
          signatory_label: form.signatory_label,
          terms: Object.fromEntries(BILL_TYPES.map((b) => [b, lines(form.terms[b] ?? "")])),
        },
      }),
    onSuccess: () => {
      saved();
      router.refresh();
    },
    onError: failed,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = c("required");
    if (form.gstin.trim() && !GSTIN.test(form.gstin.trim().toUpperCase())) next.gstin = t("badGstin");
    if (form.state_code.trim() && !/^[0-9]{2}$/.test(form.state_code.trim())) next.state_code = t("badStateCode");
    if (form.pincode.trim() && !/^[1-9][0-9]{5}$/.test(form.pincode.trim())) next.pincode = t("badPincode");
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  const text = (key: keyof typeof form, label: string, opts: { hint?: string; type?: string; max?: number } = {}) => (
    <Field label={label} hint={opts.hint} error={errors[key]}>
      {(a) => (
        <Input {...a} type={opts.type ?? "text"} maxLength={opts.max ?? 200} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button type="submit" disabled={save.isPending}>
            <Save aria-hidden />
            {save.isPending ? c("saving") : c("save")}
          </Button>
        }
      />

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("logo")}</CardTitle>
        <div className="flex flex-wrap items-center gap-4">
          <ClinicMark name={form.name || null} logoPath={form.logo_path} size={72} />
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-secondary px-5 font-medium hover:bg-popover-accent">
            <ImageUp aria-hidden className="size-5" />
            {upload.isPending ? t("uploading") : t("chooseLogo")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
          <CardDescription>{t("logoHint")}</CardDescription>
        </div>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t("identity")}</CardTitle>
        {text("name", t("name"), { hint: t("nameHint") })}
        {text("legal_name", t("legalName"))}
        {text("gstin", t("gstin"), { max: 15 })}
        {text("llpin", t("llpin"), { max: 20 })}
        {text("signatory_label", t("signatory"), { hint: t("signatoryHint"), max: 60 })}
        {text("letterhead_qr_url", t("qrUrl"), { hint: t("qrUrlHint"), type: "url", max: 300 })}
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t("address")}</CardTitle>
        <Field label={t("addressLines")} hint={t("onePerLine")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={3} value={form.address} onChange={(e) => set("address", e.target.value)} />}
        </Field>
        {text("city", t("city"), { max: 80 })}
        {text("state", t("state"), { max: 80 })}
        {text("state_code", t("stateCode"), { hint: t("stateCodeHint"), max: 2 })}
        {text("pincode", t("pincode"), { max: 6 })}
        <Field label={t("phones")} hint={t("onePerLine")}>
          {(a) => <Textarea {...a} rows={2} value={form.phones} onChange={(e) => set("phones", e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-4">
          {text("email", t("email"), { type: "email" })}
          {text("website", t("website"), { type: "url" })}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("terms")}</CardTitle>
        <CardDescription>{t("termsHint")}</CardDescription>
        {BILL_TYPES.map((b) => (
          <Field key={b} label={t(`billType.${b}`)} hint={t("onePointPerLine")}>
            {(a) => (
              <Textarea {...a} rows={4} value={form.terms[b] ?? ""} onChange={(e) => setForm((f) => ({ ...f, terms: { ...f.terms, [b]: e.target.value } }))} />
            )}
          </Field>
        ))}
      </Card>
    </form>
  );
}
