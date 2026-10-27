"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, formatINR } from "@pearl/shared";
import { expiryLabel, qtyLabel } from "@/components/pharmacy/format";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { DetailHeader, Page } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { newId, rpc } from "@/lib/rpc";
import { ADJUST_KINDS, adjustStockSchema } from "@/lib/schemas/pharmacy";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Batch {
  id: string;
  batch_no: string;
  expiry_date: string;
  qty_on_hand: number;
  mrp_paise: number;
  purchase_price_paise: number;
  selling_price_paise: number;
  supplier: string | null;
  expired: boolean;
}
export interface ItemStock {
  item: { id: string; name: string; strength: string | null; form: string | null; manufacturer: string | null; sell_unit: string; reorder_level: number; rack: string | null; gst_rate_bp: number };
  on_hand: number;
  batches: Batch[];
}
interface Move {
  id: number;
  at: string;
  kind: string;
  qty: number;
  batch_no: string;
  reason: string | null;
  by: string | null;
  ref_table: string | null;
  ref_id: string | null;
  ref_no: string | null;
}

/** One medicine: batches (FEFO order) with adjustments, and its stock ledger. */
export function ItemScreen({ initial }: { initial: ItemStock }) {
  const t = useTranslations("pharmacy");
  const id = initial.item.id;
  const stock = useQuery({ queryKey: ["item_stock", id], initialData: initial, queryFn: () => rpc<ItemStock>("item_stock", { p_item_id: id }) });
  const ledger = useInfiniteQuery({
    queryKey: ["stock_ledger", id],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => rpc<{ items: Move[]; next_cursor: number | null }>("stock_ledger", { p_item_id: id, p_cursor: pageParam, p_limit: 25 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const [adjusting, setAdjusting] = useState<Batch | null>(null);
  const s = stock.data;
  const i = s.item;
  return (
    <Page>
      <DetailHeader
        back={{ href: "/pharmacy", label: t("backToPharmacy") }}
        title={i.name}
        meta={[i.strength, i.form, i.manufacturer, i.rack && t("rackLabel", { rack: i.rack }), t("gstLabel", { rate: i.gst_rate_bp / 100 })].filter(Boolean).join(" · ")}
        description={
          <span className="text-lg text-foreground">
            {t("onHandLine", { n: qtyLabel(s.on_hand), unit: i.sell_unit })}
            {i.reorder_level > 0 && <span className="text-text-secondary"> · {t("reorderAt", { n: qtyLabel(i.reorder_level) })}</span>}
          </span>
        }
      />

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("batches")}</CardTitle>
        <Table>
          <THead>
            <tr>
              <TH>{t("col.batch")}</TH>
              <TH>{t("col.expiry")}</TH>
              <TH className="text-right">{t("col.onHand")}</TH>
              <TH className="text-right">{t("col.mrp")}</TH>
              <TH className="text-right">{t("col.cost")}</TH>
              <TH>{t("col.supplier")}</TH>
              <TH>
                <span className="sr-only">{t("adjust")}</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {s.batches.length === 0 && <EmptyRow colSpan={7}>{t("noBatches")}</EmptyRow>}
            {s.batches.map((b) => (
              <TR key={b.id}>
                <TD className="font-medium">{b.batch_no}</TD>
                <TD className="tabular-nums">
                  {expiryLabel(b.expiry_date)} {b.expired && <StatusBadge kind="critical" label={t("alert.expired")} className="ml-1" />}
                </TD>
                <TD className="text-right tabular-nums">{qtyLabel(b.qty_on_hand)}</TD>
                <TD className="text-right tabular-nums">{formatINR(b.mrp_paise)}</TD>
                <TD className="text-right tabular-nums">{formatINR(b.purchase_price_paise)}</TD>
                <TD>{b.supplier ?? "—"}</TD>
                <TD className="text-right">
                  <Button variant="ghost" aria-label={t("adjustBatch", { no: b.batch_no })} onClick={() => setAdjusting(b)}>
                    <SlidersHorizontal aria-hidden />
                    {t("adjust")}
                  </Button>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("ledger")}</CardTitle>
        <Table>
          <THead>
            <tr>
              <TH>{t("col.when")}</TH>
              <TH>{t("col.movement")}</TH>
              <TH>{t("col.batch")}</TH>
              <TH className="text-right">{t("col.qty")}</TH>
              <TH>{t("col.by")}</TH>
            </tr>
          </THead>
          <tbody>
            {ledger.isPending && <RowSkeletons asRow rows={3} cols={5} />}
            {ledger.data?.pages[0]?.items.length === 0 && <EmptyRow colSpan={5}>{t("noMoves")}</EmptyRow>}
            {ledger.data?.pages.flatMap((p) => p.items).map((m) => (
              <TR key={m.id}>
                <TD className="whitespace-nowrap">{formatDateTime(new Date(m.at))}</TD>
                <TD>
                  {t(`move.${m.kind}`)}
                  {m.ref_table === "bills" && m.ref_id && (
                    <Link href={`/bills/${m.ref_id}`} className="ml-1 text-link underline-offset-4 hover:underline">
                      {m.ref_no ?? t("draftBill")}
                    </Link>
                  )}
                  {m.ref_table === "purchases" && m.ref_id && (
                    <Link href={`/pharmacy/purchases/${m.ref_id}`} className="ml-1 text-link underline-offset-4 hover:underline">
                      {m.ref_no}
                    </Link>
                  )}
                  {m.reason && <span className="block text-[0.9rem] text-text-secondary">{m.reason}</span>}
                </TD>
                <TD>{m.batch_no}</TD>
                <TD className={`text-right tabular-nums ${m.qty < 0 ? "text-bad-text" : "text-good-text"}`}>
                  {m.qty > 0 ? "+" : "−"}
                  {qtyLabel(Math.abs(m.qty))}
                </TD>
                <TD>{m.by ?? "—"}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <LoadMore hasMore={ledger.hasNextPage} loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()} />
      </Card>

      <Dialog open={adjusting !== null} onOpenChange={(o) => !o && setAdjusting(null)}>
        {adjusting && <AdjustDialog itemId={id} batch={adjusting} onDone={() => setAdjusting(null)} />}
      </Dialog>
    </Page>
  );
}

const KINDS = ADJUST_KINDS;

function AdjustDialog({ itemId, batch, onDone }: { itemId: string; batch: Batch; onDone: () => void }) {
  const t = useTranslations("pharmacy");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [kind, setKind] = useState<(typeof KINDS)[number]>(batch.expired ? "expired" : "damaged");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [clientId] = useState(newId);
  const [schema] = useState(() => adjustStockSchema(batch.qty_on_hand));
  const checks = useZodForm(schema);
  const adjust = useMutation({
    mutationFn: (d: { kind: string; qty: number; reason: string }) =>
      rpc("adjust_stock", { p_batch_id: batch.id, p_kind: d.kind, p_qty: d.qty, p_reason: d.reason, p_client_id: clientId }),
    onSuccess: () => {
      saved(t("adjusted"));
      for (const key of [["item_stock", itemId], ["stock_ledger", itemId], ["stock_table"], ["pharmacy_summary"], ["pharmacy_alerts"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("adjustBatch", { no: batch.batch_no })}
      description={t("adjustHint", { n: qtyLabel(batch.qty_on_hand) })}
      footer={
        <Button
          disabled={adjust.isPending}
          onClick={() => {
            const d = checks.validate({ kind, qty, reason });
            if (d) adjust.mutate(d);
          }}
        >
          <SlidersHorizontal aria-hidden />
          {t("saveAdjustment")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("adjustKind")} error={checks.error("kind")}>
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => (setKind(e.target.value as typeof kind), checks.clear("qty"))}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`move.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={kind === "count_correction" ? t("countedQty") : t("adjustQty")}
          hint={kind === "count_correction" ? t("countedHint") : undefined}
          error={checks.error("qty")}
        >
          {(a) => <Input {...a} inputMode="decimal" value={qty} onChange={(e) => (setQty(e.target.value), checks.clear("qty"))} />}
        </Field>
        <Field label={t("reason")} error={checks.error("reason")}>
          {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
