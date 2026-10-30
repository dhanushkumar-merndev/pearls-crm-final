"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import { ClearFilters } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface Row {
  id: string;
  invoice_no: string;
  invoice_date: string;
  status: "draft" | "posted";
  total_paise: number;
  supplier: string;
}
interface Page {
  total: number;
  sum_paise: number;
  rows: Row[];
}
const LIMIT = 25;

/** Supplier invoices by date (range ≤ 1 year), offset paging with an exact count. */
export function PurchasesTable() {
  const t = useTranslations("pharmacy");
  const startFilters = () => ({ from: istDateString(new Date(Date.now() - 90 * 86_400_000)), to: istDateString(new Date()), status: "" });
  const [filters, setFilters] = useState(startFilters);
  const start = startFilters();
  const [offset, setOffset] = useState(0);
  const rangeCheck = useDateRangeCheck(filters.from, filters.to);
  const list = useQuery({
    enabled: rangeCheck.valid,
    queryKey: ["purchases", filters, offset],
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<Page>("purchases_table", {
        p_filters: { from: filters.from, to: filters.to, ...(filters.status ? { status: filters.status } : {}) },
        p_offset: offset,
        p_limit: LIMIT,
      }),
  });
  const set = (k: keyof typeof filters, v: string) => (setFilters((f) => ({ ...f, [k]: v })), setOffset(0));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("from")} error={rangeCheck.fromError}>{(a) => <Input {...a} type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />}</Field>
        <Field label={t("to")} error={rangeCheck.toError}>{(a) => <Input {...a} type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />}</Field>
        <Field label={t("col.status")}>
          {(a) => (
            <Select {...a} value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">{t("view.all")}</option>
              <option value="draft">{t("purchaseStatus.draft")}</option>
              <option value="posted">{t("purchaseStatus.posted")}</option>
            </Select>
          )}
        </Field>
        <ClearFilters
          show={filters.from !== start.from || filters.to !== start.to || !!filters.status}
          onClear={() => (setFilters(startFilters()), setOffset(0))}
        />
      </div>
      {list.isError && <p className="text-bad-text">{t("rangeTooWide")}</p>}
      {list.data && <p className="text-text-secondary">{t("purchaseSum", { n: list.data.total, amount: formatINR(list.data.sum_paise) })}</p>}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.invoice")}</TH>
            <TH>{t("col.date")}</TH>
            <TH>{t("col.supplier")}</TH>
            <TH>{t("col.status")}</TH>
            <TH className="text-right">{t("col.total")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={5} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={5}>{t("noPurchases")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/pharmacy/purchases/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.invoice_no}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(new Date(`${r.invoice_date}T00:00:00+05:30`))}</TD>
              <TD>{r.supplier}</TD>
              <TD>
                <StatusBadge kind={r.status === "posted" ? "good" : "warning"} label={t(`purchaseStatus.${r.status}`)} />
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
