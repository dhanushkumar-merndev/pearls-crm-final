"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CirclePlus, PackageCheck, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import { GST_RATES_BP, MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { expiryLabel, qtyLabel } from "@/components/pharmacy/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { purchaseSchema } from "@/lib/schemas/pharmacy";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface PurchaseLine {
  id: string;
  item_id: string;
  item: string;
  strength: string | null;
  sell_unit: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  free_qty: number;
  purchase_price_paise: number;
  mrp_paise: number;
  selling_price_paise: number;
  gst_rate_bp: number;
  line_total_paise: number;
}
export interface Purchase {
  id: string;
  supplier_id: string;
  supplier: string;
  invoice_no: string;
  invoice_date: string;
  status: "draft" | "posted";
  total_paise: number;
  notes: string | null;
  version: number;
  posted_at: string | null;
  items: PurchaseLine[];
}
interface Line {
  key: string;
  item: LibraryItem | null;
  batch_no: string;
  /** "YYYY-MM" from the month picker */
  expiry: string;
  qty: string;
  free_qty: string;
  purchase_price_paise: number | null;
  mrp_paise: number | null;
  selling_price_paise: number | null;
  gst_rate_bp: number;
}

const blank = (): Line => ({
  key: newId(), item: null, batch_no: "", expiry: "", qty: "", free_qty: "", purchase_price_paise: null, mrp_paise: null,
  selling_price_paise: null, gst_rate_bp: 0,
});
const fromStored = (l: PurchaseLine): Line => ({
  key: l.id,
  item: { id: l.item_id, label: l.item, subtitle: l.strength, on_the_fly: false, defaults: {} },
  batch_no: l.batch_no,
  expiry: l.expiry_date.slice(0, 7),
  qty: String(Number(l.qty)),
  free_qty: Number(l.free_qty) ? String(Number(l.free_qty)) : "",
  purchase_price_paise: l.purchase_price_paise,
  mrp_paise: l.mrp_paise,
  selling_price_paise: l.selling_price_paise || null,
  gst_rate_bp: l.gst_rate_bp,
});

/** Same rule as the database: qty × price, plus GST on that, each rounded to the paisa. */
function lineTotal(l: Line): number | null {
  const qty = Number(l.qty);
  if (l.purchase_price_paise === null || !Number.isFinite(qty) || qty <= 0) return null;
  const base = Math.round(qty * l.purchase_price_paise);
  return base + Math.round((qty * l.purchase_price_paise * l.gst_rate_bp) / 10000);
}

/** Supplier invoice: a draft until posted; posting adds the batches to stock (final). */
export function PurchaseScreen({ initial }: { initial: Purchase | null }) {
  const t = useTranslations("pharmacy");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [id] = useState(() => initial?.id ?? newId());
  const [version, setVersion] = useState<number | null>(initial?.version ?? null);
  const [supplier, setSupplier] = useState<LibraryItem | null>(
    initial ? { id: initial.supplier_id, label: initial.supplier, subtitle: null, on_the_fly: false, defaults: {} } : null,
  );
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoice_no ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoice_date ?? istDateString(new Date()));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial?.items.length ? initial.items.map(fromStored) : [blank()]));
  const [confirming, setConfirming] = useState(false);
  // A patch can be a function of the line as it is now: pickers answer after a round trip,
  // and must not overwrite what was typed meanwhile.
  const checks = useZodForm(purchaseSchema);
  const update = (key: string, patch: Partial<Line> | ((current: Line) => Partial<Line>)) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)));
    const i = lines.findIndex((l) => l.key === key);
    for (const f of ["item", "batch_no", "expiry", "qty", "free_qty", "purchase_price_paise", "mrp_paise", "selling_price_paise"]) checks.clear(`lines.${i}.${f}`);
  };
  const lineError = (i: number, f: string) => checks.error(`lines.${i}.${f}`);
  const totals = useMemo(() => lines.map(lineTotal), [lines]);
  const total = totals.reduce<number>((s, x) => s + (x ?? 0), 0);
  type Checked = z.output<typeof purchaseSchema>;
  const checkAll = () => checks.validate({ supplier, invoice_no: invoiceNo, invoice_date: invoiceDate, notes, lines });

  const save = useMutation({
    mutationFn: (d: Checked) =>
      rpc<Purchase>("save_purchase", {
        p_purchase: {
          supplier_id: d.supplier,
          invoice_no: d.invoice_no,
          invoice_date: d.invoice_date,
          notes: d.notes,
          items: d.lines.map((l) => ({
            item_id: l.item,
            batch_no: l.batch_no.toUpperCase(),
            expiry_date: `${l.expiry}-01`,
            qty: l.qty,
            free_qty: l.free_qty ?? 0,
            purchase_price_paise: l.purchase_price_paise,
            mrp_paise: l.mrp_paise ?? 0,
            selling_price_paise: l.selling_price_paise ?? 0,
            gst_rate_bp: l.gst_rate_bp,
          })),
        },
        p_client_id: id,
        p_version: version,
      }),
    onSuccess: (p) => {
      setVersion(p.version);
      if (!initial) router.replace(`/pharmacy/purchases/${p.id}`, { scroll: false });
      return p;
    },
    onError: (e) => {
      if (asAppError(e).code === "duplicate") return checks.setError("invoice_no", "pharmacy.duplicateInvoice");
      failed(e);
    },
  });
  const post = useMutation({
    mutationFn: async (d: Checked) => {
      const p = await save.mutateAsync(d);
      return rpc<Purchase>("post_purchase", { p_purchase_id: p.id, p_version: p.version });
    },
    onSuccess: (p) => {
      saved(t("posted", { no: p.invoice_no }));
      for (const key of ["purchases", "stock_table", "pharmacy_summary", "pharmacy_alerts", "batches"]) void queryClient.invalidateQueries({ queryKey: [key] });
      setConfirming(false);
      router.refresh();
    },
    onError: failed,
  });
  const discard = useMutation({
    mutationFn: () => rpc("discard_purchase", { p_purchase_id: id }),
    onSuccess: () => router.push("/pharmacy?tab=purchases"),
    onError: failed,
  });

  if (initial?.status === "posted") return <PostedPurchase p={initial} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href="/pharmacy?tab=purchases">
            <ArrowLeft aria-hidden />
            {t("backToPurchases")}
          </Link>
        </Button>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{initial ? t("purchaseTitle", { no: initial.invoice_no }) : t("newPurchase")}</h1>
        <p className="mt-1 text-text-secondary">{t("purchaseHint")}</p>
      </div>

      <Card className="grid gap-4 sm:grid-cols-3">
        <Field label={t("col.supplier")} error={checks.error("supplier")}>
          {(a) => <LibraryCombobox {...a} kind="supplier" allowCreate value={supplier} onChange={(v) => (setSupplier(v), checks.clear("supplier"))} />}
        </Field>
        <Field label={t("invoiceNo")} error={checks.error("invoice_no")}>
          {(a) => <Input {...a} maxLength={60} value={invoiceNo} onChange={(e) => (setInvoiceNo(e.target.value), checks.clear("invoice_no"))} />}
        </Field>
        <Field label={t("invoiceDate")} error={checks.error("invoice_date")}>
          {(a) => <Input {...a} type="date" value={invoiceDate} onChange={(e) => (setInvoiceDate(e.target.value), checks.clear("invoice_date"))} />}
        </Field>
      </Card>

      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <li key={l.key}>
            <Card className="grid gap-3 md:grid-cols-12 md:items-end">
              <Field label={t("col.medicine")} className="md:col-span-4" error={lineError(i, "item")}>
                {(a) => (
                  <LibraryCombobox
                    {...a}
                    kind="pharmacy_item"
                    allowCreate
                    value={l.item}
                    onChange={(m) => {
                      const d = (m?.defaults ?? {}) as { mrp_paise?: number; purchase_price_paise?: number; gst_rate_bp?: number };
                      update(l.key, (cur) => ({
                        item: m,
                        mrp_paise: cur.mrp_paise ?? (d.mrp_paise || null),
                        purchase_price_paise: cur.purchase_price_paise ?? (d.purchase_price_paise || null),
                        gst_rate_bp: d.gst_rate_bp ?? cur.gst_rate_bp,
                      }));
                    }}
                  />
                )}
              </Field>
              <Field label={t("col.batch")} className="md:col-span-2" error={lineError(i, "batch_no")}>
                {(a) => <Input {...a} maxLength={40} value={l.batch_no} onChange={(e) => update(l.key, { batch_no: e.target.value.toUpperCase() })} />}
              </Field>
              <Field label={t("col.expiry")} className="md:col-span-2" error={lineError(i, "expiry")}>
                {(a) => <Input {...a} type="month" value={l.expiry} onChange={(e) => update(l.key, { expiry: e.target.value })} />}
              </Field>
              <Field label={t("col.qty")} className="md:col-span-2" hint={l.item ? t("inUnits") : undefined} error={lineError(i, "qty")}>
                {(a) => <Input {...a} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />}
              </Field>
              <Field label={t("freeQty")} className="md:col-span-2" error={lineError(i, "free_qty")}>
                {(a) => <Input {...a} inputMode="decimal" value={l.free_qty} onChange={(e) => update(l.key, { free_qty: e.target.value })} />}
              </Field>
              <Field label={t("purchasePrice")} className="md:col-span-3" hint={t("purchasePriceHint")} error={lineError(i, "purchase_price_paise")}>
                {(a) => <MoneyInput {...a} value={l.purchase_price_paise} onChange={(v) => update(l.key, { purchase_price_paise: v })} />}
              </Field>
              <Field label={t("col.mrp")} className="md:col-span-3" error={lineError(i, "mrp_paise")}>
                {(a) => <MoneyInput {...a} value={l.mrp_paise} onChange={(v) => update(l.key, { mrp_paise: v })} />}
              </Field>
              <Field label={t("sellingPrice")} className="md:col-span-2" hint={t("sellingPriceHint")} error={lineError(i, "selling_price_paise")}>
                {(a) => <MoneyInput {...a} value={l.selling_price_paise} onChange={(v) => update(l.key, { selling_price_paise: v })} />}
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
              <div className="flex items-end justify-between gap-2 md:col-span-2">
                <p className="text-lg font-semibold tabular-nums">{totals[i] === null ? "—" : formatINR(totals[i]!)}</p>
                <Button variant="ghost" aria-label={t("removeLine", { n: i + 1 })} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <Button variant="secondary" className="self-start" onClick={() => (setLines((ls) => [...ls, blank()]), checks.clear("lines"))}>
        <CirclePlus aria-hidden />
        {t("addLine")}
      </Button>
      {checks.error("lines") && (
        <p role="alert" className="text-bad-text">
          {checks.error("lines")}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <Field label={t("notes")} error={checks.error("notes")}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={notes} onChange={(e) => (setNotes(e.target.value), checks.clear("notes"))} />}
        </Field>
        <p className="text-right text-lg font-semibold tabular-nums">{t("invoiceTotal", { amount: formatINR(total) })}</p>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        {initial && (
          <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>
            <X aria-hidden />
            {t("discardDraft")}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            const d = checkAll();
            if (d) save.mutate(d, { onSuccess: () => saved(t("draftSaved")) });
          }}
        >
          <Save aria-hidden />
          {t("saveDraft")}
        </Button>
        <Button disabled={save.isPending || post.isPending} onClick={() => checkAll() && setConfirming(true)}>
          <PackageCheck aria-hidden />
          {t("postToStock")}
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        {confirming && (
          <DialogContent
            title={t("postTitle")}
            description={t("postHint", { amount: formatINR(total) })}
            footer={
              <Button
                disabled={post.isPending}
                onClick={() => {
                  const d = checkAll();
                  if (d) post.mutate(d);
                }}
              >
                <PackageCheck aria-hidden />
                {t("postToStock")}
              </Button>
            }
          >
            <ul className="flex flex-col gap-1">
              {lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-3">
                  <span>
                    {l.item?.label} · {l.batch_no} · {expiryLabel(`${l.expiry}-01`)}
                  </span>
                  <span className="tabular-nums">+{qtyLabel(Number(l.qty) + Number(l.free_qty || 0))}</span>
                </li>
              ))}
            </ul>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function PostedPurchase({ p }: { p: Purchase }) {
  const t = useTranslations("pharmacy");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href="/pharmacy?tab=purchases">
            <ArrowLeft aria-hidden />
            {t("backToPurchases")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("purchaseTitle", { no: p.invoice_no })}</h1>
          <StatusBadge kind="good" label={t("purchaseStatus.posted")} />
        </div>
        <p className="mt-1 text-text-secondary">
          {p.supplier} · {formatDate(new Date(`${p.invoice_date}T00:00:00+05:30`))}
        </p>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>{t("col.medicine")}</TH>
            <TH>{t("col.batch")}</TH>
            <TH>{t("col.expiry")}</TH>
            <TH className="text-right">{t("col.qty")}</TH>
            <TH className="text-right">{t("purchasePrice")}</TH>
            <TH className="text-right">{t("gst")}</TH>
            <TH className="text-right">{t("col.total")}</TH>
          </tr>
        </THead>
        <tbody>
          {p.items.map((l) => (
            <TR key={l.id}>
              <TD>
                <Link href={`/pharmacy/items/${l.item_id}`} className="text-link underline-offset-4 hover:underline">
                  {l.item}
                </Link>
              </TD>
              <TD>{l.batch_no}</TD>
              <TD className="tabular-nums">{expiryLabel(l.expiry_date)}</TD>
              <TD className="text-right tabular-nums">
                {qtyLabel(l.qty)}
                {Number(l.free_qty) > 0 && <span className="text-text-secondary"> + {qtyLabel(l.free_qty)}</span>}
              </TD>
              <TD className="text-right tabular-nums">{formatINR(l.purchase_price_paise)}</TD>
              <TD className="text-right tabular-nums">{l.gst_rate_bp / 100}%</TD>
              <TD className="text-right tabular-nums">{formatINR(l.line_total_paise)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <p className="text-right text-lg font-semibold tabular-nums">{t("invoiceTotal", { amount: formatINR(p.total_paise) })}</p>
      {p.notes && <p className="text-text-secondary">{p.notes}</p>}
    </div>
  );
}
