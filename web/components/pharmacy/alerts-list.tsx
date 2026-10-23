"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, Select } from "@/components/ui/form";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { expiryLabel, qtyLabel } from "./format";

interface Row {
  id: string;
  alert: "low" | "near_expiry" | "expired";
  threshold_days: number;
  detail: { on_hand?: number; reorder_level?: number };
  item_id: string;
  item: string;
  strength: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  qty_on_hand: number | null;
}
interface Page {
  total: number;
  counts: Record<Row["alert"], number>;
  rows: Row[];
}
const LIMIT = 25;

/** Open alerts: expired first, then nearest expiry, then low stock. They clear themselves. */
export function AlertsList() {
  const t = useTranslations("pharmacy");
  const c = useTranslations("common");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const list = useQuery({
    queryKey: ["pharmacy_alerts", type, offset],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Page>("pharmacy_alerts", { p_type: type || null, p_offset: offset, p_limit: LIMIT }),
  });
  const counts = list.data?.counts;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("alertType")} className="max-w-xs">
        {(a) => (
          <Select {...a} value={type} onChange={(e) => (setType(e.target.value), setOffset(0))}>
            <option value="">{t("view.all")}</option>
            {(["expired", "near_expiry", "low"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`alert.${x}`)} {counts ? `(${counts[x]})` : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Table>
        <THead>
          <tr>
            <TH>{t("col.alert")}</TH>
            <TH>{t("col.medicine")}</TH>
            <TH>{t("col.batch")}</TH>
            <TH className="text-right">{t("col.onHand")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={4}>{t("noAlerts")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <StatusBadge
                  kind={r.alert === "expired" ? "critical" : "warning"}
                  label={r.alert === "near_expiry" ? t("alert.within", { days: r.threshold_days }) : t(`alert.${r.alert}`)}
                />
              </TD>
              <TD>
                <Link href={`/pharmacy/items/${r.item_id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.item}
                </Link>
                {r.strength && <span className="block text-[0.85rem] text-text-secondary">{r.strength}</span>}
              </TD>
              <TD className="tabular-nums">{r.batch_no ? `${r.batch_no} · ${expiryLabel(r.expiry_date)}` : t("reorderAt", { n: qtyLabel(r.detail.reorder_level) })}</TD>
              <TD className="text-right tabular-nums">{qtyLabel(r.qty_on_hand ?? r.detail.on_hand)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}
