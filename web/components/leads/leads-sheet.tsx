"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  Download,
  IndianRupee,
  Lock,
  Phone,
  PhoneCall,
  PhoneMissed,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import {
  dateRangeSchema,
  formatDate,
  formatDateTime,
  formatINR,
  istDateString,
  optionalPaise,
  optionalText,
  requiredReason,
} from "@pearl/shared";
import { BookDialog } from "@/components/appointments/book-dialog";
import { ApptStatusBadge, type ApptStatus } from "@/components/appointments/status";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, useDebounced, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DatePicker, DateRangePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { downloadExcel } from "@/lib/excel";
import { asAppError, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { cn } from "@/lib/utils";
import { useZodForm } from "@/lib/use-zod-form";
import { LogCallDialog } from "./lead-dialogs";
import { StageBadge } from "./stage-badge";
import { LEAD_STAGES, type Lead } from "./types";
import { useSalesStaff } from "./use-sales-staff";

/** One row of the sheet: the lead plus its consultation and first three calls (leads_sheet). */
export interface SheetRow extends Lead {
  consult: {
    appointment_id: string;
    at: string | null;
    date: string;
    status: ApptStatus;
    doctor: string | null;
  } | null;
  followups: { at: string; outcome: string | null; by: string | null; notes: string | null }[];
  calls_total: number;
}
interface SheetPage {
  total: number;
  rows: SheetRow[];
}

const LIMIT = 50;
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const item = (id: string | null, label: string | null): LibraryItem | null =>
  id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;
const remarksSchema = z.object({ remarks: optionalText(2000) });

function startFilters() {
  return {
    from: istDateString(new Date(Date.now() - 89 * 86_400_000)),
    to: istDateString(new Date()),
    q: "",
    stage: "",
    assigned_to: "",
    due: "",
  };
}

type Pop = { kind: "call" | "book" | "quote"; row: SheetRow } | null;

/**
 * The sales sheet (Priyanka's "Sales CRM – New Leads", 16/11/2026): one row per lead, the sheet's
 * columns, edited in the cell. Runs on CRM data: follow-ups are the logged calls, the consultation is
 * the booking. A sales executive sees their own leads; a manager also gives leads to the team.
 */
export function LeadsSheet({
  canAssign,
  canOverride,
}: {
  canAssign: boolean;
  canOverride: boolean;
}) {
  const t = useTranslations("leads");
  const ts = useTranslations("leads.sheet");
  const dp = useTranslations("datePicker");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const staff = useSalesStaff();
  const [filters, setFilters] = useState(startFilters);
  const [source, setSource] = useState<LibraryItem | null>(null);
  const [offset, setOffset] = useState(0);
  const [pop, setPop] = useState<Pop>(null);
  const [exporting, setExporting] = useState(false);
  const q = useDebounced(filters.q.trim(), 300);
  const range = dateRangeSchema.safeParse({ from: filters.from, to: filters.to });
  const rangeChecks = useZodForm(dateRangeSchema);

  const pFilters = {
    from: filters.from,
    to: filters.to,
    ...(q ? { q } : {}),
    ...(filters.stage ? { stages: [filters.stage] } : {}),
    ...(filters.assigned_to ? { assigned_to: filters.assigned_to } : {}),
    ...(filters.due ? { due: filters.due } : {}),
    ...(source ? { source_ids: [source.id] } : {}),
  };
  // Under "leads_table" so every place that refreshes the leads list refreshes the sheet too.
  const list = useQuery({
    queryKey: ["leads_table", "sheet", pFilters, offset],
    enabled: range.success,
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<SheetPage>("leads_sheet", {
        p_filters: pFilters,
        p_sort: "lead_date",
        p_desc: true,
        p_offset: offset,
        p_limit: LIMIT,
      }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["leads_table"] });
    void queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
  };
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };
  const start = startFilters();
  const changed =
    (Object.keys(start) as (keyof typeof start)[]).some((k) => filters[k] !== start[k]) || !!source;

  // One cell's save: update_lead with the row's version (a stale row says so and reloads).
  const patch = useMutation({
    mutationFn: (a: { row: SheetRow; patch: Record<string, unknown> }) =>
      rpc<Lead>("update_lead", { p_id: a.row.id, p_patch: a.patch, p_version: a.row.version }),
    onSuccess: () => (saved(ts("saved")), refresh()),
    onError: (e) => (failed(e), refresh()),
  });
  const assign = useMutation({
    mutationFn: (a: { id: string; to: string }) =>
      rpc<number>("assign_leads", { p_ids: [a.id], p_to: a.to }),
    onSuccess: (n) => (saved(t("assigned", { n })), refresh()),
    onError: (e) => (failed(e), refresh()),
  });
  const busy = patch.isPending || assign.isPending;

  const cols = [
    "sl",
    "name",
    "source",
    "phone",
    "team",
    "doctor",
    "consult",
    "quote",
    "surgery",
    "f1",
    "f2",
    "f3",
    "remarks",
  ] as const;
  const followText = (f: SheetRow["followups"][number] | undefined) =>
    f
      ? [
          formatDateTime(new Date(f.at)),
          f.outcome ? t(`outcome.${f.outcome}` as "outcome.connected") : "",
          f.by ?? "",
          f.notes ?? "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  async function exportExcel() {
    setExporting(true);
    try {
      const rows: SheetRow[] = [];
      for (let o = 0; o < 5000; o += 100) {
        const page = await rpc<SheetPage>("leads_sheet", {
          p_filters: pFilters,
          p_sort: "lead_date",
          p_desc: true,
          p_offset: o,
          p_limit: 100,
        });
        rows.push(...page.rows);
        if (rows.length >= page.total || page.rows.length === 0) break;
      }
      await downloadExcel(
        `sales-sheet-${filters.from}-to-${filters.to}.xlsx`,
        cols.map((c) => ts(`col.${c}`)),
        rows.map((r) => [
          r.sl_no,
          r.name,
          r.source_label ?? "",
          r.phone_e164,
          r.assigned_name ?? "",
          r.doctor_name ?? "",
          r.consult
            ? [
                r.consult.at
                  ? formatDateTime(new Date(r.consult.at))
                  : formatDate(day(r.consult.date)),
                r.consult.doctor ?? "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "",
          [
            r.amount_quoted_paise !== null ? formatINR(r.amount_quoted_paise) : "",
            r.amount_finalised_paise !== null ? formatINR(r.amount_finalised_paise) : "",
          ]
            .filter(Boolean)
            .join(" → "),
          r.surgery_date ? formatDate(day(r.surgery_date)) : "",
          followText(r.followups[0]),
          followText(r.followups[1]),
          followText(r.followups[2]),
          r.comments1 ?? "",
        ]),
      );
    } catch (e) {
      failed(e);
    } finally {
      setExporting(false);
    }
  }

  const rows = list.data?.rows ?? [];
  const cell = "border border-border px-2 py-1.5 align-top";
  const head =
    "border border-border bg-secondary px-2 py-2 text-left font-medium whitespace-nowrap text-text-secondary";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterBar
        search={
          <Field label={t("searchLabel")} className="w-full sm:w-64">
            {(a) => (
              <Input
                {...a}
                type="search"
                placeholder={t("searchPlaceholder")}
                value={filters.q}
                onChange={(e) => set("q", e.target.value)}
              />
            )}
          </Field>
        }
        active={
          [filters.stage, filters.assigned_to, source, filters.due].filter(Boolean).length +
          (filters.from !== start.from || filters.to !== start.to ? 1 : 0)
        }
        canClear={changed}
        onClear={() => (
          setFilters(startFilters()),
          setSource(null),
          setOffset(0),
          rangeChecks.clearAll()
        )}
        actions={
          <Button
            variant="secondary"
            disabled={exporting || !range.success || !list.data?.total}
            onClick={() => void exportExcel()}
          >
            <Download aria-hidden />
            {exporting ? t("exporting") : t("export")}
          </Button>
        }
      >
        <Field label={dp("dates")} error={rangeChecks.error("from") ?? rangeChecks.error("to")}>
          {(a) => (
            <DateRangePicker
              {...a}
              value={{ from: filters.from, to: filters.to }}
              onChange={(r) => (
                setFilters((f) => ({ ...f, ...r })),
                setOffset(0),
                rangeChecks.validate(r)
              )}
              clearTo={{ from: start.from, to: start.to }}
            />
          )}
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
          <Field label={ts("col.team")}>
            {(a) => (
              <Select
                {...a}
                value={filters.assigned_to}
                onChange={(e) => set("assigned_to", e.target.value)}
              >
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
          {(a) => (
            <LibraryCombobox
              id={a.id}
              kind="lead_source"
              value={source}
              onChange={(v) => (setSource(v), setOffset(0))}
              placeholder={t("all")}
            />
          )}
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
      </FilterBar>

      {list.data && <p className="text-text-secondary">{t("count", { n: list.data.total })}</p>}
      {/* The grid scrolls inside its own box (both ways); the page never scrolls sideways. */}
      <div
        role="region"
        aria-label={ts("gridLabel")}
        tabIndex={0}
        className="max-h-[calc(100dvh-15rem)] min-h-64 w-full min-w-0 overflow-auto rounded-xl border border-border"
      >
        <table className="w-max min-w-full border-collapse text-[0.9rem]" data-testid="leads-sheet">
          <thead className="sticky top-0 z-20">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    head,
                    c === "sl" && "sticky left-0 z-30 w-12",
                    c === "name" && "sticky left-12 z-30",
                  )}
                >
                  {ts(`col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={cols.length} className={cn(cell, "py-6 text-text-secondary")}>
                  {t("loading")}
                </td>
              </tr>
            )}
            {list.isError && (
              <tr>
                <td colSpan={cols.length} className={cn(cell, "py-6 text-text-secondary")}>
                  {t("loadFailed")}
                </td>
              </tr>
            )}
            {list.data && rows.length === 0 && (
              <tr>
                <td colSpan={cols.length} className={cn(cell, "py-6 text-text-secondary")}>
                  {t("none")}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const nextCall = r.followups.length;
              return (
                <tr key={r.id} className="bg-background hover:bg-secondary/40" data-lead={r.id}>
                  <td
                    className={cn(
                      cell,
                      "sticky left-0 z-10 w-12 bg-background text-right text-text-secondary tabular-nums",
                    )}
                  >
                    {r.sl_no}
                  </td>
                  <td className={cn(cell, "sticky left-12 z-10 bg-background")}>
                    <div className="w-44">
                      <Link
                        href={`/leads/${r.id}`}
                        title={r.name}
                        className="block truncate font-medium text-link underline-offset-4 hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="mt-1">
                        <StageBadge stage={r.stage} />
                      </div>
                    </div>
                  </td>
                  <td className={cell}>
                    <LibraryCombobox
                      kind="lead_source"
                      aria-label={ts("sourceOf", { name: r.name })}
                      className="min-h-8 w-40 rounded-lg px-2 text-[0.9rem]"
                      placeholder="—"
                      disabled={busy}
                      value={item(r.source_id, r.source_label)}
                      onChange={(v) =>
                        v &&
                        v.id !== r.source_id &&
                        patch.mutate({ row: r, patch: { source_id: v.id } })
                      }
                    />
                  </td>
                  <td className={cn(cell, "whitespace-nowrap tabular-nums")}>
                    <a
                      href={`tel:${r.phone_e164}`}
                      className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
                    >
                      <Phone aria-hidden className="size-3.5" />
                      {r.phone_e164}
                    </a>
                  </td>
                  <td className={cell}>
                    {canAssign ? (
                      <Select
                        className="min-h-8 w-36 px-2 text-[0.9rem]"
                        aria-label={t("ownerOf", { name: r.name })}
                        value={r.assigned_to ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value &&
                          e.target.value !== r.assigned_to &&
                          assign.mutate({ id: r.id, to: e.target.value })
                        }
                      >
                        <option value="">{t("unassigned")}</option>
                        {staff.data?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="whitespace-nowrap">
                        {r.assigned_name ?? t("unassigned")}
                      </span>
                    )}
                  </td>
                  <td className={cell}>
                    <LibraryCombobox
                      kind="doctor"
                      aria-label={ts("doctorOf", { name: r.name })}
                      className="min-h-8 w-40 rounded-lg px-2 text-[0.9rem]"
                      placeholder="—"
                      disabled={busy}
                      value={item(r.doctor_id, r.doctor_name)}
                      onChange={(v) =>
                        (v?.id ?? null) !== r.doctor_id &&
                        patch.mutate({ row: r, patch: { doctor_id: v?.id ?? null } })
                      }
                    />
                  </td>
                  <td className={cell} data-col="consult">
                    {r.consult ? (
                      <div className="flex w-44 flex-col gap-0.5">
                        <span className="font-medium tabular-nums">
                          {r.consult.at
                            ? formatDateTime(new Date(r.consult.at))
                            : formatDate(day(r.consult.date))}
                        </span>
                        {r.consult.doctor && (
                          <span className="truncate text-text-secondary">{r.consult.doctor}</span>
                        )}
                        <ApptStatusBadge status={r.consult.status} className="self-start" />
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-8 px-2.5 text-[0.9rem]"
                        aria-label={ts("bookFor", { name: r.name })}
                        onClick={() => setPop({ kind: "book", row: r })}
                      >
                        <CalendarPlus aria-hidden />
                        {ts("book")}
                      </Button>
                    )}
                  </td>
                  <td className={cell}>
                    <button
                      type="button"
                      className="flex min-h-8 w-36 cursor-pointer flex-col items-start rounded-lg px-1 text-left tabular-nums hover:bg-secondary focus-visible:outline-2"
                      onClick={() => setPop({ kind: "quote", row: r })}
                    >
                      <span className="sr-only">{ts("quoteOf", { name: r.name })}: </span>
                      {r.amount_quoted_paise === null && r.amount_finalised_paise === null ? (
                        <span className="text-text-secondary">—</span>
                      ) : (
                        <>
                          <span className="text-text-secondary">
                            {ts("quoted", {
                              amount:
                                r.amount_quoted_paise !== null
                                  ? formatINR(r.amount_quoted_paise)
                                  : "—",
                            })}
                          </span>
                          <span className="inline-flex items-center gap-1 font-medium">
                            {ts("final", {
                              amount:
                                r.amount_finalised_paise !== null
                                  ? formatINR(r.amount_finalised_paise)
                                  : "—",
                            })}
                            {r.amount_locked && (
                              <Lock aria-label={t("locked")} className="size-3.5" />
                            )}
                          </span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className={cell}>
                    <DatePicker
                      className="min-h-8 w-36 px-2 text-[0.9rem]"
                      aria-label={ts("surgeryOf", { name: r.name })}
                      placeholder="—"
                      disabled={busy}
                      value={r.surgery_date ?? ""}
                      onChange={(v) =>
                        (v || null) !== r.surgery_date &&
                        patch.mutate({ row: r, patch: { surgery_date: v || null } })
                      }
                    />
                  </td>
                  {[0, 1, 2].map((i) => {
                    const f = r.followups[i];
                    return (
                      <td key={i} className={cell} data-col={`f${i + 1}`}>
                        {f ? (
                          <div className="flex w-40 flex-col gap-0.5" title={f.notes ?? undefined}>
                            <span className="tabular-nums">{formatDateTime(new Date(f.at))}</span>
                            {f.outcome && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  f.outcome === "connected"
                                    ? "text-good-text"
                                    : "text-text-secondary",
                                )}
                              >
                                {f.outcome === "connected" ? (
                                  <PhoneCall aria-hidden className="size-3.5" />
                                ) : (
                                  <PhoneMissed aria-hidden className="size-3.5" />
                                )}
                                {t(`outcome.${f.outcome}` as "outcome.connected")}
                              </span>
                            )}
                            {f.by && <span className="truncate text-text-secondary">{f.by}</span>}
                          </div>
                        ) : i === nextCall ? (
                          <Button
                            variant="secondary"
                            className="min-h-8 px-2.5 text-[0.9rem]"
                            aria-label={ts("logCallFor", { name: r.name })}
                            onClick={() => setPop({ kind: "call", row: r })}
                          >
                            <PhoneCall aria-hidden />
                            {t("logCall")}
                          </Button>
                        ) : null}
                        {i === 2 && r.calls_total > 3 && (
                          <span className="mt-0.5 block text-text-secondary">
                            {ts("moreCalls", { n: r.calls_total - 3 })}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className={cell}>
                    <RemarksCell
                      row={r}
                      disabled={busy}
                      onSave={(v) => patch.mutate({ row: r, patch: { comments1: v } })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />
      )}

      <Dialog open={pop !== null} onOpenChange={(o) => !o && setPop(null)}>
        {pop?.kind === "call" && (
          <LogCallDialog lead={pop.row} onDone={() => (setPop(null), refresh())} />
        )}
        {pop?.kind === "book" && (
          <BookDialog
            lead={{ id: pop.row.id, name: pop.row.name }}
            onDone={() => (setPop(null), refresh())}
          />
        )}
        {pop?.kind === "quote" && (
          <QuotationDialog
            row={pop.row}
            canOverride={canOverride}
            onDone={() => (setPop(null), refresh())}
          />
        )}
      </Dialog>
    </div>
  );
}

/** Remarks: click to type; Enter (or leaving the box) saves, Esc puts it back. Shift+Enter is a new line. */
function RemarksCell({
  row,
  disabled,
  onSave,
}: {
  row: SheetRow;
  disabled: boolean;
  onSave: (v: string | null) => void;
}) {
  const ts = useTranslations("leads.sheet");
  const tv = useTranslations();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const r = remarksSchema.safeParse({ remarks: draft });
    if (!r.success) return setError(r.error.issues[0]?.message ?? "validation.invalid");
    const next = r.data.remarks;
    setDraft(null);
    setError(null);
    if ((next ?? null) !== (row.comments1 ?? null)) onSave(next ?? null);
  };
  if (draft === null) {
    return (
      <button
        type="button"
        disabled={disabled}
        className="block min-h-8 w-64 cursor-text rounded-lg px-1 text-left whitespace-pre-wrap hover:bg-secondary focus-visible:outline-2 disabled:cursor-not-allowed"
        onClick={() => setDraft(row.comments1 ?? "")}
      >
        <span className="sr-only">{ts("remarksOf", { name: row.name })}: </span>
        {row.comments1 || <span className="text-text-secondary">{ts("addRemarks")}</span>}
      </button>
    );
  }
  return (
    <div className="w-64">
      <Textarea
        autoFocus
        rows={2}
        maxLength={2000}
        aria-label={ts("remarksOf", { name: row.name })}
        aria-invalid={error ? true : undefined}
        className="min-h-16 px-2 py-1 text-[0.9rem]"
        value={draft}
        onChange={(e) => (setDraft(e.target.value), setError(null))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            setError(null);
          }
        }}
      />
      {error && <p className="text-[0.85rem] text-bad-text">{tv(error as "validation.invalid")}</p>}
    </div>
  );
}

/**
 * The sheet's "Prescription" column = the quotation: the amount quoted, then the amount finalised
 * (agreed). Once treatment has started the agreed amount is locked for sales; a manager/admin can
 * still change it with a reason (the database decides).
 */
function QuotationDialog({
  row,
  canOverride,
  onDone,
}: {
  row: SheetRow;
  canOverride: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("leads");
  const ts = useTranslations("leads.sheet");
  const errs = useTranslations("errors");
  const { saved, failed } = useFeedback();
  const [quoted, setQuoted] = useState<number | null>(row.amount_quoted_paise);
  const [final, setFinal] = useState<number | null>(row.amount_finalised_paise);
  const [reason, setReason] = useState("");
  const blocked = row.amount_locked && !canOverride;
  const finalChanged = final !== row.amount_finalised_paise;
  const needsReason = row.amount_locked && finalChanged;
  const [schema] = useState(() =>
    z
      .object({ quoted: optionalPaise(), final: optionalPaise(), reason: z.string() })
      .superRefine((d, ctx) => {
        if (
          row.amount_locked &&
          d.final !== row.amount_finalised_paise &&
          !requiredReason(300).safeParse(d.reason).success
        ) {
          ctx.addIssue({ code: "custom", path: ["reason"], message: "errors.reason_required" });
        }
      }),
  );
  const checks = useZodForm(schema);
  const save = useMutation({
    mutationFn: async (d: { quoted: number | null; final: number | null; reason: string }) => {
      if (d.quoted !== row.amount_quoted_paise) {
        await rpc("update_lead", {
          p_id: row.id,
          p_patch: { amount_quoted_paise: d.quoted },
          p_version: row.version,
        });
      }
      if (d.final !== row.amount_finalised_paise) {
        await rpc("set_amount_finalised", {
          p_id: row.id,
          p_amount_paise: d.final,
          p_reason: d.reason.trim() || null,
        });
      }
    },
    onSuccess: () => (saved(t("amountSaved")), onDone()),
    onError: (e) => {
      if (asAppError(e).code === "reason_required")
        return checks.setError("reason", "errors.reason_required");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={ts("quoteTitle", { name: row.name })}
      description={blocked ? errs("amount_locked") : ts("quoteHint")}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ quoted, final, reason });
            if (d) save.mutate(d);
          }}
        >
          <Save aria-hidden />
          {t("saveAmount")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("f.amountQuoted")} error={checks.error("quoted")}>
          {(a) => (
            <MoneyInput
              {...a}
              value={quoted}
              onChange={(v) => (setQuoted(v), checks.clear("quoted"))}
            />
          )}
        </Field>
        <Field label={t("f.amountFinalised")} error={checks.error("final")}>
          {(a) => (
            <MoneyInput
              {...a}
              disabled={blocked}
              value={final}
              onChange={(v) => (setFinal(v), checks.clear("final"))}
            />
          )}
        </Field>
        {needsReason && !blocked && (
          <Field
            label={t("amountReason")}
            hint={t("amountReasonHint")}
            error={checks.error("reason")}
          >
            {(a) => (
              <Textarea
                {...a}
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => (setReason(e.target.value), checks.clear("reason"))}
              />
            )}
          </Field>
        )}
        {row.amount_locked && (
          <p className="inline-flex items-center gap-1.5 text-text-secondary">
            <IndianRupee aria-hidden className="size-4" />
            {t("locked")}
          </p>
        )}
      </div>
    </DialogContent>
  );
}
