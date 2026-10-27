"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarPlus, Phone } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, istDateString } from "@pearl/shared";
import { BookDialog } from "@/components/appointments/book-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { Page } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface Due {
  session_id: string;
  seq: number;
  planned_date: string;
  status: string;
  treatment_id: string;
  treatment: string;
  planned_sessions: number;
  patient_id: string;
  patient: string;
  uhid: string;
  phone: string | null;
  doctor_id: string | null;
}

/** Planned treatment sessions in a date range that still need a booking. */
export function SessionsScreen() {
  const t = useTranslations("sessionsDue");
  const c = useTranslations("common");
  const [from, setFrom] = useState(() => istDateString(new Date()));
  const [to, setTo] = useState(() => istDateString(new Date(Date.now() + 6 * 86_400_000)));
  const [booking, setBooking] = useState<Due | null>(null);
  const rangeCheck = useDateRangeCheck(from, to);
  const list = useInfiniteQuery({
    enabled: rangeCheck.valid,
    queryKey: ["sessions_due", from, to],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: Due[]; next_cursor: string | null }>("sessions_due", { p_from: from, p_to: to, p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("from")} error={rangeCheck.fromError}>{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t("to")} error={rangeCheck.toError}>{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>{t("planned")}</TH>
            <TH>{t("patient")}</TH>
            <TH>{t("treatment")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={4} />}
          {list.isError && <EmptyRow colSpan={4}>{t("rangeTooWide")}</EmptyRow>}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{t("none")}</EmptyRow>}
          {items.map((d) => (
            <TR key={d.session_id}>
              <TD className="whitespace-nowrap">
                {formatDate(new Date(d.planned_date))}
                {d.status === "missed" && <span className="block text-[0.9rem] text-bad-text">{t("missed")}</span>}
              </TD>
              <TD>
                <Link href={`/patients/${d.patient_id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {d.patient}
                </Link>
                <span className="block text-[0.9rem] text-text-secondary">{d.uhid}</span>
              </TD>
              <TD>{t("sessionOf", { name: d.treatment, n: d.seq, total: d.planned_sessions })}</TD>
              <TD className="text-right whitespace-nowrap">
                {d.phone && (
                  <Button asChild variant="ghost">
                    <a href={`tel:${d.phone}`}>
                      <Phone aria-hidden />
                      {t("call")}
                    </a>
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setBooking(d)}>
                  <CalendarPlus aria-hidden />
                  {t("book")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
      <Dialog open={booking !== null} onOpenChange={(o) => !o && setBooking(null)}>
        {booking && (
          <BookDialog
            patient={{ id: booking.patient_id, title: booking.patient, uhid: booking.uhid, subtitle: booking.uhid }}
            date={booking.planned_date < istDateString(new Date()) ? istDateString(new Date()) : booking.planned_date}
            session={{ treatmentId: booking.treatment_id, sessionId: booking.session_id, label: t("sessionOf", { name: booking.treatment, n: booking.seq, total: booking.planned_sessions }) }}
            onDone={() => setBooking(null)}
          />
        )}
      </Dialog>
    </Page>
  );
}
