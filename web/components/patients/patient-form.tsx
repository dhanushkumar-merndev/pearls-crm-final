"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { normalizePhone } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Card, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Master", "Baby", "Dr"] as const;
export const GENDERS = ["female", "male", "other", "unknown"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

/** What the form edits. Phones are typed freely and normalized on save. */
export interface PatientDraft {
  title: string;
  full_name: string;
  gender: string;
  age_mode: "dob" | "age";
  dob: string;
  age_years: string;
  phone: string;
  whatsapp_same: boolean;
  whatsapp: string;
  alt_phone: string;
  email: string;
  address: string;
  area: string;
  city: string;
  pincode: string;
  attender_name: string;
  attender_relation: LibraryItem | null;
  attender_phone: string;
  blood_group: string;
  allergies: string;
  conditions: string;
  current_medicines: string;
  previous_surgeries: string;
  chief_complaints: string;
  complaint_since: string;
  heard_from: LibraryItem | null;
  referred_by_text: string;
  occupation: string;
  preferred_language: string;
  id_proof_type: string;
  id_proof_number: string;
  consent_treatment: boolean;
  consent_whatsapp: boolean;
  consent_marketing: boolean;
}

export function emptyDraft(): PatientDraft {
  return {
    title: "", full_name: "", gender: "unknown", age_mode: "age", dob: "", age_years: "", phone: "", whatsapp_same: true,
    whatsapp: "", alt_phone: "", email: "", address: "", area: "", city: "", pincode: "", attender_name: "",
    attender_relation: null, attender_phone: "", blood_group: "", allergies: "", conditions: "", current_medicines: "",
    previous_surgeries: "", chief_complaints: "", complaint_since: "", heard_from: null, referred_by_text: "",
    occupation: "", preferred_language: "", id_proof_type: "", id_proof_number: "", consent_treatment: false,
    consent_whatsapp: false, consent_marketing: false,
  };
}

/** A stored patient (or a self-registration payload) → form values. */
export function draftFrom(p: Record<string, unknown>, labels: { relation?: string | null; heard_from?: string | null } = {}): PatientDraft {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]).join(", ") : "");
  const consents = (p.consents ?? {}) as Record<string, { given?: boolean }>;
  const whatsapp = s("whatsapp_e164");
  const phone = s("phone_e164");
  const item = (id: unknown, label: string | null | undefined): LibraryItem | null =>
    typeof id === "string" && id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;
  return {
    ...emptyDraft(),
    title: s("title"),
    full_name: s("full_name"),
    gender: s("gender") || "unknown",
    age_mode: p.dob && !p.dob_estimated ? "dob" : "age",
    dob: s("dob"),
    age_years: typeof p.age === "number" ? String(p.age) : typeof p.age_years === "number" ? String(p.age_years) : "",
    phone,
    whatsapp_same: !whatsapp || whatsapp === phone,
    whatsapp: whatsapp === phone ? "" : whatsapp,
    alt_phone: s("alt_phone_e164"),
    email: s("email"),
    address: s("address"),
    area: s("area"),
    city: s("city"),
    pincode: s("pincode"),
    attender_name: s("attender_name"),
    attender_relation: item(p.attender_relation_id, labels.relation),
    attender_phone: s("attender_phone_e164"),
    blood_group: s("blood_group"),
    allergies: list("allergies"),
    conditions: list("conditions"),
    current_medicines: s("current_medicines"),
    previous_surgeries: s("previous_surgeries"),
    chief_complaints: s("chief_complaints"),
    complaint_since: s("complaint_since"),
    heard_from: item(p.heard_from_id, labels.heard_from),
    referred_by_text: s("referred_by_text"),
    occupation: s("occupation"),
    preferred_language: s("preferred_language"),
    id_proof_type: s("id_proof_type"),
    id_proof_number: s("id_proof_number"),
    consent_treatment: Boolean(consents.treatment?.given),
    consent_whatsapp: Boolean(consents.whatsapp?.given),
    consent_marketing: Boolean(consents.marketing?.given),
  };
}

export type DraftErrors = Partial<Record<keyof PatientDraft, string>>;

/** Form values → the payload register_patient / update_patient take. */
export function toPayload(d: PatientDraft): { payload: Record<string, unknown>; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const phone = (value: string, key: keyof PatientDraft) => {
    if (!value.trim()) return null;
    const n = normalizePhone(value);
    if (!n) errors[key] = "badPhone";
    return n?.e164 ?? null;
  };
  if (!d.full_name.trim()) errors.full_name = "required";
  const phoneE164 = phone(d.phone, "phone");
  const whatsapp = d.whatsapp_same ? phoneE164 : phone(d.whatsapp, "whatsapp");
  if (d.pincode.trim() && !/^[1-9][0-9]{5}$/.test(d.pincode.trim())) errors.pincode = "badPincode";
  if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) errors.email = "badEmail";
  if (d.age_mode === "age" && d.age_years.trim() && !/^\d{1,3}$/.test(d.age_years.trim())) errors.age_years = "badAge";
  const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const payload: Record<string, unknown> = {
    title: d.title || null,
    full_name: d.full_name,
    gender: d.gender,
    phone_e164: phoneE164,
    whatsapp_e164: whatsapp,
    alt_phone_e164: phone(d.alt_phone, "alt_phone"),
    email: d.email,
    address: d.address,
    area: d.area,
    city: d.city,
    pincode: d.pincode,
    attender_name: d.attender_name,
    attender_relation_id: d.attender_relation?.id ?? null,
    attender_phone_e164: phone(d.attender_phone, "attender_phone"),
    blood_group: d.blood_group || null,
    allergies: split(d.allergies),
    conditions: split(d.conditions),
    current_medicines: d.current_medicines,
    previous_surgeries: d.previous_surgeries,
    chief_complaints: d.chief_complaints,
    complaint_since: d.complaint_since,
    heard_from_id: d.heard_from?.id ?? null,
    referred_by_text: d.referred_by_text,
    occupation: d.occupation,
    preferred_language: d.preferred_language,
    id_proof_type: d.id_proof_type,
    id_proof_number: d.id_proof_number,
    consents: {
      treatment: { given: d.consent_treatment, method: "desk" },
      whatsapp: { given: d.consent_whatsapp, method: "desk" },
      marketing: { given: d.consent_marketing, method: "desk" },
    },
  };
  if (d.age_mode === "dob") payload.dob = d.dob || null;
  else if (d.age_years.trim()) payload.age_years = Number(d.age_years);
  return { payload, errors };
}

/** The registration form (desk). Big fields, grouped in cards; only the name is required. */
export function PatientForm({
  draft,
  onChange,
  errors,
  extra,
}: {
  draft: PatientDraft;
  onChange: (d: PatientDraft) => void;
  errors: DraftErrors;
  extra?: ReactNode;
}) {
  const t = useTranslations("patientForm");
  const set = <K extends keyof PatientDraft>(k: K, v: PatientDraft[K]) => onChange({ ...draft, [k]: v });
  const err = (k: keyof PatientDraft) => (errors[k] ? t(`error.${errors[k]}`) : undefined);
  const text = (k: keyof PatientDraft, opts: { type?: string; max?: number; hint?: string; inputMode?: "numeric" | "tel" | "email" } = {}) => (
    <Field label={t(k)} hint={opts.hint} error={err(k)}>
      {(a) => (
        <Input
          {...a}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          maxLength={opts.max ?? 120}
          value={String(draft[k] ?? "")}
          onChange={(e) => set(k, e.target.value as never)}
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardTitle className="sm:col-span-2 lg:col-span-3">{t("who")}</CardTitle>
        <Field label={t("title")}>
          {(a) => (
            <Select {...a} value={draft.title} onChange={(e) => set("title", e.target.value)}>
              <option value="">—</option>
              {TITLES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("full_name")} error={err("full_name")} className="lg:col-span-2">
          {(a) => <Input {...a} autoFocus maxLength={120} value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} />}
        </Field>
        <Field label={t("gender")}>
          {(a) => (
            <Select {...a} value={draft.gender} onChange={(e) => set("gender", e.target.value)}>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(`genders.${g}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("ageOrDob")}>
          {(a) => (
            <Select {...a} value={draft.age_mode} onChange={(e) => set("age_mode", e.target.value as "dob" | "age")}>
              <option value="age">{t("byAge")}</option>
              <option value="dob">{t("byDob")}</option>
            </Select>
          )}
        </Field>
        {draft.age_mode === "dob" ? text("dob", { type: "date" }) : text("age_years", { inputMode: "numeric", max: 3 })}
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardTitle className="sm:col-span-2 lg:col-span-3">{t("contact")}</CardTitle>
        {text("phone", { type: "tel", inputMode: "tel", max: 20, hint: t("phoneHint") })}
        <div className="flex flex-col gap-1">
          <Checkbox label={t("whatsappSame")} checked={draft.whatsapp_same} onChange={(e) => set("whatsapp_same", e.target.checked)} />
          {!draft.whatsapp_same && text("whatsapp", { type: "tel", inputMode: "tel", max: 20 })}
        </div>
        {text("alt_phone", { type: "tel", inputMode: "tel", max: 20 })}
        {text("email", { type: "email", inputMode: "email", max: 200 })}
        <Field label={t("address")} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={500} value={draft.address} onChange={(e) => set("address", e.target.value)} />}
        </Field>
        {text("area")}
        {text("city", { max: 80 })}
        {text("pincode", { inputMode: "numeric", max: 6 })}
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardTitle className="sm:col-span-2 lg:col-span-3">{t("attender")}</CardTitle>
        {text("attender_name")}
        <Field label={t("attender_relation")}>
          {(a) => <LibraryCombobox id={a.id} kind="relation" allowCreate value={draft.attender_relation} onChange={(v) => set("attender_relation", v)} />}
        </Field>
        {text("attender_phone", { type: "tel", inputMode: "tel", max: 20 })}
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t("medical")}</CardTitle>
        {text("allergies", { hint: t("commaHint"), max: 500 })}
        {text("conditions", { hint: t("commaHint"), max: 500 })}
        <Field label={t("blood_group")}>
          {(a) => (
            <Select {...a} value={draft.blood_group} onChange={(e) => set("blood_group", e.target.value)}>
              <option value="">—</option>
              {BLOOD_GROUPS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text("complaint_since")}
        <Field label={t("chief_complaints")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={draft.chief_complaints} onChange={(e) => set("chief_complaints", e.target.value)} />}
        </Field>
        <Field label={t("current_medicines")}>
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={draft.current_medicines} onChange={(e) => set("current_medicines", e.target.value)} />}
        </Field>
        <Field label={t("previous_surgeries")}>
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={draft.previous_surgeries} onChange={(e) => set("previous_surgeries", e.target.value)} />}
        </Field>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardTitle className="sm:col-span-2 lg:col-span-3">{t("more")}</CardTitle>
        <Field label={t("heard_from")}>
          {(a) => <LibraryCombobox id={a.id} kind="lead_source" allowCreate value={draft.heard_from} onChange={(v) => set("heard_from", v)} />}
        </Field>
        {text("referred_by_text")}
        {text("occupation")}
        {text("preferred_language", { max: 40 })}
        {text("id_proof_type", { max: 40, hint: t("idProofHint") })}
        {text("id_proof_number", { max: 40 })}
      </Card>

      <Card className="flex flex-col gap-1">
        <CardTitle>{t("consents")}</CardTitle>
        <Checkbox label={t("consent_treatment")} checked={draft.consent_treatment} onChange={(e) => set("consent_treatment", e.target.checked)} />
        <Checkbox label={t("consent_whatsapp")} checked={draft.consent_whatsapp} onChange={(e) => set("consent_whatsapp", e.target.checked)} />
        <Checkbox label={t("consent_marketing")} checked={draft.consent_marketing} onChange={(e) => set("consent_marketing", e.target.checked)} />
      </Card>
      {extra}
    </div>
  );
}
