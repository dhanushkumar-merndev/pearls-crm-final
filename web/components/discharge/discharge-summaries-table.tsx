"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, istDateString } from "@pearl/shared";
import type { BillStatus } from "@/components/bills/types";
import { Button } from "@/components/ui/button";
import { ClearFilters } from "@/components/ui/filter-bar";
import { DateRangePicker } from "@/components/ui/date-picker";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { pickPatientStaySchema } from "@/lib/schemas/billing";
import { useDateRangeCheck } from "@/lib/use-date-range";
import { useZodForm } from "@/lib/use-zod-form";
import { StartSummaryDialog } from "./start-summary-dialog";

interface Row {
  id: string;
  status: BillStatus;
  created_at: string;
  finalized_at: string | null;
  patient_id: string;
  patient: string;
  uhid: string;
  kind: "ip" | "op";
  admission_id: string | null;
  ip_number: string | null;
  admitted_at: string | null;
  discharged_at: string | null;
  procedures: string[] | null;
}
interface Page {
  total: number;
  rows: Row[];
}
const LIMIT = 25;
const startFilters = () => ({ from: istDateString(new Date(Date.now() - 30 * 86_400_000)), to: istDateString(new Date()), status: "" });

/** Discharge summaries, 4th billing section. With patientId: that patient's, all dates. */
export function DischargeSummariesTable({ patientId }: { patientId?: string }) {
  const t = useTranslations("dischargeList");
  const tb = useTranslations("bill");
  const ts = useTranslations("bills");
  const dp = useTranslations("datePicker");
  const [filters, setFilters] = useState(startFilters);
  const start = startFilters();
  const [offset, setOffset] = useState(0);
  const rangeCheck = useDateRangeCheck(filters.from, filters.to);
  const list = useQuery({
    enabled: Boolean(patientId) || rangeCheck.valid,
    queryKey: ["discharge_summaries", patientId ?? "all", filters, offset],
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<Page>("discharge_summaries_table", {
        p_filters: { ...(patientId ? { patient_id: patientId } : { from: filters.from, to: filters.to }), ...(filters.status ? { status: filters.status } : {}) },
        p_offset: offset,
        p_limit: LIMIT,
      }),
  });
  const cols = patientId ? 3 : 4;
  return (
    <div className="flex flex-col gap-3" data-testid="discharge-table">
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
      <Table>
        <THead>
          <tr>
            <TH>{t("date")}</TH>
            {!patientId && <TH>{t("patient")}</TH>}
            <TH>{t("for")}</TH>
            <TH>{t("status")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={cols} />}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={cols}>{t("none")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap">
                <Link href={`/discharge/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {formatDate(new Date(r.finalized_at ?? r.created_at))}
                </Link>
              </TD>
              {!patientId && (
                <TD>
                  <Link href={`/patients/${r.patient_id}?tab=bills&section=discharge`} className="text-link underline-offset-4 hover:underline">
                    {r.patient}
                  </Link>
                  <span className="block text-[0.9rem] text-text-secondary">{r.uhid}</span>
                </TD>
              )}
              <TD className="text-[0.9rem]">
                {r.ip_number && t("ipStay", { ip: r.ip_number })}
                {r.procedures?.length ? <span className="block text-text-secondary">{r.procedures.join(", ")}</span> : null}
              </TD>
              <TD>
                <StatusBadge kind={r.status === "finalized" ? "good" : r.status === "draft" ? "warning" : "critical"} label={tb(`status.${r.status}`)} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}

interface StayRow {
  id: string;
  ip_number: string;
  status: string;
  admitted_at: string;
}

/**
 * New discharge summary from the Bills tab: choose the patient's IP stay, then the template. A stay
 * that already has one opens it instead (one summary per stay).
 */
export function NewSummaryDialog({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const t = useTranslations("dischargeList.new");
  const router = useRouter();
  const checks = useZodForm(pickPatientStaySchema);
  const stays = useQuery({
    queryKey: ["admissions", "patient", patientId],
    queryFn: () => rpc<{ rows: StayRow[] }>("admissions_table", { p_filters: { patient_id: patientId }, p_limit: 20 }),
  });
  const summaries = useQuery({
    queryKey: ["discharge_summaries", patientId, "all-for-new"],
    queryFn: () => rpc<Page>("discharge_summaries_table", { p_filters: { patient_id: patientId }, p_limit: 100 }),
  });
  const open = (stays.data?.rows ?? []).filter((s) => s.status !== "cancelled");
  const existing = new Map((summaries.data?.rows ?? []).filter((r) => r.status !== "cancelled" && r.admission_id).map((r) => [r.admission_id!, r.id]));
  const [stay, setStay] = useState("");
  const [next, setNext] = useState<string | null>(null);
  if (next) return <StartSummaryDialog admissionId={next} />;
  return (
    <DialogContent
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button
            disabled={stays.isPending || summaries.isPending || open.length === 0}
            onClick={() => {
              const d = checks.validate({ stay });
              if (!d) return;
              const has = existing.get(d.stay);
              if (has) router.push(`/discharge/${has}`);
              else setNext(d.stay);
            }}
          >
            <ArrowRight aria-hidden />
            {t("next")}
          </Button>
        </>
      }
    >
      {!stays.isPending && open.length === 0 ? (
        <p className="text-text-secondary">{t("noStays")}</p>
      ) : (
        <Field label={t("for")} error={checks.error("stay")}>
          {(a) => (
            <Select {...a} value={stay} onChange={(e) => (setStay(e.target.value), checks.clear("stay"))}>
              <option value="" disabled>
                {t("choose")}
              </option>
              {open.map((s) => (
                <option key={s.id} value={s.id}>
                  {existing.has(s.id) ? t("hasSummary", { ip: s.ip_number }) : t("stayOption", { ip: s.ip_number, date: formatDate(new Date(s.admitted_at)) })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </DialogContent>
  );
}
