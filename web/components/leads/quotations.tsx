"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, MessageCircle, Plus, Printer, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatINR, istDateString } from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { PreviewButton } from "@/components/print-preview";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { quotationSchema, quoteSubtotal } from "@/lib/schemas/sales";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { waLink } from "@/lib/whatsapp";

export interface QuoteItem {
  treatment_id: string | null;
  name: string;
  qty: number;
  price_paise: number;
}

export interface Quotation {
  id: string;
  lead_id: string;
  quote_no: number;
  items: QuoteItem[];
  subtotal_paise: number;
  discount_paise: number;
  total_paise: number;
  valid_until: string | null;
  note: string | null;
  message: string;
  sent_count: number;
  last_sent_at: string | null;
  created_at: string;
  lead_name: string;
  lead_phone: string;
  lead_sl_no: number | null;
  created_by_name: string | null;
}

interface Line {
  key: string;
  treatment: { id: string } | null;
  name: string;
  qty: string;
  price: number | null;
}

const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const plusDays = (n: number) => istDateString(new Date(Date.now() + n * 86_400_000));

/**
 * Opens the salesperson's own WhatsApp on the lead's chat with the quotation typed in. The window
 * is opened while the click is still "fresh" (before any request), so the browser doesn't block it.
 */
function openChat(win: Window | null, phone: string, text: string) {
  const url = waLink(phone, text);
  if (win && !win.closed) {
    win.opener = null;
    win.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Lead page card: the lead's quotations, New quotation, and send each on WhatsApp / preview / print. */
export function QuotationsCard({ lead, onChanged }: { lead: { id: string; name: string; phone_e164: string }; onChanged: () => void }) {
  const t = useTranslations("leads.quote");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [making, setMaking] = useState(false);
  const list = useQuery({
    queryKey: ["lead_quotations", lead.id],
    queryFn: () => rpc<Quotation[]>("lead_quotations_list", { p_lead_id: lead.id }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["lead_quotations", lead.id] });
    onChanged();
  };
  const sent = useMutation({
    mutationFn: (id: string) => rpc("mark_quotation_sent", { p_id: id, p_via: "whatsapp" }),
    onSuccess: refresh,
    onError: failed,
  });
  const send = (q: Quotation) => {
    openChat(null, q.lead_phone, q.message);
    sent.mutate(q.id);
    saved(t("opened"));
  };
  const rows = list.data ?? [];

  return (
    <Card className="flex flex-col gap-3" data-testid="quotations">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Button variant="secondary" className="min-h-9 px-3" onClick={() => setMaking(true)}>
          <FilePlus2 aria-hidden />
          {t("new")}
        </Button>
      </div>
      {list.isSuccess && rows.length === 0 && <CardDescription>{t("none")}</CardDescription>}
      <ul className="flex flex-col gap-2">
        {rows.map((q) => (
          <li key={q.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium tabular-nums">
                {t("number", { n: q.quote_no })} · {formatINR(q.total_paise)}
              </span>
              <span className="text-[0.9rem] text-text-secondary">{formatDate(new Date(q.created_at))}</span>
            </div>
            <p className="text-[0.9rem] text-text-secondary">
              {q.items.map((i) => i.name).join(", ")}
              {q.valid_until && ` · ${t("validTill", { date: formatDate(day(q.valid_until)) })}`}
            </p>
            <p className="text-[0.9rem] text-text-secondary">
              {q.sent_count > 0 ? t("sentTimes", { n: q.sent_count }) : t("notSent")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-9 px-3" onClick={() => send(q)} aria-label={t("sendFor", { n: q.quote_no })}>
                <MessageCircle aria-hidden />
                {t("whatsapp")}
              </Button>
              <PreviewButton kind="quotation" id={q.id} open={`/print/quotation/${q.id}`} />
              <Button variant="ghost" className="min-h-9 px-3" asChild>
                <a href={`/print/quotation/${q.id}`} target="_blank" rel="noopener">
                  <Printer aria-hidden />
                  {t("print")}
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > 0 && <CardDescription>{t("pdfHint")}</CardDescription>}
      <Dialog open={making} onOpenChange={setMaking}>
        {making && <QuotationDialog lead={lead} onDone={() => (setMaking(false), refresh())} />}
      </Dialog>
    </Card>
  );
}

/** New quotation: treatments from the price list (price filled in, can be changed), discount, valid till, note. */
export function QuotationDialog({ lead, onDone }: { lead: { id: string; name: string; phone_e164: string }; onDone: () => void }) {
  const t = useTranslations("leads.quote");
  const { saved, failed } = useFeedback();
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<LibraryItem | null>(null);
  const [discount, setDiscount] = useState<number | null>(null);
  const [validUntil, setValidUntil] = useState(() => plusDays(15));
  const [note, setNote] = useState("");
  const [clientId] = useState(newId);
  const checks = useZodForm(quotationSchema());
  const subtotal = quoteSubtotal(lines);
  const total = Math.max(subtotal - (discount ?? 0), 0);

  const addLine = (item: LibraryItem | null) => {
    const price = item && typeof item.defaults.price_paise === "number" ? item.defaults.price_paise : null;
    setLines((ls) => [...ls, { key: newId(), treatment: item ? { id: item.id } : null, name: item?.label ?? "", qty: "1", price }]);
    checks.clear("items");
  };
  const update = (i: number, patch: Partial<Line>, field: string) => {
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
    checks.clear(`items.${i}.${field}`);
  };

  const save = useMutation({
    mutationFn: async ({ data, win }: { data: NonNullable<ReturnType<typeof checks.validate>>; win: Window | null }) => {
      const q = await rpc<Quotation>("save_lead_quotation", {
        p_lead_id: lead.id,
        p_quote: {
          items: data.items.map((i) => ({ treatment_id: i.treatment?.id ?? null, name: i.name, qty: i.qty, price_paise: i.price })),
          discount_paise: data.discount ?? 0,
          valid_until: data.validUntil,
          note: data.note,
        },
        p_client_id: clientId,
      });
      if (win) {
        openChat(win, q.lead_phone, q.message);
        await rpc("mark_quotation_sent", { p_id: q.id, p_via: "whatsapp" });
      }
      return q;
    },
    onSuccess: (_q, v) => {
      saved(v.win ? t("savedOpened") : t("saved"));
      onDone();
    },
    onError: (e, v) => {
      v.win?.close();
      if (!checks.fromServer(e, { items: "items", discount_paise: "discount", valid_until: "validUntil", note: "note" })) failed(e);
    },
  });
  const submit = (andSend: boolean) => {
    const data = checks.validate({ items: lines, discount, validUntil, note });
    if (!data) return;
    // Opened now (inside the click) so it isn't blocked as a pop-up; filled in once saved.
    const win = andSend ? window.open("", "_blank") : null;
    save.mutate({ data, win });
  };

  return (
    <DialogContent
      title={t("newTitle", { name: lead.name })}
      description={t("newHint")}
      wide
      footer={
        <>
          <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}>
            {t("saveOnly")}
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(true)}>
            <Send aria-hidden />
            {t("saveSend")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("addTreatment")} hint={t("addTreatmentHint")} error={checks.error("items")}>
          {(a) => (
            <div className="flex flex-wrap gap-2">
              <LibraryCombobox
                {...a}
                kind="treatment_template"
                value={pick}
                className="min-w-0 flex-1"
                onChange={(item) => {
                  setPick(null);
                  if (item) addLine(item);
                }}
              />
              <Button variant="secondary" onClick={() => addLine(null)}>
                <Plus aria-hidden />
                {t("addOther")}
              </Button>
            </div>
          )}
        </Field>

        {lines.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label={t("lines")}>
            {lines.map((l, i) => (
              <li key={l.key} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_9rem_auto] sm:items-end">
                <Field label={t("name")} error={checks.error(`items.${i}.name`)}>
                  {(a) => <Input {...a} value={l.name} maxLength={200} onChange={(e) => update(i, { name: e.target.value }, "name")} />}
                </Field>
                <Field label={t("qty")} error={checks.error(`items.${i}.qty`)}>
                  {(a) => <Input {...a} inputMode="numeric" value={l.qty} onChange={(e) => update(i, { qty: e.target.value }, "qty")} />}
                </Field>
                <Field label={t("price")} error={checks.error(`items.${i}.price`)}>
                  {(a) => <MoneyInput {...a} value={l.price} onChange={(v) => update(i, { price: v }, "price")} />}
                </Field>
                <Button
                  variant="ghost"
                  aria-label={t("remove", { name: l.name || String(i + 1) })}
                  onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("discount")} error={checks.error("discount")}>
            {(a) => <MoneyInput {...a} value={discount} onChange={(v) => (setDiscount(v), checks.clear("discount"))} />}
          </Field>
          <Field label={t("validUntil")} error={checks.error("validUntil")}>
            {(a) => (
              <DatePicker {...a} min={istDateString(new Date())} value={validUntil} onChange={(v) => (setValidUntil(v), checks.clear("validUntil"))} />
            )}
          </Field>
        </div>
        <Field label={t("note")} hint={t("noteHint")} error={checks.error("note")}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={note} onChange={(e) => (setNote(e.target.value), checks.clear("note"))} />}
        </Field>
        <p className="flex justify-between rounded-xl bg-surface-container-high px-3 py-2 font-medium tabular-nums" data-testid="quote-total">
          <span>{t("total")}</span>
          <span>{formatINR(total)}</span>
        </p>
      </div>
    </DialogContent>
  );
}
