import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { amountInWords, formatDate, formatDateTime, formatINR } from "@pearl/shared";
import type { Bill, BillItem } from "@/components/bills/types";
import { getSupabaseServer } from "@/lib/supabase/server";
import { Letterhead, Watermark, type Clinic } from "../../letterhead";
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

const money = (p: number) => formatINR(p, { symbol: false });
const discountText = (i: BillItem) => (i.discount_paise === 0 ? "" : i.discount_type === "percent" ? `${i.discount_value / 100}%` : money(i.discount_paise));
const gstText = (bp: number) => `${bp / 100}%`;

/**
 * A4 bill: Bill cum receipt (procedures, surgery), pharmacy Tax / Retail invoice, or the itemised
 * Final bill (in-patient stay, for insurance). Header frozen at finalize. Empty columns are left
 * out; medicine details sit under the item name; GST is summarised by rate.
 */
export default async function PrintBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printBill");
  const g = await getTranslations("patientForm.genders");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("bill_print_data", { p_bill_id: id, p_count: true });
  if (error || !data) notFound();
  const b = data as PrintBill;
  const pharmacy = b.bill_type === "pharmacy_invoice";
  const final = b.bill_type === "final_bill";
  const hasTax = b.items.some((i) => i.cgst_paise + i.sgst_paise > 0);
  const showDisc = b.items.some((i) => i.discount_paise > 0);
  const showDate = final && b.items.some((i) => i.service_date);
  const grand = b.total_paise + b.carried_in_paise;
  const received = b.payments.reduce((s, p) => s + p.amount_paise, 0);
  const balance = grand - received;
  const tax = b.cgst_paise + b.sgst_paise;
  // #, particulars, (date), qty, rate, (disc.), (GST), amount.
  const cols = 5 + (showDate ? 1 : 0) + (showDisc ? 1 : 0) + (hasTax ? 1 : 0);

  // Final bill: lines grouped by category with a subtotal each (PLAN.md C6), and a summary.
  const groups = new Map<string, BillItem[]>();
  for (const i of b.items) {
    const key = final ? (i.category ?? t("other")) : "";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  // GST by rate (what a tax invoice must show), from the lines.
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number }>();
  for (const i of b.items) {
    if (i.cgst_paise + i.sgst_paise === 0) continue;
    const r = byRate.get(i.gst_rate_bp) ?? { taxable: 0, cgst: 0, sgst: 0 };
    byRate.set(i.gst_rate_bp, { taxable: r.taxable + i.taxable_paise, cgst: r.cgst + i.cgst_paise, sgst: r.sgst + i.sgst_paise });
  }
  const age = [b.patient_strip.age !== null ? `${b.patient_strip.age} ${t("years")}` : null, g(b.patient_strip.gender || "unknown")].filter(Boolean).join(" / ");

  return (
    <>
      <PrintToolbar />
      <div className="sheet bill">
        {(b.copy === "cancelled" || b.copy === "draft") && <div className="stamp">{t(`stamp.${b.copy}`)}</div>}
        <Watermark clinic={b.header} />
        <Letterhead clinic={b.header} ids />

        <div className="bill-head">
          <div className="doc-title">{t(`title.${pharmacy && hasTax ? "pharmacy_tax" : b.bill_type}`)}</div>
          <dl className="bill-ref">
            <div>
              <dt>{t("billNo")}</dt>
              <dd>{b.bill_no ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("date")}</dt>
              <dd>{b.bill_at ? formatDateTime(new Date(b.bill_at)) : formatDate(new Date(b.created_at))}</dd>
            </div>
            {(b.copy === "original" || b.copy === "duplicate") && <span className="copy">{t(`copy.${b.copy}`)}</span>}
          </dl>
        </div>

        <div className="parties">
          <section>
            <div className="label">{t("billedTo")}</div>
            <div className="patient-name">{b.patient_strip.full_name}</div>
            <div>{[`${t("uhid")} ${b.patient_strip.uhid}`, age, b.patient_strip.phone].filter(Boolean).join("  ·  ")}</div>
            {b.patient_strip.address && <div className="soft">{b.patient_strip.address}</div>}
          </section>
          <dl className="facts">
            <div>
              <dt>{t("doctor")}</dt>
              <dd>{b.patient_strip.doctor ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("referredBy")}</dt>
              <dd>{b.referred_by_text ?? "—"}</dd>
            </div>
            {b.stay && (
              <>
                <div>
                  <dt>{t("ipNumber")}</dt>
                  <dd>{b.stay.ip_number}</dd>
                </div>
                <div>
                  <dt>{t("admitted")}</dt>
                  <dd>{formatDateTime(new Date(b.stay.admitted_at))}</dd>
                </div>
                <div>
                  <dt>{t("discharged")}</dt>
                  <dd>
                    {b.stay.discharged_at ? formatDateTime(new Date(b.stay.discharged_at)) : "—"} ({t("nights", { n: b.stay.room_days })})
                  </dd>
                </div>
              </>
            )}
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
              {showDisc && <th className="num">{t("discount")}</th>}
              {hasTax && <th className="num">{t("gst")}</th>}
              <th className="num">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([group, items]) => (
              <GroupRows key={group || "all"} group={group} items={items} cols={cols} pharmacy={pharmacy} showDate={showDate} showDisc={showDisc} hasTax={hasTax} t={t} />
            ))}
          </tbody>
        </table>

        <div className="summary">
          <div className="summary-left">
            {final && groups.size > 1 && (
              <table className="mini">
                <caption>{t("categorySummary")}</caption>
                <tbody>
                  {[...groups.entries()].map(([group, items]) => (
                    <tr key={group}>
                      <td>{group}</td>
                      <td className="num">{money(items.reduce((s, i) => s + i.total_paise, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {byRate.size > 0 && (
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
                  {[...byRate.entries()].sort(([a], [c]) => a - c).map(([rate, r]) => (
                    <tr key={rate}>
                      <td>{gstText(rate)}</td>
                      <td className="num">{money(r.taxable)}</td>
                      <td className="num">{money(r.cgst)}</td>
                      <td className="num">{money(r.sgst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {b.payments.length > 0 && (
              <table className="mini">
                <caption>{t("paymentsReceived")}</caption>
                <tbody>
                  {b.payments.map((p, i) => (
                    <tr key={i}>
                      <td>{formatDateTime(new Date(p.received_at))}</td>
                      <td>{[p.mode, p.reference].filter(Boolean).join(" · ")}</td>
                      <td className="num">{money(p.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="summary-right">
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
                {tax > 0 && (
                  <tr className={b.tax_inclusive ? "soft" : undefined}>
                    <td>{b.tax_inclusive ? t("includesGst") : t("gst")}</td>
                    <td>{formatINR(tax)}</td>
                  </tr>
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
                  <td>{t("total")}</td>
                  <td>{formatINR(grand)}</td>
                </tr>
                <tr>
                  <td>{t("received")}</td>
                  <td>{formatINR(received)}</td>
                </tr>
                <tr className="due">
                  <td>{balance > 0 ? t("balanceDue") : t("balance")}</td>
                  <td>{balance === 0 ? t("paidInFull") : formatINR(balance)}</td>
                </tr>
              </tbody>
            </table>
            <p className="words">{amountInWords(grand)}</p>
          </div>
        </div>
        {b.below_agreed_reason && (
          <p className="soft">
            {t("belowAgreed")}: {b.below_agreed_reason}
          </p>
        )}

        <div className="bill-foot">
          {b.header?.terms?.length > 0 && (
            <section className="terms-box">
              <h2 className="terms-title">{t("terms")}</h2>
              <ol className="terms">
                {b.header.terms.map((term, i) => (
                  <li key={i}>{term}</li>
                ))}
              </ol>
            </section>
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
  group,
  items,
  cols,
  pharmacy,
  showDate,
  showDisc,
  hasTax,
  t,
}: {
  group: string;
  items: BillItem[];
  cols: number;
  pharmacy: boolean;
  showDate: boolean;
  showDisc: boolean;
  hasTax: boolean;
  t: Awaited<ReturnType<typeof getTranslations<"printBill">>>;
}) {
  const subtotal = items.reduce((s, i) => s + i.total_paise, 0);
  return (
    <>
      {group && (
        <tr className="group">
          <td colSpan={cols}>{group}</td>
        </tr>
      )}
      {items.map((i) => {
        // Medicine details (and SAC codes) under the name instead of extra columns. A medicine
        // carried into a final bill keeps its HSN · batch · expiry.
        const details = pharmacy || i.pharmacy_item_id
          ? [
              i.hsn_sac && `${t("hsn")} ${i.hsn_sac}`,
              i.batch_no && `${t("batch")} ${i.batch_no}`,
              i.expiry_date && `${t("expiry")} ${formatDate(new Date(i.expiry_date)).slice(3)}`,
              i.mfg,
            ]
          : [i.hsn_sac && `${t("sac")} ${i.hsn_sac}`];
        const sub = [...details, i.kind === "carried_in" ? t("carriedFrom", { no: i.carried_from_bill_no ?? "" }) : null].filter(Boolean).join("  ·  ");
        return (
          <tr key={i.id}>
            <td className="num idx">{i.line_no}</td>
            <td>
              <div className="item-name">{i.description}</div>
              {sub && <div className="item-sub">{sub}</div>}
            </td>
            {showDate && <td className="nowrap">{i.service_date ? formatDate(new Date(i.service_date)) : ""}</td>}
            <td className="num">{Number(i.qty)}</td>
            <td className="num">{money(i.rate_paise)}</td>
            {showDisc && <td className="num">{discountText(i)}</td>}
            {hasTax && <td className="num">{i.gst_rate_bp > 0 ? gstText(i.gst_rate_bp) : "—"}</td>}
            <td className="num">{money(i.total_paise)}</td>
          </tr>
        );
      })}
      {group && (
        <tr className="subtotal">
          <td colSpan={cols - 1} className="num">
            {t("subtotal", { group })}
          </td>
          <td className="num">{money(subtotal)}</td>
        </tr>
      )}
    </>
  );
}
