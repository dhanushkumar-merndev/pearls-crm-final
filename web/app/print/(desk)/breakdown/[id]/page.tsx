import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { amountInWords, formatDate, formatDateTime, formatINR } from "@pearl/shared";
import type { BreakdownBill } from "@/components/breakdown/types";
import { gstIncluded } from "@/lib/breakdown-bill";
import { getSupabaseServer } from "@/lib/supabase/server";
import { Letterhead, Watermark, type Clinic } from "../../../letterhead";
import { PrintToolbar } from "../../../print-toolbar";

export const metadata: Metadata = { title: "Print breakdown bill" };
export const dynamic = "force-dynamic";

interface PrintBreakdown extends BreakdownBill {
  copy: "original" | "duplicate" | "draft" | "cancelled";
  header: Clinic & { terms?: string[] };
  patient_strip: {
    full_name: string;
    uhid: string;
    gender: string;
    age: number | null;
    phone: string | null;
    address: string;
    doctor: string | null;
    treatment?: string;
    ip_number?: string;
    admitted_at?: string;
    discharged_at?: string | null;
    diagnosis?: string | null;
    procedures?: string[] | null;
    surgeon?: string | null;
    session_dates?: string[] | null;
  };
}

const money = (p: number) => formatINR(p, { symbol: false });

/**
 * A4 breakdown bill for the insurance company: the charges by category with subtotals, the total in
 * words and the GST inside the amounts. It is not a bill to pay (no payments, no balance). Header
 * frozen at finalize; white paper like every print page.
 */
export default async function PrintBreakdownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  // ?preview=1: shown inside the app's Preview pop-up. Not a printed copy, so it isn't counted
  // (the next real print stays the Original) and there is no Close / Print bar.
  const preview = (await searchParams).preview === "1";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printBreakdown");
  const g = await getTranslations("patientForm.genders");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("breakdown_print_data", { p_id: id, p_count: !preview });
  if (error || !data) notFound();
  const b = data as PrintBreakdown;
  const p = b.patient_strip;
  const showDate = b.lines.some((l) => l.service_date);
  const hasTax = b.lines.some((l) => l.gst_rate_bp > 0);
  const cols = 5 + (showDate ? 1 : 0) + (hasTax ? 1 : 0);
  const groups: { name: string; lines: BreakdownBill["lines"]; total: number }[] = [];
  for (const l of b.lines) {
    const name = l.category ?? t("other");
    const grp = groups.find((x) => x.name === name) ?? groups[groups.push({ name, lines: [], total: 0 }) - 1]!;
    grp.lines.push(l);
    grp.total += l.amount_paise;
  }
  const grouped = groups.length > 1;
  const gst = gstIncluded(b.lines);
  const age = [p.age !== null ? `${p.age} ${t("years")}` : null, g(p.gender || "unknown")].filter(Boolean).join(" / ");
  const facts: [string, string | null | undefined][] = [
    [t("treatment"), b.treatment ?? p.treatment],
    [t("doctor"), b.doctor ?? p.doctor],
    [t("surgeon"), p.surgeon],
    [t("ipNumber"), b.ip_number ?? p.ip_number],
    [t("admitted"), p.admitted_at ? formatDateTime(new Date(p.admitted_at)) : null],
    [t("discharged"), p.discharged_at ? formatDateTime(new Date(p.discharged_at)) : null],
    [t("sessions"), b.sessions.length ? b.sessions.map((s) => formatDate(new Date(s.date))).join(", ") : null],
    [t("diagnosis"), p.diagnosis],
    [t("procedures"), p.procedures?.length ? p.procedures.join(", ") : null],
    [t("insurer"), b.insurer],
    [t("tpa"), b.tpa],
    [t("policyNo"), b.policy_no],
    [t("claimNo"), b.claim_no],
  ];

  return (
    <>
      {!preview && <PrintToolbar />}
      <div className="sheet bill">
        {(b.copy === "cancelled" || b.copy === "draft") && <div className="stamp">{t(`stamp.${b.copy}`)}</div>}
        <Watermark clinic={b.header} />
        <Letterhead clinic={b.header} ids />

        <div className="bill-head">
          <div className="doc-title">
            {t("title")}
            <div className="soft">{t("subtitle")}</div>
          </div>
          <dl className="bill-ref">
            <div>
              <dt>{t("billNo")}</dt>
              <dd>{b.bb_no ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("date")}</dt>
              <dd>{formatDate(new Date(b.bill_date))}</dd>
            </div>
            {(b.copy === "original" || b.copy === "duplicate") && <span className="copy">{t(`copy.${b.copy}`)}</span>}
          </dl>
        </div>

        <div className="parties">
          <section>
            <div className="label">{t("patient")}</div>
            <div className="patient-name">{p.full_name}</div>
            <div>{[`${t("uhid")} ${p.uhid}`, age, p.phone].filter(Boolean).join("  ·  ")}</div>
            {p.address && <div className="soft">{p.address}</div>}
          </section>
          <dl className="facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>

        <table className="items">
          <thead>
            <tr>
              <th className="num idx">#</th>
              <th>{t("particulars")}</th>
              {showDate && <th>{t("date")}</th>}
              <th className="num">{t("qty")}</th>
              <th className="num">{t("rate")}</th>
              {hasTax && <th className="num">{t("gst")}</th>}
              <th className="num">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((grp) => (
              <GroupRows key={grp.name} grp={grp} grouped={grouped} cols={cols} showDate={showDate} hasTax={hasTax} subtotal={t("subtotal", { group: grp.name })} />
            ))}
          </tbody>
        </table>

        <div className="summary">
          <div className="summary-left">
            {grouped && (
              <table className="mini">
                <caption>{t("categorySummary")}</caption>
                <tbody>
                  {groups.map((grp) => (
                    <tr key={grp.name}>
                      <td>{grp.name}</td>
                      <td className="num">{money(grp.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {gst.length > 0 && (
              <table className="mini">
                <caption>{t("gstSummary")}</caption>
                <thead>
                  <tr>
                    <th>{t("gstRate")}</th>
                    <th className="num">{t("taxable")}</th>
                    <th className="num">{t("cgst")}</th>
                    <th className="num">{t("sgst")}</th>
                  </tr>
                </thead>
                <tbody>
                  {gst.map((r) => (
                    <tr key={r.rate_bp}>
                      <td>{r.rate_bp / 100}%</td>
                      <td className="num">{money(r.taxable_paise)}</td>
                      <td className="num">{money(r.cgst_paise)}</td>
                      <td className="num">{money(r.sgst_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="summary-right">
            <table className="totals">
              <tbody>
                <tr className="grand">
                  <td>{t("total")}</td>
                  <td>{formatINR(b.total_paise)}</td>
                </tr>
              </tbody>
            </table>
            <p className="words">{amountInWords(b.total_paise)}</p>
            {hasTax && <p className="soft">{t("includesGst")}</p>}
          </div>
        </div>
        {b.notes && (
          <p>
            <strong>{t("note")}:</strong> {b.notes}
          </p>
        )}

        <div className="bill-foot">
          {(b.header?.terms?.length ?? 0) > 0 ? (
            <section className="terms-box">
              <h2 className="terms-title">{t("terms")}</h2>
              <ol className="terms">
                {b.header.terms!.map((term, i) => (
                  <li key={i}>{term}</li>
                ))}
              </ol>
            </section>
          ) : (
            <div />
          )}
          <div className="signatory">
            <div>
              {t("for")} {b.header?.name}
            </div>
            <div className="sign-line" />
            <strong>{b.header?.signatory_label}</strong>
          </div>
        </div>
      </div>
    </>
  );
}

function GroupRows({
  grp,
  grouped,
  cols,
  showDate,
  hasTax,
  subtotal,
}: {
  grp: { name: string; lines: BreakdownBill["lines"]; total: number };
  grouped: boolean;
  cols: number;
  showDate: boolean;
  hasTax: boolean;
  subtotal: string;
}) {
  return (
    <>
      {grouped && (
        <tr className="group">
          <td colSpan={cols}>{grp.name}</td>
        </tr>
      )}
      {grp.lines.map((l) => (
        <tr key={l.id}>
          <td className="num idx">{l.line_no}</td>
          <td>
            <div className="item-name">{l.description}</div>
          </td>
          {showDate && <td className="nowrap">{l.service_date ? formatDate(new Date(l.service_date)) : ""}</td>}
          <td className="num">{Number(l.qty)}</td>
          <td className="num">{money(l.unit_paise)}</td>
          {hasTax && <td className="num">{l.gst_rate_bp > 0 ? `${l.gst_rate_bp / 100}%` : "—"}</td>}
          <td className="num">{money(l.amount_paise)}</td>
        </tr>
      ))}
      {grouped && (
        <tr className="subtotal">
          <td colSpan={cols - 1} className="num">
            {subtotal}
          </td>
          <td className="num">{money(grp.total)}</td>
        </tr>
      )}
    </>
  );
}
