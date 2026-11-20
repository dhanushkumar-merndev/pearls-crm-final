"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCheck, CirclePlus, CircleX, Eye, Pencil, Printer, RefreshCw, Save, Split, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatINR, istDateString } from "@pearl/shared";
import { NewBreakdownDialog } from "@/components/breakdown/new-breakdown-dialog";
import { PrintPreviewDialog } from "@/components/print-preview";
import type { BreakdownBill } from "@/components/breakdown/types";
import { GST_RATES_BP, MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoreMenu } from "@/components/ui/more-menu";
import { DetailHeader, Page, StickyActions } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import {
  emptyBreakdownLine,
  gstIncluded,
  lineFromRow,
  linesTotal,
  moveLine,
  splitLine,
  toBreakdownPayload,
  withAmount,
  withQtyOrRate,
  type BreakdownEditLine,
} from "@/lib/breakdown-bill";
import { rpc } from "@/lib/rpc";
import { breakdownSchema } from "@/lib/schemas/billing";
import { reasonSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useMe } from "@/lib/use-me";
import { useZodForm } from "@/lib/use-zod-form";
import { cn } from "@/lib/utils";

const item = (id: string | null, label: string | null): LibraryItem | null =>
  id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;

/** A breakdown bill for the insurance company: draft editor, or the finalized copy with print / admin tools. */
export function BreakdownScreen({ initial }: { initial: BreakdownBill }) {
  const t = useTranslations("breakdown");
  const tb = useTranslations("bill");
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const backParam = useSearchParams().get("back");
  const back = backParam && backParam.startsWith("/") && !backParam.startsWith("//") ? backParam : null;
  const query = useQuery({ queryKey: ["breakdown", initial.id], initialData: initial, queryFn: () => rpc<BreakdownBill>("get_breakdown_bill", { p_id: initial.id }) });
  const bb = query.data;
  const [amending, setAmending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Saved first, then shown as it prints (the editor remounts on save, so the pop-up lives here).
  const [previewing, setPreviewing] = useState<number | null>(null);
  const isAdmin = me?.role === "admin" && bb.status === "finalized";
  const put = (next: BreakdownBill) => {
    queryClient.setQueryData(["breakdown", bb.id], next);
    void queryClient.invalidateQueries({ queryKey: ["breakdown_bills"] });
    router.refresh();
  };

  return (
    <Page>
      <DetailHeader
        back={{ href: back ?? `/patients/${bb.patient_id}?tab=bills&section=breakdown`, label: back ? t("back") : t("backTo", { name: bb.patient }) }}
        title={
          <>
            {t("title")} {bb.bb_no && <span className="tabular-nums">· {bb.bb_no}</span>}
          </>
        }
        badges={<StatusBadge kind={bb.status === "finalized" ? "good" : bb.status === "draft" ? "warning" : "critical"} label={tb(`status.${bb.status}`)} />}
        meta={
          <>
            {bb.patient} · {bb.uhid}
            {bb.finalized_at && ` · ${formatDateTime(new Date(bb.finalized_at))}`}
            <span className="mt-1 block text-text-secondary">{t("notPayable")}</span>
          </>
        }
      />

      <FilledFrom bb={bb} />

      {bb.status === "draft" ? (
        <BreakdownEditor key={bb.version} bb={bb} onSaved={put} onPreview={(next) => (put(next), setPreviewing(next.version))} />
      ) : amending ? (
        <BreakdownEditor bb={bb} amend onSaved={(next) => (setAmending(false), put(next))} onCancelAmend={() => setAmending(false)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {/* A plain link: a prefetch would count as a print and make the next one a "Duplicate copy". */}
            <Button asChild>
              <a href={`/print/breakdown/${bb.id}`} target="_blank" rel="noopener">
                <Printer aria-hidden />
                {t("print")}
              </a>
            </Button>
            {isAdmin && (
              <MoreMenu>
                <DropdownMenuItem onSelect={() => setAmending(true)}>
                  <Pencil aria-hidden />
                  {t("amend")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCancelling(true)}>
                  <CircleX aria-hidden />
                  {t("cancel")}
                </DropdownMenuItem>
              </MoreMenu>
            )}
          </div>
          {bb.status === "cancelled" && <Card role="status">{t("cancelledBecause", { reason: bb.cancel_reason ?? "" })}</Card>}
          <BreakdownView bb={bb} />
        </>
      )}

      <Dialog open={previewing !== null} onOpenChange={(o) => !o && setPreviewing(null)}>
        {previewing !== null && <PrintPreviewDialog kind="breakdown" id={bb.id} stamp={previewing} />}
      </Dialog>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        {cancelling && <CancelDialog bb={bb} onDone={(next) => (setCancelling(false), next && put(next))} />}
      </Dialog>
    </Page>
  );
}

/** "Filled from": the bills and sessions this breakdown was made from (links to each bill). */
function FilledFrom({ bb }: { bb: BreakdownBill }) {
  const t = useTranslations("breakdown");
  const tb = useTranslations("bill");
  const chips = [
    bb.treatment,
    bb.ip_number ? t("ipStay", { ip: bb.ip_number }) : null,
    ...bb.sessions.map((s) => `${t("session", { n: s.seq })} · ${formatDate(new Date(s.date))}`),
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.95rem]" data-testid="bb-filled-from">
      <span className="text-text-secondary">{t("filledFrom")}:</span>
      {chips.length === 0 && bb.source_bills.length === 0 && <span className="text-text-secondary">{t("nothingChosen")}</span>}
      {chips.map((c) => (
        <span key={c} className="rounded-full border border-border px-2.5 py-0.5">
          {c}
        </span>
      ))}
      {bb.source_bills.map((b) => (
        <Link key={b.id} href={`/bills/${b.id}`} className="rounded-full border border-border px-2.5 py-0.5 hover:bg-accent">
          {tb(`type.${b.bill_type}`)} {b.bill_no} · {formatINR(b.total_paise)}
        </Link>
      ))}
    </div>
  );
}

interface Header {
  bill_date: string;
  doctor: LibraryItem | null;
  insurer: string;
  tpa: string;
  policy_no: string;
  claim_no: string;
  notes: string;
}

/**
 * Draft (or admin amend): insurance details and the lines. Everything can change after the autofill
 * (owner, 17/11/2026); the total is free, the billed amount is shown beside it for reference only.
 */
function BreakdownEditor({
  bb,
  amend = false,
  onSaved,
  onCancelAmend,
  onPreview,
}: {
  bb: BreakdownBill;
  amend?: boolean;
  onSaved: (next: BreakdownBill) => void;
  /** Saves (no toast), then the parent shows the paper as it prints. */
  onPreview?: (next: BreakdownBill) => void;
  onCancelAmend?: () => void;
}) {
  const t = useTranslations("breakdown");
  const router = useRouter();
  const tp = useTranslations("printPreview");
  const { saved, failed } = useFeedback();
  const [header, setHeader] = useState<Header>({
    bill_date: bb.bill_date ?? istDateString(new Date()),
    doctor: item(bb.doctor_id, bb.doctor),
    insurer: bb.insurer ?? "",
    tpa: bb.tpa ?? "",
    policy_no: bb.policy_no ?? "",
    claim_no: bb.claim_no ?? "",
    notes: bb.notes ?? "",
  });
  const [lines, setLines] = useState<BreakdownEditLine[]>(() => bb.lines.map(lineFromRow));
  const [reason, setReason] = useState("");
  const [dialog, setDialog] = useState<"refill" | "finalize" | null>(null);
  const [schemas] = useState(() => ({ save: breakdownSchema({ needLine: false, amend }), finalize: breakdownSchema({ needLine: true, amend }) }));
  const checks = useZodForm(schemas.save);
  const finalChecks = useZodForm(schemas.finalize);
  const errorOf = (path: string) => checks.error(path) ?? finalChecks.error(path);
  const total = linesTotal(lines);
  const diff = total - bb.billed_now_paise;

  const head = (patch: Partial<Header>, field?: keyof Header) => {
    setHeader((h) => ({ ...h, ...patch }));
    if (field) checks.clear(field);
  };
  const edit = (key: string, f: (l: BreakdownEditLine) => BreakdownEditLine, field?: string) => {
    setLines((ls) => ls.map((l) => (l.key === key ? f(l) : l)));
    const i = lines.findIndex((l) => l.key === key);
    if (field && i >= 0) {
      checks.clear(`lines.${i}.${field}`);
      finalChecks.clear(`lines.${i}.${field}`);
    }
  };
  const values = () => ({ ...header, lines, reason });
  const payload = () => ({
    header: {
      bill_date: header.bill_date,
      doctor_id: header.doctor?.id ?? null,
      insurer: header.insurer,
      tpa: header.tpa,
      policy_no: header.policy_no,
      claim_no: header.claim_no,
      notes: header.notes,
    },
    lines: lines.map(toBreakdownPayload),
  });

  const save = useMutation({
    mutationFn: () => {
      const p = payload();
      return amend
        ? rpc<BreakdownBill>("amend_breakdown_bill", { p_id: bb.id, p_header: p.header, p_lines: p.lines, p_reason: reason.trim() })
        : rpc<BreakdownBill>("save_breakdown_bill", { p_id: bb.id, p_version: bb.version, p_header: p.header, p_lines: p.lines });
    },
    onError: failed,
  });
  const finalize = useMutation({
    mutationFn: async () => {
      const p = payload();
      const kept = await rpc<BreakdownBill>("save_breakdown_bill", { p_id: bb.id, p_version: bb.version, p_header: p.header, p_lines: p.lines });
      return rpc<BreakdownBill>("finalize_breakdown_bill", { p_id: bb.id, p_version: kept.version });
    },
    onSuccess: (next) => {
      saved(t("finalized", { no: next.bb_no ?? "" }));
      setDialog(null);
      onSaved(next);
    },
    onError: (e) => {
      setDialog(null);
      failed(e);
    },
  });
  const discard = useMutation({
    mutationFn: () => rpc("discard_breakdown_bill", { p_id: bb.id }),
    onSuccess: () => {
      saved(t("discarded"));
      router.push(`/patients/${bb.patient_id}?tab=bills&section=breakdown`);
    },
    onError: failed,
  });

  const doSave = () => {
    finalChecks.clearAll();
    if (!checks.validate(values())) return;
    save.mutate(undefined, {
      onSuccess: (next) => {
        saved(amend ? t("amended") : t("saved"));
        onSaved(next);
      },
    });
  };
  const doPreview = () => {
    finalChecks.clearAll();
    if (!checks.validate(values())) return;
    save.mutate(undefined, { onSuccess: (next) => onPreview?.(next) });
  };
  const askFinalize = () => {
    checks.clearAll();
    if (finalChecks.validate(values())) setDialog("finalize");
  };
  const busy = save.isPending || finalize.isPending || discard.isPending;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("details")}</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("billDate")} error={errorOf("bill_date")}>
            {(a) => <DatePicker {...a} value={header.bill_date} clearTo={header.bill_date} onChange={(v) => head({ bill_date: v }, "bill_date")} />}
          </Field>
          <Field label={t("doctor")}>{(a) => <LibraryCombobox {...a} kind="doctor" value={header.doctor} onChange={(d) => head({ doctor: d })} />}</Field>
          <Field label={t("insurer")} error={errorOf("insurer")}>
            {(a) => <Input {...a} maxLength={120} value={header.insurer} onChange={(e) => head({ insurer: e.target.value }, "insurer")} />}
          </Field>
          <Field label={t("tpa")} error={errorOf("tpa")}>
            {(a) => <Input {...a} maxLength={120} value={header.tpa} onChange={(e) => head({ tpa: e.target.value }, "tpa")} />}
          </Field>
          <Field label={t("policyNo")} error={errorOf("policy_no")}>
            {(a) => <Input {...a} maxLength={60} value={header.policy_no} onChange={(e) => head({ policy_no: e.target.value }, "policy_no")} />}
          </Field>
          <Field label={t("claimNo")} error={errorOf("claim_no")}>
            {(a) => <Input {...a} maxLength={60} value={header.claim_no} onChange={(e) => head({ claim_no: e.target.value }, "claim_no")} />}
          </Field>
          <Field label={t("notes")} className="sm:col-span-2" error={errorOf("notes")}>
            {(a) => <Input {...a} maxLength={1000} value={header.notes} onChange={(e) => head({ notes: e.target.value }, "notes")} />}
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("lines")}</h2>
          <p className="text-[0.95rem] text-text-secondary">{t("linesHint")}</p>
        </div>
        {!amend && (
          <Button variant="secondary" onClick={() => setDialog("refill")}>
            <RefreshCw aria-hidden />
            {t("refill")}
          </Button>
        )}
      </div>

      {lines.length === 0 && <p className="text-text-secondary">{t("noLines")}</p>}
      <ol className="flex flex-col gap-2" data-testid="bb-lines">
        {lines.map((l, i) => (
          <li key={l.key}>
            <Card className="grid gap-3 md:grid-cols-12 md:items-end" data-testid="bb-line">
              <Field label={t("col.category")} className="md:col-span-3">
                {(a) => <LibraryCombobox id={a.id} kind="bill_category" value={l.category ? item(l.category.id, l.category.label) : null} onChange={(c) => edit(l.key, (x) => ({ ...x, category: c }))} />}
              </Field>
              <Field label={t("col.description")} className="md:col-span-5" error={errorOf(`lines.${i}.description`)}>
                {(a) => (
                  <Input {...a} maxLength={300} value={l.description} onChange={(e) => edit(l.key, (x) => ({ ...x, description: e.target.value }), "description")} />
                )}
              </Field>
              <Field label={t("col.date")} className="md:col-span-2">
                {(a) => <DatePicker {...a} value={l.service_date} clearTo="" onChange={(v) => edit(l.key, (x) => ({ ...x, service_date: v }))} />}
              </Field>
              <Field label={t("col.qty")} className="md:col-span-2" error={errorOf(`lines.${i}.qty`)}>
                {(a) => <Input {...a} inputMode="decimal" value={l.qty} onChange={(e) => edit(l.key, (x) => withQtyOrRate(x, { qty: e.target.value }), "qty")} />}
              </Field>
              <Field label={t("col.rate")} className="md:col-span-3">
                {(a) => <MoneyInput {...a} value={l.unit_paise} onChange={(v) => edit(l.key, (x) => withQtyOrRate(x, { unit_paise: v }), "amount_paise")} />}
              </Field>
              <Field label={t("col.gst")} className="md:col-span-2">
                {(a) => (
                  <Select {...a} value={String(l.gst_rate_bp)} onChange={(e) => edit(l.key, (x) => ({ ...x, gst_rate_bp: Number(e.target.value) }))}>
                    {[...new Set([...GST_RATES_BP, l.gst_rate_bp])].map((bp) => (
                      <option key={bp} value={bp}>
                        {bp / 100}%
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("col.amount")} className="md:col-span-3" error={errorOf(`lines.${i}.amount_paise`)}>
                {(a) => <MoneyInput {...a} value={l.amount_paise} onChange={(v) => edit(l.key, (x) => withAmount(x, v), "amount_paise")} />}
              </Field>
              <div role="group" aria-label={t("col.actions")} className="flex flex-wrap items-center justify-end gap-1 md:col-span-4">
                <Button variant="ghost" aria-label={t("splitLine", { n: i + 1 })} onClick={() => setLines((ls) => splitLine(ls, l.key))}>
                  <Split aria-hidden />
                  {t("split")}
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("moveUp", { n: i + 1 })} disabled={i === 0} onClick={() => setLines((ls) => moveLine(ls, l.key, -1))}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("moveDown", { n: i + 1 })}
                  disabled={i === lines.length - 1}
                  onClick={() => setLines((ls) => moveLine(ls, l.key, 1))}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("removeLine", { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => (setLines((ls) => [...ls, emptyBreakdownLine(ls[ls.length - 1])]), checks.clear("lines"), finalChecks.clear("lines"))}
      >
        <CirclePlus aria-hidden />
        {t("addLine")}
      </Button>
      {errorOf("lines") && (
        <p role="alert" className="text-bad-text">
          {errorOf("lines")}
        </p>
      )}

      <Card className="ml-auto grid w-full max-w-md grid-cols-2 gap-y-1 tabular-nums" data-testid="bb-totals">
        <span className="text-lg font-semibold">{t("total")}</span>
        <span className="text-right text-lg font-semibold" data-testid="bb-total">
          {formatINR(total)}
        </span>
        <span className="text-text-secondary">{t("billedRef")}</span>
        <span className="text-right text-text-secondary">{formatINR(bb.billed_now_paise)}</span>
        <span className={cn("col-span-2 text-[0.9rem]", diff !== 0 ? "text-status-warning" : "text-text-secondary")}>
          {diff === 0 ? t("same") : t("difference", { amount: formatINR(Math.abs(diff)) })} · {t("refNote")}
        </span>
      </Card>

      {amend ? (
        <StickyActions className="items-end">
          <Button variant="ghost" onClick={onCancelAmend}>
            <X aria-hidden />
            {t("new.cancel")}
          </Button>
          <Field label={t("amendReason")} className="min-w-72" error={errorOf("reason")}>
            {(a) => <Input {...a} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
          </Field>
          <Button disabled={busy} onClick={doSave}>
            <Save aria-hidden />
            {t("saveAmendment")}
          </Button>
        </StickyActions>
      ) : (
        <StickyActions>
          <Button variant="ghost" disabled={busy} onClick={() => discard.mutate()}>
            <X aria-hidden />
            {t("discardDraft")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={doSave}>
            <Save aria-hidden />
            {t("saveDraft")}
          </Button>
          {onPreview && (
            <Button variant="secondary" disabled={busy} onClick={doPreview}>
              <Eye aria-hidden />
              {tp("button")}
            </Button>
          )}
          <Button disabled={busy} onClick={askFinalize}>
            <CheckCheck aria-hidden />
            {t("finalize")}
          </Button>
        </StickyActions>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "refill" && (
          <NewBreakdownDialog
            patientId={bb.patient_id}
            refill={{ id: bb.id, version: bb.version, sources: bb.sources }}
            onDone={(next) => (setDialog(null), next && onSaved(next))}
          />
        )}
        {dialog === "finalize" && (
          <DialogContent
            title={t("finalizeTitle")}
            description={t("finalizeHint")}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDialog(null)}>
                  {t("new.cancel")}
                </Button>
                <Button disabled={busy} onClick={() => finalize.mutate()}>
                  <CheckCheck aria-hidden />
                  {t("finalize")}
                </Button>
              </>
            }
          >
            <p className="tabular-nums">
              {t("total")}: <strong>{formatINR(total)}</strong>
            </p>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

/** The finalized (or cancelled) breakdown: lines by category, subtotals, GST inside the amounts. */
function BreakdownView({ bb }: { bb: BreakdownBill }) {
  const t = useTranslations("breakdown");
  const tp = useTranslations("printBreakdown");
  const groups = useMemo(() => {
    const out: { name: string; lines: BreakdownBill["lines"]; total: number }[] = [];
    for (const l of bb.lines) {
      const name = l.category ?? tp("other");
      const g = out.find((x) => x.name === name) ?? out[out.push({ name, lines: [], total: 0 }) - 1]!;
      g.lines.push(l);
      g.total += l.amount_paise;
    }
    return out;
  }, [bb.lines, tp]);
  const gst = gstIncluded(bb.lines);
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-1 text-[0.95rem] sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["billDate", formatDate(new Date(bb.bill_date))],
            ["doctor", bb.doctor],
            ["insurer", bb.insurer],
            ["tpa", bb.tpa],
            ["policyNo", bb.policy_no],
            ["claimNo", bb.claim_no],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="text-text-secondary">{t(k)}:</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <Table>
        <THead>
          <tr>
            <TH>{t("col.no")}</TH>
            <TH>{t("col.description")}</TH>
            <TH>{t("col.date")}</TH>
            <TH className="text-right">{t("col.qty")}</TH>
            <TH className="text-right">{t("col.rate")}</TH>
            <TH className="text-right">{t("col.gst")}</TH>
            <TH className="text-right">{t("col.amount")}</TH>
          </tr>
        </THead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.name}>
              {groups.length > 1 && (
                <TR className="bg-muted">
                  <TD colSpan={6} className="font-semibold">
                    {g.name}
                  </TD>
                  <TD className="text-right font-semibold tabular-nums">{formatINR(g.total)}</TD>
                </TR>
              )}
              {g.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="tabular-nums">{l.line_no}</TD>
                  <TD>{l.description}</TD>
                  <TD className="tabular-nums">{l.service_date ? formatDate(new Date(l.service_date)) : "—"}</TD>
                  <TD className="text-right tabular-nums">{Number(l.qty)}</TD>
                  <TD className="text-right tabular-nums">{formatINR(l.unit_paise)}</TD>
                  <TD className="text-right tabular-nums">{l.gst_rate_bp / 100}%</TD>
                  <TD className="text-right font-medium tabular-nums">{formatINR(l.amount_paise)}</TD>
                </TR>
              ))}
            </Fragment>
          ))}
          <TR>
            <TD colSpan={6} className="text-right font-semibold">
              {t("total")}
            </TD>
            <TD className="text-right text-lg font-semibold tabular-nums" data-testid="bb-total">
              {formatINR(bb.total_paise)}
            </TD>
          </TR>
        </tbody>
      </Table>
      {gst.length > 0 && (
        <Card className="flex max-w-xl flex-col gap-2">
          <CardTitle>{tp("gstSummary")}</CardTitle>
          <Table>
            <THead>
              <tr>
                <TH>{tp("gstRate")}</TH>
                <TH className="text-right">{tp("taxable")}</TH>
                <TH className="text-right">{tp("cgst")}</TH>
                <TH className="text-right">{tp("sgst")}</TH>
              </tr>
            </THead>
            <tbody>
              {gst.map((r) => (
                <TR key={r.rate_bp}>
                  <TD className="tabular-nums">{r.rate_bp / 100}%</TD>
                  <TD className="text-right tabular-nums">{formatINR(r.taxable_paise)}</TD>
                  <TD className="text-right tabular-nums">{formatINR(r.cgst_paise)}</TD>
                  <TD className="text-right tabular-nums">{formatINR(r.sgst_paise)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <p className="text-[0.9rem] text-text-secondary">
        {t("billedRef")}: {formatINR(bb.billed_ref_paise)} · {t("refNote")}
      </p>
    </div>
  );
}

function CancelDialog({ bb, onDone }: { bb: BreakdownBill; onDone: (next?: BreakdownBill) => void }) {
  const t = useTranslations("breakdown");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const checks = useZodForm(reasonSchema);
  const cancel = useMutation({
    mutationFn: (r: string) => rpc<BreakdownBill>("cancel_breakdown_bill", { p_id: bb.id, p_reason: r }),
    onSuccess: (next) => {
      saved(t("cancelled"));
      onDone(next);
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("cancelTitle", { no: bb.bb_no ?? "" })}
      description={t("cancelHint")}
      footer={
        <Button
          variant="danger"
          disabled={cancel.isPending}
          onClick={() => {
            const d = checks.validate({ reason });
            if (d) cancel.mutate(d.reason);
          }}
        >
          <CircleX aria-hidden />
          {t("cancel")}
        </Button>
      }
    >
      <Field label={t("reason")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
      </Field>
    </DialogContent>
  );
}
