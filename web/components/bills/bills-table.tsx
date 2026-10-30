"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import { ClearFilters } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadExcel } from "@/lib/excel";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useDateRangeCheck } from "@/lib/use-date-range";
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
}
interface Page {
  total: number;
  sum_paise: number;
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
        [t("col.no"), t("col.date"), t("col.type"), t("col.patient"), "UHID", t("col.status"), t("col.total"), t("col.received"), t("col.balance")],
        rows.map((r) => [
          r.bill_no ?? "",
          formatDate(new Date(r.bill_at ?? r.created_at)),
          b(`type.${r.bill_type}`),
          r.patient,
          r.uhid,
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
            <Field label={t("from")} error={rangeCheck.fromError}>{(a) => <Input {...a} type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />}</Field>
            <Field label={t("to")} error={rangeCheck.toError}>{(a) => <Input {...a} type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />}</Field>
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
      <Table>
        <THead>
          <tr>
            <TH>{t("col.no")}</TH>
            <TH>{t("col.date")}</TH>
            {!patientId && <TH>{t("col.patient")}</TH>}
            <TH>{t("col.status")}</TH>
            <TH className="text-right">{t("col.total")}</TH>
            <TH className="text-right">{t("col.balance")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={6} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={6}>{t("none")}</EmptyRow>}
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
