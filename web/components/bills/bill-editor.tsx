"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CirclePlus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { computeBillTotals, computeLine, formatINR, LineError, type DiscountType, type LineResult } from "@pearl/shared";
import { MoneyInput, GST_RATES_BP } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { useFeedback } from "@/lib/use-feedback";
import { MedicinePicker } from "./medicine-picker";
import type { Bill, BillItem } from "./types";

export interface EditLine {
  key: string;
  kind: string;
  service: LibraryItem | null;
  /** Pharmacy lines: the medicine and the batch it is sold from. */
  medicine: LibraryItem | null;
  batch_id: string | null;
  category: LibraryItem | null;
  description: string;
  hsn_sac: string;
  rate_paise: number | null;
  qty: string;
  discount_type: DiscountType;
  /** paise for ₹, percent text for % (e.g. "10" or "12.5") */
  discount_amount: number | null;
  discount_percent: string;
  gst_rate_bp: number;
  // kept from the stored line (pharmacy batches, rooms, doctors, carried-in lines…)
  rest: Partial<BillItem>;
}

const item = (id: string | null, label: string | null): LibraryItem | null =>
  id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;

export function lineFrom(i: BillItem): EditLine {
  return {
    key: i.id,
    kind: i.kind,
    service: item(i.service_id, i.description),
    medicine: i.kind === "pharmacy" ? item(i.pharmacy_item_id, i.description) : null,
    batch_id: i.batch_id,
    category: item(i.category_id, i.category),
    description: i.description,
    hsn_sac: i.hsn_sac ?? "",
    rate_paise: i.rate_paise,
    qty: String(Number(i.qty)),
    discount_type: i.discount_type,
    discount_amount: i.discount_type === "amount" ? i.discount_value : null,
    discount_percent: i.discount_type === "percent" ? String(i.discount_value / 100) : "",
    gst_rate_bp: i.gst_rate_bp,
    rest: i,
  };
}

export function emptyLine(kind = "service"): EditLine {
  return {
    key: newId(), kind, service: null, medicine: null, batch_id: null, category: null, description: "", hsn_sac: "", rate_paise: null, qty: "1",
    discount_type: "amount", discount_amount: 0, discount_percent: "", gst_rate_bp: 0, rest: {},
  };
}

function discountValue(l: EditLine): number {
  return l.discount_type === "percent" ? Math.round(Number(l.discount_percent || 0) * 100) : (l.discount_amount ?? 0);
}

/** Live preview with the same maths the database uses (packages/shared/src/gst.ts). */
export function previewLine(l: EditLine, taxInclusive: boolean): { result: LineResult | null; error: string | null } {
  const qty = Number(l.qty);
  if (l.rate_paise === null || !Number.isFinite(qty) || qty <= 0) return { result: null, error: l.qty && qty <= 0 ? "invalid_quantity" : null };
  try {
    return {
      result: computeLine({
        ratePaise: l.rate_paise,
        qtyMilli: Math.round(qty * 1000),
        discountType: l.discount_type,
        discountValue: discountValue(l),
        gstRateBp: l.gst_rate_bp,
        taxInclusive,
      }),
      error: null,
    };
  } catch (e) {
    return { result: null, error: e instanceof LineError ? e.message : "invalid_input" };
  }
}

export function toPayloadLine(l: EditLine) {
  return {
    ...l.rest,
    kind: l.kind,
    service_id: l.kind === "pharmacy" ? null : (l.service?.id ?? null),
    pharmacy_item_id: l.kind === "pharmacy" ? (l.medicine?.id ?? null) : (l.rest.pharmacy_item_id ?? null),
    batch_id: l.kind === "pharmacy" ? l.batch_id : (l.rest.batch_id ?? null),
    category_id: l.category?.id ?? null,
    description: l.description.trim(),
    hsn_sac: l.hsn_sac.trim() || null,
    rate_paise: l.rate_paise ?? 0,
    qty: Number(l.qty),
    discount_type: l.discount_type,
    discount_value: discountValue(l),
    gst_rate_bp: l.gst_rate_bp,
  };
}

/**
 * Draft bill editor (and admin amend). Every amount shown is a live preview; the
 * database recalculates everything on save, with the same rules.
 */
export function BillEditor({
  bill,
  amend = false,
  onAmended,
  onFinalize,
}: {
  bill: Bill;
  amend?: boolean;
  onAmended?: () => void;
  /** Opens the finalize dialog. It lives in the parent: saving bumps the version, which remounts this editor. */
  onFinalize?: (saved: Bill) => void;
}) {
  const t = useTranslations("bill");
  const router = useRouter();
  const me = useMe();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const ownLines = bill.items.filter((i) => i.kind !== "carried_in");
  const carried = bill.items.filter((i) => i.kind === "carried_in");
  // A pharmacy invoice sells medicines from batches; other bills list services.
  const lineKind = bill.bill_type === "pharmacy_invoice" ? "pharmacy" : "service";
  const [lines, setLines] = useState<EditLine[]>(() => (ownLines.length ? ownLines.map(lineFrom) : [emptyLine(lineKind)]));
  const [doctor, setDoctor] = useState<LibraryItem | null>(item(bill.doctor_id, bill.doctor));
  const [referredBy, setReferredBy] = useState(bill.referred_by_text ?? "");
  const [taxInclusive, setTaxInclusive] = useState(bill.tax_inclusive);
  const [reason, setReason] = useState("");
  // A patch can be a function of the line as it is now: pickers answer after a round trip,
  // and must not overwrite what was typed meanwhile.
  const update = (key: string, patch: Partial<EditLine> | ((current: EditLine) => Partial<EditLine>)) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)));

  const previews = useMemo(() => lines.map((l) => previewLine(l, taxInclusive)), [lines, taxInclusive]);
  const totals = useMemo(() => computeBillTotals(previews.map((p) => p.result).filter((r): r is LineResult => r !== null)), [previews]);
  const problems = lines.some((l, i) => !l.description.trim() || previews[i]!.result === null || (l.kind === "pharmacy" && !l.batch_id));

  const save = useMutation({
    mutationFn: async () => {
      const items = lines.map(toPayloadLine);
      if (amend) return rpc<Bill>("amend_bill", { p_bill_id: bill.id, p_items: items, p_reason: reason });
      return rpc<Bill>("save_bill", {
        p_bill_id: bill.id,
        p_header: { doctor_id: doctor?.id ?? null, referred_by_text: referredBy, tax_inclusive: taxInclusive },
        p_items: items,
        p_version: bill.version,
      });
    },
    onSuccess: (b) => {
      void queryClient.invalidateQueries({ queryKey: ["bill", bill.id] });
      if (amend) {
        saved(t("amended"));
        onAmended?.();
      } else saved(t("draftSaved"));
      router.refresh();
      return b;
    },
    onError: failed,
  });

  async function saveThenFinalize() {
    try {
      const b = await save.mutateAsync();
      onFinalize?.(b);
    } catch {
      // toast shown by onError
    }
  }

  const discard = useMutation({
    mutationFn: () => rpc("discard_draft_bill", { p_bill_id: bill.id }),
    onSuccess: () => {
      saved(t("discarded"));
      router.push(`/patients/${bill.patient_id}`);
    },
    onError: failed,
  });

  return (
    <div className="flex flex-col gap-4">
      {!amend && (
        <Card className="grid gap-4 sm:grid-cols-3">
          <Field label={t("doctor")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
          <Field label={t("referredBy")}>{(a) => <Input {...a} maxLength={120} value={referredBy} onChange={(e) => setReferredBy(e.target.value)} />}</Field>
          <Checkbox className="self-end" label={t("taxInclusive")} hint={t("taxInclusiveHint")} checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} />
        </Card>
      )}

      {carried.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">{t("carriedIn")}</h2>
          <ul className="flex flex-col gap-1 text-[0.95rem]">
            {carried.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span>{c.description}</span>
                <span className="tabular-nums">{formatINR(c.total_paise)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => {
          const p = previews[i]!;
          return (
            <li key={l.key}>
              <Card className="grid gap-3 md:grid-cols-12 md:items-end">
                {l.kind === "pharmacy" ? (
                  <MedicinePicker line={l} update={(patch) => update(l.key, patch)} />
                ) : (
                  <Field label={t("item")} className="md:col-span-4">
                    {(a) => (
                      <LibraryCombobox
                        id={a.id}
                        kind="service"
                        allowCreate
                        createDefaults={{ price_paise: l.rate_paise ?? 0 }}
                        value={l.service}
                        onChange={(s) => {
                          const d = (s?.defaults ?? {}) as { price_paise?: number; gst_rate_bp?: number; sac?: string | null; category_id?: string | null };
                          update(l.key, (cur) => ({
                            service: s,
                            description: s ? s.label : cur.description,
                            // A service added on the fly has no price yet: keep the rate typed meanwhile.
                            rate_paise: s && d.price_paise ? d.price_paise : cur.rate_paise,
                            gst_rate_bp: s ? (d.gst_rate_bp ?? 0) : cur.gst_rate_bp,
                            hsn_sac: s ? (d.sac ?? "") : cur.hsn_sac,
                            category: s && d.category_id ? item(d.category_id, s.subtitle?.split(" · ")[0] ?? "") : cur.category,
                          }));
                        }}
                      />
                    )}
                  </Field>
                )}
                <Field label={t("description")} className="md:col-span-4" error={!l.description.trim() && l.rate_paise !== null ? t("needDescription") : undefined}>
                  {(a) => <Input {...a} maxLength={300} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />}
                </Field>
                {l.kind !== "pharmacy" && (
                  <Field label={t("category")} className="md:col-span-4">
                    {(a) => <LibraryCombobox id={a.id} kind="bill_category" value={l.category} onChange={(c) => update(l.key, { category: c })} />}
                  </Field>
                )}
                <Field label={t("rate")} className="md:col-span-2">{(a) => <MoneyInput {...a} value={l.rate_paise} onChange={(v) => update(l.key, { rate_paise: v })} />}</Field>
                <Field label={t("qty")} className="md:col-span-1" error={p.error === "invalid_quantity" ? t("badQty") : undefined}>
                  {(a) => <Input {...a} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />}
                </Field>
                <Field label={t("discount")} className="md:col-span-3" error={p.error === "discount_exceeds_gross" ? t("discountTooBig") : undefined}>
                  {(a) => (
                    <div className="flex gap-2">
                      <Select aria-label={t("discountUnit")} className="w-20" value={l.discount_type} onChange={(e) => update(l.key, { discount_type: e.target.value as DiscountType })}>
                        <option value="amount">₹</option>
                        <option value="percent">%</option>
                      </Select>
                      {l.discount_type === "amount" ? (
                        <MoneyInput {...a} value={l.discount_amount} onChange={(v) => update(l.key, { discount_amount: v })} />
                      ) : (
                        <Input {...a} inputMode="decimal" value={l.discount_percent} onChange={(e) => update(l.key, { discount_percent: e.target.value })} />
                      )}
                    </div>
                  )}
                </Field>
                <Field label={t("gst")} className="md:col-span-2">
                  {(a) => (
                    <Select {...a} value={String(l.gst_rate_bp)} onChange={(e) => update(l.key, { gst_rate_bp: Number(e.target.value) })}>
                      {[...new Set([...GST_RATES_BP, l.gst_rate_bp])].map((bp) => (
                        <option key={bp} value={bp}>
                          {bp / 100}%
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex items-end justify-between gap-2 md:col-span-4">
                  <div className="text-right">
                    <p className="text-[0.85rem] text-text-secondary">{t("lineTotal")}</p>
                    <p className="text-lg font-semibold tabular-nums">{p.result ? formatINR(p.result.totalPaise) : "—"}</p>
                    {p.result && p.result.taxPaise > 0 && (
                      <p className="text-[0.85rem] text-text-secondary tabular-nums">
                        {t("taxSplit", { cgst: formatINR(p.result.cgstPaise), sgst: formatINR(p.result.sgstPaise) })}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" aria-label={t("removeLine", { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
                    <Trash2 aria-hidden />
                    {t("remove")}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" className="self-start" onClick={() => setLines((ls) => [...ls, emptyLine(lineKind)])}>
        <CirclePlus aria-hidden />
        {t("addLine")}
      </Button>

      <Card className="ml-auto grid w-full max-w-md grid-cols-2 gap-x-6 gap-y-1 tabular-nums">
        <span className="text-text-secondary">{t("gross")}</span>
        <span className="text-right">{formatINR(totals.grossPaise)}</span>
        <span className="text-text-secondary">{t("discountTotal")}</span>
        <span className="text-right">−{formatINR(totals.discountPaise)}</span>
        <span className="text-text-secondary">{t("taxable")}</span>
        <span className="text-right">{formatINR(totals.taxablePaise)}</span>
        <span className="text-text-secondary">{t("cgst")}</span>
        <span className="text-right">{formatINR(totals.cgstPaise)}</span>
        <span className="text-text-secondary">{t("sgst")}</span>
        <span className="text-right">{formatINR(totals.sgstPaise)}</span>
        {bill.carried_in_paise > 0 && (
          <>
            <span className="text-text-secondary">{t("carriedInTotal")}</span>
            <span className="text-right">{formatINR(bill.carried_in_paise)}</span>
          </>
        )}
        <span className="mt-1 border-t border-border pt-1 text-lg font-semibold">{t("total")}</span>
        <span className="mt-1 border-t border-border pt-1 text-right text-lg font-semibold">{formatINR(totals.totalPaise + bill.carried_in_paise)}</span>
        <span className="col-span-2 text-[0.85rem] text-text-secondary">{t("previewNote")}</span>
      </Card>

      {amend ? (
        <div className="flex flex-wrap items-end justify-end gap-3">
          <Field label={t("amendReason")} className="min-w-72">
            {(a) => <Input {...a} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button disabled={problems || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
            <Save aria-hidden />
            {t("saveAmendment")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>
            <X aria-hidden />
            {t("discardDraft")}
          </Button>
          <Button variant="secondary" disabled={problems || save.isPending} onClick={() => save.mutate()}>
            <Save aria-hidden />
            {t("saveDraft")}
          </Button>
          <Button disabled={problems || save.isPending} onClick={() => void saveThenFinalize()}>
            <CheckCheck aria-hidden />
            {t("finalize")}
          </Button>
        </div>
      )}
      {me?.role !== "admin" && !amend && <p className="text-right text-[0.9rem] text-text-secondary">{t("discountLimitHint")}</p>}

    </div>
  );
}
