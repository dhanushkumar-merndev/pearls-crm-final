"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatTime, istDateString } from "@pearl/shared";
import { AppointmentActions } from "@/components/appointments/appointment-actions";
import { ApptStatusBadge, type ApptStatus } from "@/components/appointments/status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { Page } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rpc } from "@/lib/rpc";
import { useUrlTab } from "@/lib/use-url-param";

export interface SalesBooking {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_sl_no: number | null;
  patient_id: string | null;
  doctor_id: string | null;
  doctor: string | null;
  appt_date: string;
  slot_start: string | null;
  status: ApptStatus;
  auto_cancelled: boolean;
  version: number;
}

const SCOPES = ["upcoming", "confirm", "past"] as const;

/**
 * Bookings of my leads (owner 20/11/2026: "booking or appointment, where to see?"): upcoming, waiting
 * for the patient's confirmation, and the last 90 days. Same actions as the lead page.
 */
export function BookingsScreen() {
  const [scope, setScope] = useUrlTab(SCOPES, "upcoming");
  const t = useTranslations("bookings");
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs value={scope} onValueChange={setScope} className="flex flex-col gap-4">
        <TabsList aria-label={t("which")}>
          {SCOPES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`scope.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {SCOPES.map((s) => (
          <TabsContent key={s} value={s}>
            <BookingList scope={s} />
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

/** "Today", "Tomorrow" or the date, in IST. */
function useDayLabel() {
  const t = useTranslations("bookings");
  // Read the clock once (not on every render).
  const [{ today, tomorrow }] = useState(() => {
    const now = Date.now();
    return { today: istDateString(new Date(now)), tomorrow: istDateString(new Date(now + 86_400_000)) };
  });
  return (day: string) => (day === today ? t("today") : day === tomorrow ? t("tomorrow") : formatDate(new Date(`${day}T00:00:00+05:30`)));
}

function BookingList({ scope }: { scope: (typeof SCOPES)[number] }) {
  const t = useTranslations("bookings");
  const c = useTranslations("common");
  const dayLabel = useDayLabel();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ["sales_bookings", scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: SalesBooking[]; next_cursor: string | null }>("sales_bookings", { p_scope: scope, p_cursor: pageParam, p_limit: 50 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  // A change shows in every tab (a confirmed booking leaves "To confirm" and reads Confirmed under Upcoming).
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sales_bookings"] });
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <tr>
            <TH>{t("when")}</TH>
            <TH>{t("lead")}</TH>
            <TH>{t("doctor")}</TH>
            <TH>{t("status")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={5} />}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={5}>{t(`none.${scope}`)}</EmptyRow>}
          {items.map((b) => (
            <TR key={b.id} data-testid="booking-row">
              <TD className="whitespace-nowrap">
                <span className="font-medium">{dayLabel(b.appt_date)}</span>
                {b.slot_start && <span className="block text-[0.9rem] text-text-secondary">{formatTime(new Date(b.slot_start))}</span>}
              </TD>
              <TD>
                <Link href={`/leads/${b.lead_id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {b.lead_name}
                </Link>
                <span className="block text-[0.9rem] text-text-secondary">{b.lead_phone}</span>
              </TD>
              <TD>{b.doctor ?? "—"}</TD>
              <TD>
                <ApptStatusBadge status={b.status} auto={b.auto_cancelled} />
              </TD>
              <TD className="text-right whitespace-nowrap">
                <Button asChild variant="ghost">
                  <a href={`tel:${b.lead_phone}`} aria-label={t("callFor", { name: b.lead_name })}>
                    <Phone aria-hidden />
                    {t("call")}
                  </a>
                </Button>
                {scope !== "past" && (
                  <AppointmentActions
                    appt={{
                      id: b.id,
                      status: b.status,
                      slot_start: b.slot_start,
                      doctor_id: b.doctor_id,
                      doctor: b.doctor,
                      patient_id: b.patient_id,
                      patient: b.lead_name,
                      uhid: null,
                      phone: b.lead_phone,
                      version: b.version,
                      is_walk_in: false,
                      queue_no: null,
                      lead_only: !b.patient_id,
                      lead_id: b.lead_id,
                      lead_sl_no: b.lead_sl_no,
                      auto_cancelled: b.auto_cancelled,
                    }}
                    onChanged={refresh}
                  />
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </div>
  );
}
