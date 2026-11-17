"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import type { BillStatus } from "@/components/bills/types";
import { ClearFilters } from "@/components/ui/filter-bar";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Field, Select } from "@/components/ui/form";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface Row {
  id: string;
  bb_no: string | null;
  status: BillStatus;
  bill_date: string;
  created_at: string;
  total_paise: number;
  billed_ref_paise: number;
  patient_id: string;
  patient: string;
  uhid: string;
  insurer: string | null;
  treatment: string | null;
  ip_number: string | null;
}
interface Page {
  total: number;
  sum_paise: number;
  rows: Row[];
}
const LIMIT = 25;
const startFilters = () => ({ from: istDateString(new Date(Date.now() - 30 * 86_400_000)), to: istDateString(new Date()), status: "" });

/** Breakdown bills (insurance), 3rd billing section. With patientId: that patient's, all dates. */
export function BreakdownTable({ patientId }: { patientId?: string }) {
  const t = useTranslations("breakdown");
  const tb = useTranslations("bill");
  const ts = useTranslations("bills");
  const dp = useTranslations("datePicker");
  const [filters, setFilters] = useState(startFilters);
  const start = startFilters();
  const [offset, setOffset] = useState(0);
  const rangeCheck = useDateRangeCheck(filters.from, filters.to);
  const list = useQuery({
    enabled: Boolean(patientId) || rangeCheck.valid,
    queryKey: ["breakdown_bills", patientId ?? "all", filters, offset],
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<Page>("breakdown_bills_table", {
        p_filters: { ...(patientId ? { patient_id: patientId } : { from: filters.from, to: filters.to }), ...(filters.status ? { status: filters.status } : {}) },
        p_offset: offset,
        p_limit: LIMIT,
      }),
  });
  const cols = patientId ? 6 : 7;
  return (
    <div className="flex flex-col gap-3" data-testid="breakdown-table">
      <div className="flex flex-wrap items-end gap-3">
        {!patientId && (
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
        )}
        <Field label={ts("status")}>
          {(a) => (
            <Select {...a} value={filters.status} onChange={(e) => (setFilters((f) => ({ ...f, status: e.target.value })), setOffset(0))}>
              <option value="">{ts("all")}</option>
              {(["draft", "finalized", "cancelled"] as const).map((x) => (
                <option key={x} value={x}>
                  {tb(`status.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ClearFilters
          show={(Object.keys(start) as (keyof typeof start)[]).some((k) => filters[k] !== start[k])}
          onClear={() => (setFilters(startFilters()), setOffset(0))}
        />
      </div>
      {list.isError && <p className="text-bad-text">{ts("rangeTooWide")}</p>}
      {list.data && !patientId && <p className="text-text-secondary">{ts("sum", { n: list.data.total, amount: formatINR(list.data.sum_paise) })}</p>}
      <Table>
        <THead>
          <tr>
            <TH>{t("list.no")}</TH>
            <TH>{t("list.date")}</TH>
            {!patientId && <TH>{t("list.patient")}</TH>}
            <TH>{t("list.for")}</TH>
            <TH>{t("list.insurer")}</TH>
            <TH>{t("list.status")}</TH>
            <TH className="text-right">{t("list.total")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={cols} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={cols}>{t("none")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/breakdown/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.bb_no ?? t("draft")}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(new Date(r.bill_date))}</TD>
              {!patientId && (
                <TD>
                  <Link href={`/patients/${r.patient_id}?tab=bills&section=breakdown`} className="text-link underline-offset-4 hover:underline">
                    {r.patient}
                  </Link>
                  <span className="block text-[0.9rem] text-text-secondary">{r.uhid}</span>
                </TD>
              )}
              <TD className="text-[0.9rem]">
                {[r.treatment, r.ip_number && t("ipStay", { ip: r.ip_number })].filter(Boolean).join(" · ") || <span className="text-text-secondary">—</span>}
              </TD>
              <TD className="text-[0.9rem]">{r.insurer ?? <span className="text-text-secondary">—</span>}</TD>
              <TD>
                <StatusBadge kind={r.status === "finalized" ? "good" : r.status === "draft" ? "warning" : "critical"} label={tb(`status.${r.status}`)} />
              </TD>
              <TD className="text-right tabular-nums">{formatINR(r.total_paise)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}
