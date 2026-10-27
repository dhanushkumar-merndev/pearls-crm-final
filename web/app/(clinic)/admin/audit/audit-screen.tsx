"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, istDayStart } from "@pearl/shared";
import { Field, PageHeader, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { Page, useAdminBack } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR, wrapText } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";

interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  table_name: string;
  row_id: string;
  action: "insert" | "update" | "delete";
  changes: Record<string, [unknown, unknown]>;
  reason: string | null;
}

// Tables with an audit trigger. Later phases add theirs here.
const AUDITED = [
  "staff", "clinic_settings", "app_settings", "number_series", "doctors", "doctor_schedules", "doctor_leaves",
  "holidays", "services", "treatment_templates", "room_types", "pharmacy_items", "lookup_values",
] as const;

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Who changed what and when (newest first). Only changed fields are stored. */
export function AuditScreen() {
  const adminBack = useAdminBack();
  const t = useTranslations("audit");
  const c = useTranslations("common");
  const v = useTranslations("validation");
  const [table, setTable] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Both dates are optional here; when both are given, To can't be before From.
  const orderBad = Boolean(from && to && to < from);
  const list = useInfiniteQuery({
    enabled: !orderBad,
    queryKey: ["audit", table, from, to],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: AuditRow[]; next_cursor: string | null }>("audit_list", {
        p_table: table || null,
        p_from: from ? istDayStart(from).toISOString() : null,
        p_to: to ? new Date(istDayStart(to).getTime() + 86_400_000).toISOString() : null,
        p_cursor: pageParam ? Number(pageParam) : null,
        p_limit: 50,
      }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader back={adminBack} title={t("title")} description={t("description")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("what")}>
          {(a) => (
            <Select {...a} value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">{t("everything")}</option>
              {AUDITED.map((name) => (
                <option key={name} value={name}>
                  {t(`table.${name}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("from")}>{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t("to")} error={orderBad ? v("dateOrder") : undefined}>{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>{t("when")}</TH>
            <TH>{t("who")}</TH>
            <TH>{t("what")}</TH>
            <TH>{t("changes")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={4} />}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{c("empty")}</EmptyRow>}
          {items.map((row) => (
            <TR key={row.id} className="align-top">
              <TD className="whitespace-nowrap">{formatDateTime(new Date(row.at))}</TD>
              <TD>{row.actor ?? t("system")}</TD>
              <TD>
                {(AUDITED as readonly string[]).includes(row.table_name) ? t(`table.${row.table_name}`) : row.table_name}
                <span className="block text-[0.9rem] text-text-secondary">{t(`action.${row.action}`)}</span>
              </TD>
              <TD className={wrapText}>
                <ul className="flex flex-col gap-1 text-[0.95rem]">
                  {Object.entries(row.changes).slice(0, 12).map(([field, [before, after]]) => (
                    <li key={field} className="break-words">
                      <span className="font-medium">{field}</span>: {row.action === "update" ? `${show(before)} → ${show(after)}` : show(after ?? before)}
                    </li>
                  ))}
                </ul>
                {row.reason && <p className="mt-1 text-[0.9rem] text-text-secondary">{t("reason", { reason: row.reason })}</p>}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </Page>
  );
}
