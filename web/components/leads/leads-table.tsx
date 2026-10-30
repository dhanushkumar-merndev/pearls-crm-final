"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Download, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { dateRangeSchema, requiredId, formatDate, formatDateTime, formatINR, fromIstDateTimeLocal, istDateString, istDateTimeLocal } from "@pearl/shared";
import { LibraryCombobox, useDebounced, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadExcel } from "@/lib/excel";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { StageBadge } from "./stage-badge";
import { StageDialog } from "./stage-dialog";
import { LEAD_STAGES, type Lead, type LeadStage } from "./types";
import { useSalesStaff } from "./use-sales-staff";

interface Page {
  total: number;
  rows: Lead[];
}
const LIMIT = 25;
const SORTS = ["lead_date", "sl_no", "name", "stage", "next_followup_at", "last_activity_at", "amount_finalised_paise", "assigned"] as const;
/** Name and next call read best A→Z / soonest first; everything else newest / highest first. */
const defaultDesc = (s: (typeof SORTS)[number]) => s !== "name" && s !== "next_followup_at";
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const bulkAssignSchema = z.object({ to: requiredId() });

/** Managers' leads table: filters, server paging (exact count), inline stage / owner / due date, bulk assign, CSV export. */
export function LeadsTable({ canAssign }: { canAssign: boolean }) {
  const t = useTranslations("leads");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const staff = useSalesStaff();
  const [filters, setFilters] = useState(() => ({
    from: istDateString(new Date(Date.now() - 89 * 86_400_000)),
    to: istDateString(new Date()),
    q: "",
    stage: "",
    assigned_to: "",
    due: "",
  }));
  const [source, setSource] = useState<LibraryItem | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("lead_date");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [stageFor, setStageFor] = useState<{ lead: Lead; stage: LeadStage } | null>(null);
  const [exporting, setExporting] = useState(false);
  const q = useDebounced(filters.q.trim(), 300);
  // The date filter is checked as it changes; an impossible range shows a message and loads nothing.
  const range = dateRangeSchema.safeParse({ from: filters.from, to: filters.to });
  const rangeChecks = useZodForm(dateRangeSchema);
  const bulkChecks = useZodForm(bulkAssignSchema);

  const pFilters = {
    from: filters.from,
    to: filters.to,
    ...(q ? { q } : {}),
    ...(filters.stage ? { stages: [filters.stage] } : {}),
    ...(filters.assigned_to ? { assigned_to: filters.assigned_to } : {}),
    ...(filters.due ? { due: filters.due } : {}),
    ...(source ? { source_ids: [source.id] } : {}),
  };
  const list = useQuery({
    queryKey: ["leads_table", pFilters, sort, desc, offset],
    enabled: range.success,
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<Page>("leads_table", { p_filters: pFilters, p_sort: sort, p_desc: desc, p_offset: offset, p_limit: LIMIT }),
  });
  const set = (k: keyof typeof filters, v: string) => {
    const next = { ...filters, [k]: v };
    setFilters(next);
    setOffset(0);
    setSelected([]);
    if (k === "from" || k === "to") rangeChecks.validate({ from: next.from, to: next.to });
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["leads_table"] });
    void queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
  };

  const assign = useMutation({
    mutationFn: (args: { ids: string[]; to: string }) => rpc<number>("assign_leads", { p_ids: args.ids, p_to: args.to }),
    onSuccess: (n) => {
      saved(t("assigned", { n }));
      setSelected([]);
      refresh();
    },
    onError: failed,
  });
  const setDue = useMutation({
    mutationFn: (args: { lead: Lead; at: string | null }) =>
      rpc<Lead>("update_lead", { p_id: args.lead.id, p_patch: { next_followup_at: args.at }, p_version: args.lead.version }),
    onSuccess: () => (saved(t("dueSaved")), refresh()),
    onError: (e) => (failed(e), refresh()),
  });

  async function exportExcel() {
    setExporting(true);
    try {
      const rows: Record<string, unknown>[] = [];
      let cursor: number | null = null;
      do {
        const page: { rows: Record<string, unknown>[]; next_cursor: number | null } = await rpc("leads_export", { p_filters: pFilters, p_cursor: cursor });
        rows.push(...page.rows);
        cursor = page.next_cursor;
      } while (cursor !== null && rows.length < 50_000);
      const cols = ["sl_no", "lead_date", "name", "phone", "alt_phone", "email", "treatment", "source", "assigned", "doctor", "referred_by",
        "stage", "lost_reason", "next_followup_at", "amount_quoted_paise", "amount_finalised_paise", "comments1", "comments2", "uhid"] as const;
      const cell = (k: (typeof cols)[number], v: unknown): string | number => {
        if (v === null || v === undefined) return "";
        if (k === "amount_quoted_paise" || k === "amount_finalised_paise") return Number(v) / 100;
        if (k === "lead_date") return formatDate(day(String(v)));
        if (k === "next_followup_at") return formatDateTime(new Date(String(v)));
        if (k === "stage") return t(`stage.${v as LeadStage}`);
        return typeof v === "number" ? v : String(v);
      };
      await downloadExcel(
        `leads-${filters.from}-to-${filters.to}.xlsx`,
        cols.map((k) => t(`csv.${k}`)),
        rows.map((r) => cols.map((k) => cell(k, r[k]))),
      );
    } catch (e) {
      failed(e);
    } finally {
      setExporting(false);
    }
  }

  const rows = list.data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const cols = canAssign ? 7 : 6;
  return (
    <div className="flex flex-col gap-3">
      {/* Search is always in view; the other filters fold behind "Filters" on a phone. */}
      <FilterBar
        search={
          <Field label={t("searchLabel")} className="w-full sm:w-64">
            {(a) => <Input {...a} type="search" placeholder={t("searchPlaceholder")} value={filters.q} onChange={(e) => set("q", e.target.value)} />}
          </Field>
        }
        active={[filters.from, filters.to, filters.stage, filters.assigned_to, source, filters.due].filter(Boolean).length}
        actions={
          <Button variant="secondary" disabled={exporting || !range.success || !list.data?.total} onClick={() => void exportExcel()}>
            <Download aria-hidden />
            {exporting ? t("exporting") : t("export")}
          </Button>
        }
      >
        <Field label={t("from")} error={rangeChecks.error("from")}>
          {(a) => <Input {...a} type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />}
        </Field>
        <Field label={t("to")} error={rangeChecks.error("to")}>
          {(a) => <Input {...a} type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />}
        </Field>
        <Field label={t("f.stage")}>
          {(a) => (
            <Select {...a} value={filters.stage} onChange={(e) => set("stage", e.target.value)}>
              <option value="">{t("all")}</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`stage.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {canAssign && (
          <Field label={t("f.owner")}>
            {(a) => (
              <Select {...a} value={filters.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
                <option value="">{t("all")}</option>
                <option value="unassigned">{t("unassigned")}</option>
                {staff.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("f.source")} className="min-w-48">
          {(a) => <LibraryCombobox id={a.id} kind="lead_source" value={source} onChange={(v) => (setSource(v), setOffset(0))} placeholder={t("all")} />}
        </Field>
        <Field label={t("dueFilter")}>
          {(a) => (
            <Select {...a} value={filters.due} onChange={(e) => set("due", e.target.value)}>
              <option value="">{t("all")}</option>
              <option value="overdue">{t("due.overdue")}</option>
              <option value="today">{t("due.today")}</option>
              <option value="none">{t("due.none")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("sortBy")}>
          {(a) => (
            <Select
              {...a}
              value={sort}
              onChange={(e) => {
                const next = e.target.value as (typeof SORTS)[number];
                setSort(next);
                setDesc(defaultDesc(next));
                setOffset(0);
              }}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="secondary" aria-pressed={!desc} title={t("overdueFirst")} onClick={() => (setDesc((v) => !v), setOffset(0))}>
          {desc ? <ArrowDownWideNarrow aria-hidden /> : <ArrowUpNarrowWide aria-hidden />}
          {desc ? t("descending") : t("ascending")}
        </Button>
      </FilterBar>
      {(filters.q || filters.due) && <p className="text-[0.9rem] text-text-secondary">{t("allDatesHint")}</p>}

      {canAssign && selected.length > 0 && (
        <div role="region" aria-label={t("bulkLabel")} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3">
          <p className="self-center font-medium">{t("selected", { n: selected.length })}</p>
          <Field label={t("assignTo")} error={bulkChecks.error("to")}>
            {(a) => (
              <Select {...a} value={assignTo} onChange={(e) => (setAssignTo(e.target.value), bulkChecks.clear("to"))}>
                <option value="">{t("choose")}</option>
                {staff.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            disabled={assign.isPending}
            onClick={() => {
              const d = bulkChecks.validate({ to: assignTo });
              if (d) assign.mutate({ ids: selected, to: d.to });
            }}
          >
            <UserCheck aria-hidden />
            {t("assign", { n: selected.length })}
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            <X aria-hidden />
            {t("clearSelection")}
          </Button>
        </div>
      )}

      {list.data && <p className="text-text-secondary">{t("count", { n: list.data.total })}</p>}
      {/* Tighter cell padding: all seven columns fit a 1280 px screen without scrolling. */}
      <Table className="[&_td]:px-2.5 [&_th]:px-2.5">
        <THead>
          <tr>
            {canAssign && (
              <TH className="w-12 p-0 sm:p-0">
                {/* The whole cell is the tick box's hit area. */}
                <label className="flex min-h-11 cursor-pointer items-center justify-center px-1">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--primary)]"
                    aria-label={t("selectAll")}
                    checked={allChecked}
                    onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                  />
                </label>
              </TH>
            )}
            <TH>{t("col.lead")}</TH>
            <TH>{t("col.date")}</TH>
            <TH>{t("col.treatmentSource")}</TH>
            <TH>{t("col.owner")}</TH>
            <TH>{t("col.stageAgreed")}</TH>
            <TH>{t("col.due")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={4} cols={cols} />}
          {list.isError && <EmptyRow colSpan={cols}>{t("loadFailed")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={cols}>{t("none")}</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.id}>
              {canAssign && (
                <TD className="p-0 sm:p-0">
                  <label className="flex min-h-12 cursor-pointer items-center justify-center px-1">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--primary)]"
                      aria-label={t("selectLead", { name: r.name })}
                      checked={selected.includes(r.id)}
                      onChange={(e) => setSelected((x) => (e.target.checked ? [...x, r.id] : x.filter((id) => id !== r.id)))}
                    />
                  </label>
                </TD>
              )}
              {/* Name on one line (cut with "…", full name on hover), number and phone under it. */}
              <TD>
                <div className="w-48 xl:w-52">
                  <Link href={`/leads/${r.id}`} title={r.name} className="block truncate font-medium text-link underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                  <span className="block text-[0.9rem] whitespace-nowrap text-text-secondary tabular-nums">
                    #{r.sl_no} · {r.phone_e164}
                  </span>
                </div>
              </TD>
              <TD className="whitespace-nowrap tabular-nums">{formatDate(day(r.lead_date))}</TD>
              <TD className="min-w-28">
                {!r.treatment && !r.source_label ? (
                  "—"
                ) : (
                  <>
                    <span className="block">{r.treatment ?? "—"}</span>
                    {r.source_label && <span className="block text-[0.9rem] text-text-secondary">{r.source_label}</span>}
                  </>
                )}
              </TD>
              <TD>
                {canAssign ? (
                  <Select
                    className="w-36"
                    aria-label={t("ownerOf", { name: r.name })}
                    value={r.assigned_to ?? ""}
                    disabled={assign.isPending}
                    onChange={(e) => e.target.value && assign.mutate({ ids: [r.id], to: e.target.value })}
                  >
                    <option value="">{t("unassigned")}</option>
                    {staff.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  (r.assigned_name ?? t("unassigned"))
                )}
              </TD>
              <TD>
                <button
                  type="button"
                  className="group -my-1 inline-flex min-h-10 cursor-pointer items-center rounded-full focus-visible:outline-2"
                  aria-label={t("changeStageOf", { name: r.name, stage: t(`stage.${r.stage}`) })}
                  onClick={() => setStageFor({ lead: r, stage: r.stage })}
                >
                  <StageBadge stage={r.stage} editable />
                </button>
                {/* The agreed amount sits under the stage (one column fewer: the table fits a laptop). */}
                {r.amount_finalised_paise !== null && (
                  <span className="block text-[0.9rem] text-text-secondary tabular-nums">{formatINR(r.amount_finalised_paise)}</span>
                )}
              </TD>
              <TD>
                <Input
                  type="datetime-local"
                  className="w-[13.25rem] px-2 text-[0.9rem]"
                  aria-label={t("dueOf", { name: r.name })}
                  defaultValue={r.next_followup_at ? istDateTimeLocal(new Date(r.next_followup_at)) : ""}
                  key={`${r.id}-${r.version}`}
                  onBlur={(e) => {
                    const at = e.target.value ? fromIstDateTimeLocal(e.target.value) : null;
                    if ((at ?? null) !== (r.next_followup_at ? new Date(r.next_followup_at).toISOString() : null)) setDue.mutate({ lead: r, at });
                  }}
                />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={(o) => (setOffset(o), setSelected([]))} />}

      <Dialog open={stageFor !== null} onOpenChange={(o) => !o && setStageFor(null)}>
        {stageFor && <StageDialog lead={stageFor.lead} initial={stageFor.stage} onDone={() => (setStageFor(null), refresh())} />}
      </Dialog>
    </div>
  );
}
