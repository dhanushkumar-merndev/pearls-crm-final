import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { amountInWords, formatDate, formatINR } from "@pearl/shared";
import type { Quotation } from "@/components/leads/quotations";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getClinic, Letterhead } from "../../../letterhead";
import { PrintToolbar } from "../../../print-toolbar";

export const metadata: Metadata = { title: "Quotation" };
export const dynamic = "force-dynamic";

const money = (p: number) => formatINR(p, { symbol: false });
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

/** A4 quotation for a lead: treatments, discount, total, valid till, note. Clinic from settings. */
export default async function PrintQuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const preview = (await searchParams).preview === "1";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("printQuotation");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("lead_quotation", { p_id: id });
  if (error || !data) notFound();
  const q = data as Quotation;
  const clinic = await getClinic();

  return (
    <>
      {!preview && <PrintToolbar />}
      <div className="sheet bill">
        <Letterhead clinic={clinic} />
        <div className="bill-head">
          <div className="doc-title">{t("title")}</div>
          <dl className="bill-ref">
            <div>
              <dt>{t("number")}</dt>
              <dd>
                Q-{q.lead_sl_no ?? "—"}-{q.quote_no}
              </dd>
            </div>
            <div>
              <dt>{t("date")}</dt>
              <dd>{formatDate(new Date(q.created_at))}</dd>
            </div>
          </dl>
        </div>

        <div className="parties">
          <section>
            <div className="label">{t("for")}</div>
            <div className="patient-name">{q.lead_name}</div>
            <div>{q.lead_phone}</div>
          </section>
          <dl className="facts">
            <div>
              <dt>{t("validTill")}</dt>
              <dd>{q.valid_until ? formatDate(day(q.valid_until)) : "—"}</dd>
            </div>
            <div>
              <dt>{t("preparedBy")}</dt>
              <dd>{q.created_by_name ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <table className="items">
          <thead>
            <tr>
              <th className="num idx">#</th>
              <th>{t("treatment")}</th>
              <th className="num">{t("qty")}</th>
              <th className="num">{t("rate")}</th>
              <th className="num">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((i, n) => (
              <tr key={n}>
                <td className="num idx">{n + 1}</td>
                <td>{i.name}</td>
                <td className="num">{i.qty}</td>
                <td className="num">{money(i.price_paise)}</td>
                <td className="num">{money(i.qty * i.price_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="summary">
          <div className="summary-left">{q.note && <p className="soft" style={{ whiteSpace: "pre-wrap" }}>{q.note}</p>}</div>
          <div className="summary-right">
            <table className="totals">
              <tbody>
                <tr>
                  <td>{t("subtotal")}</td>
                  <td>{formatINR(q.subtotal_paise)}</td>
                </tr>
                {q.discount_paise > 0 && (
                  <tr>
                    <td>{t("discount")}</td>
                    <td>−{formatINR(q.discount_paise)}</td>
                  </tr>
                )}
                <tr className="grand">
                  <td>{t("total")}</td>
                  <td>{formatINR(q.total_paise)}</td>
                </tr>
              </tbody>
            </table>
            <p className="words">{amountInWords(q.total_paise)}</p>
          </div>
        </div>
        <p className="soft">{t("footer")}</p>
      </div>
    </>
  );
}
