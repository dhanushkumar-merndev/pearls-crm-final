import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { amountInWords, formatDate, formatDateTime, formatINR } from "@pearl/shared";
import type { Bill, BillItem } from "@/components/bills/types";
import { getSupabaseServer } from "@/lib/supabase/server";
import { Letterhead, type Clinic } from "../../letterhead";
import { PrintToolbar } from "../../print-toolbar";

export const metadata: Metadata = { title: "Print bill" };
export const dynamic = "force-dynamic";

interface PrintBill extends Bill {
  copy: "original" | "duplicate" | "draft" | "cancelled";
  header: Clinic & { terms: string[] };
  patient_strip: { full_name: string; uhid: string; gender: string; age: number | null; phone: string | null; address: string; doctor: string | null };
  payments: { received_at: string; mode: string; reference: string | null; amount_paise: number }[];
  stay: { ip_number: string; admitted_at: string; discharged_at: string | null; room_days: number } | null;
}

const discountText = (i: BillItem) =>
  i.discount_paise === 0 ? "" : i.discount_type === "percent" ? `${i.discount_value / 100} %` : formatINR(i.discount_paise, { symbol: false });

/** A4 bill: Bill cum Receipt, pharmacy Tax / Retail Invoice, or Final Bill. Header frozen at finalize. */
export default async function PrintBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printBill");
  const g = await getTranslations("patientForm.genders");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("bill_print_data", { p_bill_id: id, p_count: true });
  if (error || !data) notFound();
  const b = data as PrintBill;
  const hasTax = b.items.some((i) => i.cgst_paise + i.sgst_paise > 0);
  const pharmacy = b.bill_type === "pharmacy_invoice";
  const final = b.bill_type === "final_bill";
  const grand = b.total_paise + b.carried_in_paise;
  const received = b.payments.reduce((s, p) => s + p.amount_paise, 0);
  const cols = 6 + (pharmacy ? 2 : 0) + (hasTax ? 3 : 0);

  // Final bill: lines grouped by category with a subtotal each (PLAN.md C6).
  const groups = new Map<string, BillItem[]>();
  for (const i of b.items) {
    const key = final ? (i.category ?? t("other")) : "";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }

  return (
    <>
      <PrintToolbar />
      <div className="sheet">
        {(b.copy === "cancelled" || b.copy === "draft") && <div className="stamp">{t(`stamp.${b.copy}`)}</div>}
        <Letterhead clinic={b.header} />
        {b.header?.gstin && (
          <div className="muted">
            {t("gstin")}: {b.header.gstin}
            {b.header.state_code ? ` · ${t("stateCode")}: ${b.header.state_code}` : ""}
          </div>
        )}
        <div className="doc-title">
          {b.copy === "original" || b.copy === "duplicate" ? <span className="copy">{t(`copy.${b.copy}`)}</span> : null}
          {t(`title.${pharmacy && hasTax ? "pharmacy_tax" : b.bill_type}`)}
        </div>
        <div className="meta">
          <div>
            <strong>{t("billNo")}:</strong> {b.bill_no ?? "—"}
          </div>
          <div>
            <strong>{t("date")}:</strong> {b.bill_at ? formatDateTime(new Date(b.bill_at)) : formatDate(new Date(b.created_at))}
          </div>
          <div>
            <strong>{t("patient")}:</strong> {b.patient_strip.full_name}
          </div>
          <div>
            <strong>{t("uhid")}:</strong> {b.patient_strip.uhid}
          </div>
          <div>
            <strong>{t("ageGender")}:</strong> {[b.patient_strip.age !== null ? `${b.patient_strip.age} ${t("years")}` : null, g(b.patient_strip.gender || "unknown")].filter(Boolean).join(" / ")}
          </div>
          <div>
            <strong>{t("phone")}:</strong> {b.patient_strip.phone ?? "—"}
          </div>
          <div>
            <strong>{t("doctor")}:</strong> {b.patient_strip.doctor ?? "—"}
          </div>
          <div>
            <strong>{t("referredBy")}:</strong> {b.referred_by_text ?? "—"}
          </div>
          {b.stay && (
            <>
              <div>
                <strong>{t("ipNumber")}:</strong> {b.stay.ip_number}
              </div>
              <div>
                <strong>{t("stay")}:</strong> {formatDateTime(new Date(b.stay.admitted_at))} – {b.stay.discharged_at ? formatDateTime(new Date(b.stay.discharged_at)) : "—"} (
                {t("nights", { n: b.stay.room_days })})
              </div>
            </>
          )}
        </div>

        <table className="lines">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("particulars")}</th>
              <th>{pharmacy ? t("hsn") : t("sac")}</th>
              {pharmacy && <th>{t("batchExpiry")}</th>}
              {pharmacy && <th>{t("mfg")}</th>}
              <th className="num">{t("rate")}</th>
              <th className="num">{t("qty")}</th>
              <th className="num">{t("discount")}</th>
              {hasTax && <th className="num">{t("taxable")}</th>}
              {hasTax && <th className="num">{t("cgst")}</th>}
              {hasTax && <th className="num">{t("sgst")}</th>}
              <th className="num">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([group, items]) => (
              <GroupRows
                key={group || "all"}
                group={group}
                items={items}
                cols={cols}
                pharmacy={pharmacy}
                hasTax={hasTax}
                subtotalLabel={t("subtotal", { group })}
                carriedLabel={t.raw("carriedFrom") as string}
              />
            ))}
          </tbody>
        </table>

        <table className="totals">
          <tbody>
            <tr>
              <td>{t("gross")}</td>
              <td>{formatINR(b.gross_paise)}</td>
            </tr>
            {b.discount_paise > 0 && (
              <tr>
                <td>{t("discountTotal")}</td>
                <td>−{formatINR(b.discount_paise)}</td>
              </tr>
            )}
            {hasTax && (
              <>
                <tr>
                  <td>{t("taxable")}</td>
                  <td>{formatINR(b.taxable_paise)}</td>
                </tr>
                <tr>
                  <td>{t("cgst")}</td>
                  <td>{formatINR(b.cgst_paise)}</td>
                </tr>
                <tr>
                  <td>{t("sgst")}</td>
                  <td>{formatINR(b.sgst_paise)}</td>
                </tr>
              </>
            )}
            {b.round_off_paise !== 0 && (
              <tr>
                <td>{t("roundOff")}</td>
                <td>{formatINR(b.round_off_paise)}</td>
              </tr>
            )}
            {b.carried_in_paise > 0 && (
              <tr>
                <td>{t("carriedInTotal")}</td>
                <td>{formatINR(b.carried_in_paise)}</td>
              </tr>
            )}
            <tr className="grand">
              <td>{t("billAmount")}</td>
              <td>{formatINR(grand)}</td>
            </tr>
            <tr>
              <td>{t("received")}</td>
              <td>{formatINR(received)}</td>
            </tr>
            <tr>
              <td>
                <strong>{t("balance")}</strong>
              </td>
              <td>
                <strong>{formatINR(grand - received)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="words">{amountInWords(grand)}</p>
        {b.below_agreed_reason && (
          <p className="muted">
            {t("belowAgreed")}: {b.below_agreed_reason}
          </p>
        )}

        {b.payments.length > 0 && (
          <>
            <h2>{t("payments")}</h2>
            <table className="lines">
              <tbody>
                {b.payments.map((p, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(new Date(p.received_at))}</td>
                    <td>{p.mode}</td>
                    <td>{p.reference ?? ""}</td>
                    <td className="num">{formatINR(p.amount_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {b.header?.terms?.length > 0 && (
          <>
            <h2>{t("terms")}</h2>
            <ol className="terms">
              {b.header.terms.map((term, i) => (
                <li key={i}>{term}</li>
              ))}
            </ol>
          </>
        )}
        <div className="signatory">
          <div>
            {t("for")} {b.header?.name}
          </div>
          <div style={{ marginTop: 36 }}>{b.header?.signatory_label}</div>
        </div>
      </div>
    </>
  );
}

function GroupRows({
  group,
  items,
  cols,
  pharmacy,
  hasTax,
  subtotalLabel,
  carriedLabel,
}: {
  group: string;
  items: BillItem[];
  cols: number;
  pharmacy: boolean;
  hasTax: boolean;
  subtotalLabel: string;
  carriedLabel: string;
}) {
  const subtotal = items.reduce((s, i) => s + i.total_paise, 0);
  return (
    <>
      {group && (
        <tr className="group">
          <td colSpan={cols}>{group}</td>
        </tr>
      )}
      {items.map((i) => (
        <tr key={i.id}>
          <td className="num">{i.line_no}</td>
          <td>
            {i.description}
            {i.kind === "carried_in" && <div className="muted">{carriedLabel.replace("{no}", i.carried_from_bill_no ?? "")}</div>}
          </td>
          <td>{i.hsn_sac ?? ""}</td>
          {pharmacy && <td>{[i.batch_no, i.expiry_date ? formatDate(new Date(i.expiry_date)).slice(3) : null].filter(Boolean).join(" / ")}</td>}
          {pharmacy && <td>{i.mfg ?? ""}</td>}
          <td className="num">{formatINR(i.rate_paise, { symbol: false })}</td>
          <td className="num">{Number(i.qty)}</td>
          <td className="num">{discountText(i)}</td>
          {hasTax && <td className="num">{formatINR(i.taxable_paise, { symbol: false })}</td>}
          {hasTax && (
            <td className="num">
              {formatINR(i.cgst_paise, { symbol: false })}
              <div className="muted">{i.gst_rate_bp / 200}%</div>
            </td>
          )}
          {hasTax && (
            <td className="num">
              {formatINR(i.sgst_paise, { symbol: false })}
              <div className="muted">{i.gst_rate_bp / 200}%</div>
            </td>
          )}
          <td className="num">{formatINR(i.total_paise, { symbol: false })}</td>
        </tr>
      ))}
      {group && (
        <tr>
          <td colSpan={cols - 1} className="num">
            {subtotalLabel}
          </td>
          <td className="num">{formatINR(subtotal, { symbol: false })}</td>
        </tr>
      )}
    </>
  );
}
