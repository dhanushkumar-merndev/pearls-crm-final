"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { formatDateTime, formatINR } from "@pearl/shared";
import { PaidBills, type PaymentRef, type TimelineItem } from "@/components/patients/timeline-event";
import { Card, CardTitle } from "@/components/ui/card";
import { LoadMore } from "@/components/ui/load-more";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

/**
 * Patient file → Bills: every payment, advance and refund (newest first) with its mode and the
 * bills it paid. Same feed as the timeline (patient_timeline, kind "payment"), keyset-paged.
 */
export function PaymentHistory({ patientId }: { patientId: string }) {
  const t = useTranslations("patientFile.payments");
  const line = useTranslations("patientFile.line");
  const list = useInfiniteQuery({
    queryKey: ["patient_timeline", patientId, "payment"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: TimelineItem[]; next_cursor: string | null }>("patient_timeline", {
        p_patient_id: patientId,
        p_kinds: ["payment"],
        p_cursor: pageParam,
        p_limit: 25,
      }),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
  const rows = (list.data?.pages.flatMap((p) => p.items) ?? []).map((e) => ({ at: e.at, p: e.ref as unknown as PaymentRef }));
  return (
    <Card className="flex flex-col gap-3" data-testid="payment-history">
      <CardTitle>{t("title")}</CardTitle>
      <Table>
        <THead>
          <tr>
            <TH>{t("date")}</TH>
            <TH>{t("what")}</TH>
            <TH>{t("mode")}</TH>
            <TH>{t("for")}</TH>
            <TH className="text-right">{t("amount")}</TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={2} cols={5} />}
          {list.data && rows.length === 0 && <EmptyRow colSpan={5}>{t("none")}</EmptyRow>}
          {rows.map(({ at, p }) => (
            <TR key={p.payment_id} className={cn(p.cancelled && "text-text-secondary")}>
              <TD className="whitespace-nowrap">{formatDateTime(new Date(at))}</TD>
              <TD>
                <span className={cn(p.cancelled && "line-through")}>{t(`kind.${p.kind}`)}</span>
                {p.cancelled && <StatusBadge kind="critical" label={line("cancelled")} className="ml-2" />}
                {p.note && <span className="block text-[0.9rem] text-text-secondary">{p.note}</span>}
              </TD>
              <TD>
                {p.mode ?? "—"}
                {p.reference && <span className="block text-[0.9rem] text-text-secondary">{line("ref", { ref: p.reference })}</span>}
              </TD>
              <TD>{p.bills.length > 0 ? <PaidBills bills={p.bills} /> : p.kind === "advance" ? t("keptAsAdvance") : "—"}</TD>
              <TD className={cn("text-right tabular-nums", p.cancelled && "line-through")}>
                {p.kind === "refund" ? `−${formatINR(p.amount_paise)}` : formatINR(p.amount_paise)}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </Card>
  );
}
