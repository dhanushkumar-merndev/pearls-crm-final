import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@pearl/shared";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getClinic, Letterhead } from "../../letterhead";
import { PrintToolbar } from "../../print-toolbar";

export const metadata: Metadata = { title: "Registration form" };

type P = Record<string, unknown>;

function Line({ label, value }: { label: string; value?: string }) {
  return (
    <div className="line">
      <span className="label">{label}:</span>
      <span className="value">{value}</span>
    </div>
  );
}

/** /print/registration/blank → empty form to fill by hand; /print/registration/<id> → filled. */
export default async function RegistrationFormPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blank = id === "blank";
  if (!blank && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printRegistration");
  const g = await getTranslations("patientForm.genders");
  const clinic = await getClinic();
  let p: P = {};
  if (!blank) {
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.rpc("patient_header", { p_patient_id: id });
    if (error || !data) notFound();
    p = data as P;
  }
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]).join(", ") : "");
  const consents = (p.consents ?? {}) as Record<string, { given?: boolean }>;
  const tick = (on: boolean | undefined) => (blank ? "☐" : on ? "☑" : "☐");

  return (
    <>
      <PrintToolbar />
      <div className="sheet">
        <Letterhead clinic={clinic} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: "14pt" }}>{t("title")}</strong>
          <span>
            {t("uhid")}: <strong>{s("uhid") || "____________"}</strong> · {t("date")}:{" "}
            {blank ? "____ / ____ / ________" : formatDate(new Date(String(p.created_at)))}
          </span>
        </div>

        <h2>{t("patient")}</h2>
        <div className="grid">
          <Line label={t("name")} value={[s("title"), s("full_name")].filter(Boolean).join(" ")} />
          <Line label={t("gender")} value={blank ? "" : g(s("gender") || "unknown")} />
          <Line label={t("dob")} value={p.dob ? formatDate(new Date(String(p.dob))) : ""} />
          <Line label={t("age")} value={typeof p.age === "number" ? String(p.age) : ""} />
          <Line label={t("phone")} value={s("phone_e164")} />
          <Line label={t("whatsapp")} value={s("whatsapp_e164")} />
          <Line label={t("email")} value={s("email")} />
          <Line label={t("occupation")} value={s("occupation")} />
        </div>
        <Line label={t("address")} value={[s("address"), s("area"), s("city"), s("pincode")].filter(Boolean).join(", ")} />

        <h2>{t("attender")}</h2>
        <div className="grid">
          <Line label={t("name")} value={s("attender_name")} />
          <Line label={t("relation")} value={s("attender_relation")} />
          <Line label={t("phone")} value={s("attender_phone_e164")} />
          <Line label={t("idProof")} value={[s("id_proof_type"), s("id_proof_number")].filter(Boolean).join(" ")} />
        </div>

        <h2>{t("medical")}</h2>
        <div className="grid">
          <Line label={t("bloodGroup")} value={s("blood_group")} />
          <Line label={t("allergies")} value={list("allergies")} />
          <Line label={t("conditions")} value={list("conditions")} />
          <Line label={t("since")} value={s("complaint_since")} />
        </div>
        <p className="label" style={{ fontWeight: 600, marginTop: 6 }}>{t("complaints")}</p>
        <div className="box">{s("chief_complaints")}</div>
        <p className="label" style={{ fontWeight: 600, marginTop: 6 }}>{t("medicines")}</p>
        <div className="box">{s("current_medicines")}</div>
        <p className="label" style={{ fontWeight: 600, marginTop: 6 }}>{t("surgeries")}</p>
        <div className="box">{s("previous_surgeries")}</div>

        <h2>{t("source")}</h2>
        <div className="grid">
          <Line label={t("heardFrom")} value={s("heard_from")} />
          <Line label={t("referredBy")} value={s("referred_by_text")} />
        </div>

        <h2>{t("consents")}</h2>
        <p>
          {tick(consents.treatment?.given)} {t("consentTreatment")}
        </p>
        <p>
          {tick(consents.whatsapp?.given)} {t("consentWhatsapp")}
        </p>
        <p>
          {tick(consents.marketing?.given)} {t("consentMarketing")}
        </p>

        <div className="sign">
          <div>{t("patientSign")}</div>
          <div>{t("staffSign")}</div>
        </div>
      </div>
    </>
  );
}
