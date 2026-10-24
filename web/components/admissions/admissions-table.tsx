"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, istDateString } from "@pearl/shared";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";
import type { AdmissionStatus } from "./types";

interface Row {
  id: string;
  ip_number: string;
  status: AdmissionStatus;
  admitted_at: string;
  discharged_at: string | null;
  patient_id: string;
  patient: string;
  uhid: string;
  room: string;
  room_days: number;
  treatment: string | null;
}
const LIMIT = 25;

export const admissionBadge = (s: AdmissionStatus) => (s === "admitted" ? "warning" : s === "discharged" ? "good" : "critical");

/** IP stays: "admitted now" (no date range) or by admission date (≤ 1 year). With patientId: that patient's stays. */
export function AdmissionsTable({ patientId }: { patientId?: string }) {
  const t = useTranslations("ip");
  const c = useTranslations("common");
  const [status, setStatus] = useState<"" | AdmissionStatus>(patientId ? "" : "admitted");
  const [range, setRange] = useState(() => ({ from: istDateString(new Date(Date.now() - 90 * 86_400_000)), to: istDateString(new Date()) }));
  const [offset, setOffset] = useState(0);
  const rangeCheck = useDateRangeCheck(range.from, range.to);
  const list = useQuery({
    enabled: Boolean(patientId) || rangeCheck.valid,
    queryKey: ["admissions", patientId ?? "all", status, range, offset],
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<{ total: number; rows: Row[] }>("admissions_table", {
        p_filters: { ...(patientId ? { patient_id: patientId } : range), ...(status ? { status } : {}) },
        p_offset: offset,
        p_limit: LIMIT,
      }),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("show")}>
          {(a) => (
            <Select {...a} value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setOffset(0))}>
              <option value="admitted">{t("status.admitted")}</option>
              <option value="discharged">{t("status.discharged")}</option>
              <option value="cancelled">{t("status.cancelled")}</option>
              <option value="">{t("all")}</option>
            </Select>
          )}
        </Field>
        {!patientId && status !== "admitted" && (
          <>
            <Field label={t("from")} error={rangeCheck.fromError}>
              {(a) => <Input {...a} type="date" value={range.from} onChange={(e) => (setRange((r) => ({ ...r, from: e.target.value })), setOffset(0))} />}
            </Field>
            <Field label={t("to")} error={rangeCheck.toError}>
              {(a) => <Input {...a} type="date" value={range.to} onChange={(e) => (setRange((r) => ({ ...r, to: e.target.value })), setOffset(0))} />}
            </Field>
          </>
        )}
      </div>
      {list.isError && <p className="text-bad-text">{t("rangeTooWide")}</p>}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.ip")}</TH>
            {!patientId && <TH>{t("col.patient")}</TH>}
            <TH>{t("col.admitted")}</TH>
            <TH>{t("col.room")}</TH>
            <TH className="text-right">{t("col.nights")}</TH>
            <TH>{t("col.status")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={6}>{c("loading")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={6}>{t("none")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/admissions/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.ip_number}
                </Link>
                {r.treatment && <span className="block text-[0.85rem] text-text-secondary">{r.treatment}</span>}
              </TD>
              {!patientId && (
                <TD>
                  <Link href={`/patients/${r.patient_id}`} className="text-link underline-offset-4 hover:underline">
                    {r.patient}
                  </Link>
                  <span className="block text-[0.85rem] text-text-secondary">{r.uhid}</span>
                </TD>
              )}
              <TD className="whitespace-nowrap">{formatDateTime(new Date(r.admitted_at))}</TD>
              <TD>{r.room || "—"}</TD>
              <TD className="text-right tabular-nums">{r.room_days}</TD>
              <TD>
                <StatusBadge kind={admissionBadge(r.status)} label={t(`status.${r.status}`)} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}
