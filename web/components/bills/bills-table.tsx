"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import { ClearFilters } from "@/components/ui/filter-bar";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadExcel } from "@/lib/excel";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useDateRangeCheck } from "@/lib/use-date-range";
import { useBillForLabel, type BillFor } from "./bill-for";
import type { BillStatus, BillType } from "./types";

interface Row {
  id: string;
  bill_type: BillType;
  bill_no: string | null;
  status: BillStatus;
  bill_at: string | null;
  created_at: string;
  total_paise: number;
  received_paise: number;
  patient_id: string;
  patient: string;
  uhid: string;
  /** What the bill is for (treatment session, visit, IP stay). */
  for?: BillFor;
}
interface Summary {
  billed_paise: number;
  received_paise: number;
  due_paise: number;
  drafts: number;
  cancelled: number;
  by_type: { bill_type: BillType; count: number; billed_paise: number; received_paise: number }[];
  by_mode: { mode: string; received_paise: number }[];
}
interface Page {
  total: number;
  sum_paise: number;
  /** Finalized bills the filters pick: billed / received / due, by type and by payment mode. */
  summary?: Summary;
  rows: Row[];
}
const LIMIT = 25;

/** Bills with filters and offset paging (exact count). With patientId: that patient's bills, all dates. */
/** The last 30 days, every type and status. */
function startFilters() {
  return { from: istDateString(new Date(Date.now() - 30 * 86_400_000)), to: istDateString(new Date()), status: "", bill_type: "" };
}

export function BillsTable({ patientId }: { patientId?: string }) {
  const t = useTranslations("bills");
  const b = useTranslations("bill");
  const dp = useTranslations("datePicker");
  const forLabel = useBillForLabel();
  const { failed } = useFeedback();
  const [filters, setFilters] = useState(startFilters);
  const start = startFilters();
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const args = (o: number, limit: number) => ({
    p_filters: {
      ...(patientId ? { patient_id: patientId } : { from: filters.from, to: filters.to }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.bill_type ? { bill_type: filters.bill_type } : {}),
    },
    p_offset: o,
    p_limit: limit,
  });
  const rangeCheck = useDateRangeCheck(filters.from, filters.to);
  const list = useQuery({
    enabled: Boolean(patientId) || rangeCheck.valid,
    queryKey: ["bills", patientId ?? "all", filters, offset],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Page>("bills_table", args(offset, LIMIT)),
  });
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };

  async function exportExcel() {
    setExporting(true);
    try {
      const rows: Row[] = [];
      for (let o = 0; ; o += 100) {
        const page = await rpc<Page>("bills_table", args(o, 100));
        rows.push(...page.rows);
        if (rows.length >= page.total || page.rows.length === 0) break;
      }
      await downloadExcel(
        `bills-${filters.from}-to-${filters.to}.xlsx`,
        [t("col.no"), t("col.date"), t("col.type"), t("col.patient"), "UHID", t("col.for"), t("col.status"), t("col.total"), t("col.received"), t("col.balance")],
        rows.map((r) => [
          r.bill_no ?? "",
          formatDate(new Date(r.bill_at ?? r.created_at)),
          b(`type.${r.bill_type}`),
          r.patient,
          r.uhid,
          forLabel(r.for) ?? "",
          b(`status.${r.status}`),
          r.total_paise / 100,
          r.received_paise / 100,
          (r.status === "finalized" ? r.total_paise - r.received_paise : 0) / 100,
        ]),
      );
    } catch (e) {
      failed(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {!patientId && (
          <>
            <Field label={dp("dates")} error={rangeCheck.fromError ?? rangeCheck.toError}>
              {(a) => (
                <DateRangePicker
                  {...a}
                  value={{ from: filters.from, to: filters.to }}
                  onChange={(r) => (setFilters((f) => ({ ...f, ...r })), setOffset(0))}
                  clearTo={{ from: start.from, to: start.to }}
                />
              )}
            </Field>
          </>
        )}
        <Field label={t("type")}>
          {(a) => (
            <Select {...a} value={filters.bill_type} onChange={(e) => set("bill_type", e.target.value)}>
              <option value="">{t("all")}</option>
              {(["procedure_receipt", "pharmacy_invoice", "final_bill"] as const).map((x) => (
                <option key={x} value={x}>
                  {b(`type.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("status")}>
          {(a) => (
            <Select {...a} value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">{t("all")}</option>
              {(["draft", "finalized", "cancelled"] as const).map((x) => (
                <option key={x} value={x}>
                  {b(`status.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ClearFilters
          show={(Object.keys(start) as (keyof typeof start)[]).some((k) => filters[k] !== start[k])}
          onClear={() => (setFilters(startFilters()), setOffset(0))}
        />
        {!patientId && (
          <Button variant="secondary" disabled={exporting || !list.data?.total} onClick={() => void exportExcel()}>
            <Download aria-hidden />
            {exporting ? t("exporting") : t("export")}
          </Button>
        )}
      </div>
      {list.isError && <p className="text-bad-text">{t("rangeTooWide")}</p>}
      {list.data && !patientId && <p className="text-text-secondary">{t("sum", { n: list.data.total, amount: formatINR(list.data.sum_paise) })}</p>}
      {list.data?.summary && !patientId && <BillsSummary summary={list.data.summary} />}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.no")}</TH>
            <TH>{t("col.date")}</TH>
            {!patientId && <TH>{t("col.patient")}</TH>}
            <TH>{t("col.for")}</TH>
            <TH>{t("col.status")}</TH>
            <TH className="text-right">{t("col.total")}</TH>
            <TH className="text-right">{t("col.balance")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={7} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={7}>{t("none")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/bills/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.bill_no ?? t("draft")}
                </Link>
                <span className="block text-[0.9rem] text-text-secondary">{b(`type.${r.bill_type}`)}</span>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(new Date(r.bill_at ?? r.created_at))}</TD>
              {!patientId && (
                <TD>
                  <Link href={`/patients/${r.patient_id}`} className="text-link underline-offset-4 hover:underline">
                    {r.patient}
                  </Link>
                  <span className="block text-[0.9rem] text-text-secondary">{r.uhid}</span>
                </TD>
              )}
              <TD className="text-[0.9rem]">{forLabel(r.for) ?? <span className="text-text-secondary">—</span>}</TD>
              <TD>
                <StatusBadge kind={r.status === "finalized" ? "good" : r.status === "draft" ? "warning" : "critical"} label={b(`status.${r.status}`)} />
              </TD>
              <TD className="text-right tabular-nums">{formatINR(r.total_paise)}</TD>
              <TD className="text-right tabular-nums">{r.status === "finalized" ? formatINR(r.total_paise - r.received_paise) : "—"}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}

/** The breakdown above the list (owner, 03/11/2026): billed, received, due; by bill type; by payment mode. */
function BillsSummary({ summary: s }: { summary: Summary }) {
  const t = useTranslations("bills");
  const b = useTranslations("bill");
  const notFinal = [s.drafts > 0 && t("drafts", { n: s.drafts }), s.cancelled > 0 && t("cancelledCount", { n: s.cancelled })].filter(Boolean).join(" · ");
  return (
    <section aria-label={t("summaryTitle")} className="flex flex-col gap-3" data-testid="bills-summary">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t("billed")} value={formatINR(s.billed_paise)} hint={notFinal || t("finalizedOnly")} />
        <StatTile label={t("received")} value={formatINR(s.received_paise)} />
        <StatTile label={t("balanceDue")} value={formatINR(s.due_paise)} tone={s.due_paise > 0 ? "warning" : undefined} />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <CardTitle>{t("byType")}</CardTitle>
          {s.by_type.length === 0 ? (
            <p className="text-text-secondary">{t("none")}</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t("col.type")}</TH>
                  <TH className="text-right">{t("billed")}</TH>
                  <TH className="text-right">{t("received")}</TH>
                  <TH className="text-right">{t("balanceDue")}</TH>
                </tr>
              </THead>
              <tbody>
                {s.by_type.map((r) => (
                  <TR key={r.bill_type} data-testid={`by-type-${r.bill_type}`}>
                    <TD>
                      {b(`type.${r.bill_type}`)} <span className="text-text-secondary">· {t("billCount", { n: r.count })}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatINR(r.billed_paise)}</TD>
                    <TD className="text-right tabular-nums">{formatINR(r.received_paise)}</TD>
                    <TD className="text-right tabular-nums">{formatINR(Math.max(r.billed_paise - r.received_paise, 0))}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="flex flex-col gap-2">
          <CardTitle>{t("byMode")}</CardTitle>
          {s.by_mode.length === 0 ? (
            <p className="text-text-secondary">{t("noPaymentsYet")}</p>
          ) : (
            <ul className="flex flex-col gap-1 tabular-nums">
              {s.by_mode.map((m) => (
                <li key={m.mode} className="flex justify-between gap-3">
                  <span>{m.mode}</span>
                  <span>{formatINR(m.received_paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
