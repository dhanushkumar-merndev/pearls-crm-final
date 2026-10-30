"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { useDebounced } from "@/components/library-combobox";
import { ClearFilters } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { expiryLabel, qtyLabel } from "./format";

interface Row {
  id: string;
  name: string;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  sell_unit: string;
  rack: string | null;
  reorder_level: number;
  on_hand: number;
  expired_qty: number;
  expiring_qty: number;
  next_expiry: string | null;
  value_paise: number;
}
interface Page {
  total: number;
  value_paise: number;
  rows: Row[];
}
const LIMIT = 25;
const VIEWS = ["all", "in_stock", "low", "expiring", "expired"] as const;

/** Every medicine with its stock (unexpired), next expiry and value at cost. */
export function StockTable() {
  const t = useTranslations("pharmacy");
  const [q, setQ] = useState("");
  const [view, setView] = useState<(typeof VIEWS)[number]>("all");
  const [offset, setOffset] = useState(0);
  const search = useDebounced(q.trim(), 300);
  const list = useQuery({
    queryKey: ["stock_table", search, view, offset],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Page>("stock_table", { p_filters: { q: search, view }, p_offset: offset, p_limit: LIMIT }),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("search")} className="min-w-64 flex-1">
          {(a) => <Input {...a} type="search" value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} />}
        </Field>
        <Field label={t("show")}>
          {(a) => (
            <Select {...a} value={view} onChange={(e) => (setView(e.target.value as typeof view), setOffset(0))}>
              {VIEWS.map((v) => (
                <option key={v} value={v}>
                  {t(`view.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ClearFilters show={!!q || view !== "all"} onClear={() => (setQ(""), setView("all"), setOffset(0))} />
      </div>
      {list.data && <p className="text-text-secondary">{t("stockSum", { n: list.data.total, amount: formatINR(list.data.value_paise) })}</p>}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.medicine")}</TH>
            <TH className="text-right">{t("col.onHand")}</TH>
            <TH>{t("col.nextExpiry")}</TH>
            <TH>{t("col.status")}</TH>
            <TH className="text-right">{t("col.value")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={5} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={5}>{t("noItems")}</EmptyRow>}
          {list.data?.rows.map((r) => {
            const low = r.reorder_level > 0 && r.on_hand <= r.reorder_level;
            return (
              <TR key={r.id}>
                <TD>
                  <Link href={`/pharmacy/items/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                  <span className="block text-[0.9rem] text-text-secondary">
                    {[r.strength, r.form, r.manufacturer, r.rack && t("rackLabel", { rack: r.rack })].filter(Boolean).join(" · ")}
                  </span>
                </TD>
                <TD className="text-right tabular-nums">
                  {qtyLabel(r.on_hand)} <span className="text-text-secondary">{r.sell_unit}</span>
                </TD>
                <TD className="tabular-nums">{expiryLabel(r.next_expiry)}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {r.expired_qty > 0 && <StatusBadge kind="critical" label={t("badge.expired", { n: qtyLabel(r.expired_qty) })} />}
                    {r.expiring_qty > 0 && <StatusBadge kind="warning" label={t("badge.expiring", { n: qtyLabel(r.expiring_qty) })} />}
                    {low && <StatusBadge kind="warning" label={t("badge.low")} />}
                    {!low && r.expired_qty === 0 && r.expiring_qty === 0 && r.on_hand > 0 && <StatusBadge kind="good" label={t("badge.ok")} />}
                  </div>
                </TD>
                <TD className="text-right tabular-nums">{formatINR(r.value_paise)}</TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}
