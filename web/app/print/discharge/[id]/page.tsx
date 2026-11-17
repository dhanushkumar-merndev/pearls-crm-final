import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate, formatDateTime } from "@pearl/shared";
import { getSupabaseServer } from "@/lib/supabase/server";
import { Letterhead, type Clinic } from "../../letterhead";
import { PrintToolbar } from "../../print-toolbar";

export const metadata: Metadata = { title: "Print discharge summary" };
export const dynamic = "force-dynamic";

interface PrintSummary {
  kind?: "ip" | "op";
  status: "draft" | "finalized" | "cancelled";
  copy: "original" | "duplicate" | "draft";
  header: Clinic;
  patient_strip: {
    full_name: string;
    uhid: string;
    gender: string;
    age: number | null;
    phone: string | null;
    address: string;
    /** Missing on summaries frozen before OP summaries existed (all IP). */
    kind?: "ip" | "op";
    doctor?: string | null;
    visit_date?: string;
    treatment?: string | null;
    ip_number: string;
    admitted_at: string;
    discharged_at: string | null;
    surgery_at: string | null;
    procedures: string[];
    anaesthesia: string | null;
    diagnosis: string | null;
    surgeons?: string | null;
    signature?: {
      name: string | null;
      qualification: string | null;
      designation: string | null;
      reg_council: string | null;
      reg_number: string | null;
    };
  };
  body: {
    sections: { key: string; title: string; body: string }[];
    medications: {
      name: string;
      dose: string;
      frequency: string;
      duration: string;
      instructions: string;
    }[];
    follow_up_note: string;
    follow_up_days: number | null;
    vars: Record<string, string>;
  };
}

/** A4 discharge summary: letterhead on every page, frozen text, signature block (PLAN.md A3). */
export default async function PrintDischargePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printDischarge");
  const g = await getTranslations("patientForm.genders");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("discharge_print_data", { p_id: id, p_count: true });
  if (error || !data) notFound();
  const d = data as PrintSummary;
  // The signing doctor's signature image (uploaded on the doctor's page): a 5-minute link, or none.
  let signatureUrl: string | null = null;
  try {
    const { data: fileId } = await supabase.rpc("discharge_signature_file", { p_id: id });
    if (typeof fileId === "string") {
      const { data: links } = await supabase.functions.invoke("files-sign", {
        body: { op: "get", file_ids: [fileId] },
      });
      signatureUrl = (links as { urls?: Record<string, string> } | null)?.urls?.[fileId] ?? null;
    }
  } catch {
    signatureUrl = null;
  }
  const p = d.patient_strip;
  const sig = p.signature;
  const followUp = d.body.vars.follow_up_date;
  // OP (a day procedure or visit): the visit date and doctor instead of the stay's lines.
  const op = (p.kind ?? d.kind) === "op";
  return (
    <>
      <PrintToolbar />
      <div className="sheet">
        {d.copy === "draft" && <div className="stamp">{t("draft")}</div>}
        <table className="pages">
          <thead>
            <tr>
              <td>
                <Letterhead clinic={d.header} />
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div className="doc-title">
                  {d.copy !== "draft" && <span className="copy">{t(`copy.${d.copy}`)}</span>}
                  {t("title")}
                </div>
                <div className="meta">
                  <div>
                    <strong>{t("patient")}:</strong> {p.full_name}
                  </div>
                  <div>
                    <strong>{t("uhid")}:</strong> {p.uhid}
                  </div>
                  <div>
                    <strong>{t("ageGender")}:</strong>{" "}
                    {[p.age !== null ? `${p.age} ${t("years")}` : null, g(p.gender || "unknown")]
                      .filter(Boolean)
                      .join(" / ")}
                  </div>
                  {op ? (
                    <>
                      <div>
                        <strong>{t("visitType")}:</strong> {t("opVisit")}
                      </div>
                      <div>
                        <strong>{t("visitDate")}:</strong>{" "}
                        {p.visit_date ? formatDate(new Date(p.visit_date)) : "—"}
                      </div>
                      {(p.signature?.name ?? p.doctor ?? d.body.vars.doctor) && (
                        <div>
                          <strong>{t("doctor")}:</strong>{" "}
                          {p.signature?.name ?? p.doctor ?? d.body.vars.doctor}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <strong>{t("ipNumber")}:</strong> {p.ip_number}
                      </div>
                      <div>
                        <strong>{t("admitted")}:</strong> {formatDateTime(new Date(p.admitted_at))}
                      </div>
                      <div>
                        <strong>{t("discharged")}:</strong>{" "}
                        {p.discharged_at ? formatDateTime(new Date(p.discharged_at)) : "—"}
                      </div>
                    </>
                  )}
                  {!op && p.surgery_at && (
                    <div>
                      <strong>{t("surgery")}:</strong> {formatDateTime(new Date(p.surgery_at))}
                    </div>
                  )}
                  {!op && (p.surgeons || d.body.vars.surgeons) && (
                    <div>
                      <strong>{t("surgeons")}:</strong> {p.surgeons ?? d.body.vars.surgeons}
                    </div>
                  )}
                  {p.procedures?.length > 0 && (
                    <div>
                      <strong>{t("procedure")}:</strong> {p.procedures.join(", ")}
                    </div>
                  )}
                  {p.anaesthesia && (
                    <div>
                      <strong>{t("anaesthesia")}:</strong> {p.anaesthesia}
                    </div>
                  )}
                </div>

                {d.body.sections.map((s) => (
                  <div key={s.key} className="summary-section">
                    <h2>{s.title}</h2>
                    <p>{s.body}</p>
                  </div>
                ))}

                {d.body.medications.length > 0 && (
                  <div className="summary-section">
                    <h2>{t("medications")}</h2>
                    <table className="meds">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("med.name")}</th>
                          <th>{t("med.dose")}</th>
                          <th>{t("med.frequency")}</th>
                          <th>{t("med.duration")}</th>
                          <th>{t("med.instructions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.body.medications.map((m, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            <td>{m.name}</td>
                            <td>{m.dose}</td>
                            <td>{m.frequency}</td>
                            <td>{m.duration}</td>
                            <td>{m.instructions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {(followUp || d.body.follow_up_note) && (
                  <div className="summary-section">
                    <h2>{t("followUp")}</h2>
                    {followUp && <p>{t("followUpOn", { date: followUp })}</p>}
                    {d.body.follow_up_note && <p>{d.body.follow_up_note}</p>}
                  </div>
                )}

                <div className="signature">
                  <div>
                    {t("for")} {d.header?.name}
                  </div>
                  {signatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, printed
                    <img className="sign-image" src={signatureUrl} alt={t("signatureAlt")} />
                  ) : (
                    <div className="space" />
                  )}
                  {sig?.name && <div>{sig.name}</div>}
                  {sig?.qualification && <div className="muted">{sig.qualification}</div>}
                  {sig?.designation && <div className="muted">{sig.designation}</div>}
                  {sig?.reg_number && (
                    <div className="muted">
                      {t("regNo")}: {[sig.reg_council, sig.reg_number].filter(Boolean).join(" ")}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
