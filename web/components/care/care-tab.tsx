"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { formatDate, formatTime } from "@pearl/shared";
import { AppointmentActions, type ApptCard } from "@/components/appointments/appointment-actions";
import { ApptStatusBadge } from "@/components/appointments/status";
import { PatientAdmissionsTab } from "@/components/admissions/patient-admissions-tab";
import { BillChip, type BillChipData } from "@/components/bills/bill-for";
import type { PatientHit } from "@/components/patients/patient-picker";
import { TreatmentsTab } from "@/components/treatments/treatments-tab";
import { Button } from "@/components/ui/button";
import { LoadMore } from "@/components/ui/load-more";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { newId, rpc } from "@/lib/rpc";
import { viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";

/**
 * Patient file → Care (owner, 02/11/2026: one place instead of Appointments / Treatments / IP stays):
 * each treatment or surgery with its sessions, their prescriptions and bills, and its money; the IP stays;
 * every visit and booking with its prescriptions and bills.
 */
export function CareTab({ patient }: { patient: PatientHit }) {
  const t = useTranslations("care");
  return (
    <div className="flex flex-col gap-8">
      <Section title={t("treatments")} hint={t("treatmentsHint")}>
        <TreatmentsTab patient={patient} />
      </Section>
      <Section title={t("stays")}>
        <PatientAdmissionsTab patient={patient} />
      </Section>
      <Section title={t("visits")} hint={t("visitsHint")}>
        <PatientVisits patientId={patient.id} />
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="max-w-prose text-[0.9rem] text-text-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type VisitRow = ApptCard & {
  appt_date: string;
  visit_id: string | null;
  session?: { id: string; seq: number; treatment: string } | null;
  /** Missing until the care-links database update is online. */
  bills?: BillChipData[];
  documents?: { id: string; title: string; file_id: string }[];
};

const VISITED = new Set(["arrived", "with_doctor", "done"]);

/** Every booking and visit, newest first: what it was for, its prescriptions and bills, and its actions. */
function PatientVisits({ patientId }: { patientId: string }) {
  const t = useTranslations("care");
  const p = useTranslations("patientFile");
  const c = useTranslations("common");
  const tr = useTranslations("treatments");
  const router = useRouter();
  const { failed } = useFeedback();
  const back = `/patients/${patientId}?tab=care`;
  const list = useInfiniteQuery({
    queryKey: ["patient_appointments", patientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: VisitRow[]; next_cursor: string | null }>("patient_appointments", { p_patient_id: patientId, p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
  const items = list.data?.pages.flatMap((x) => x.items) ?? [];
  const [billing, setBilling] = useState<string | null>(null);
  const makeBill = useMutation({
    mutationFn: (a: VisitRow) =>
      rpc<{ id: string }>("create_bill", { p_type: "procedure_receipt", p_patient_id: patientId, p_links: { appointment_id: a.id }, p_client_id: newId() }),
    onMutate: (a) => setBilling(a.id),
    onSuccess: (b) => router.push(`/bills/${b.id}?back=${encodeURIComponent(back)}`),
    onError: (e) => {
      setBilling(null);
      failed(e);
    },
  });
  const openDoc = async (fileId: string) => {
    try {
      const urls = await viewUrls([fileId]);
      if (urls[fileId]) window.open(urls[fileId], "_blank", "noopener");
    } catch (e) {
      failed(e);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <tr>
            <TH>{p("apptWhen")}</TH>
            <TH>{t("for")}</TH>
            <TH>{p("apptDoctor")}</TH>
            <TH>{c("status")}</TH>
            <TH>{t("rxAndBills")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={6} />}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={6}>{p("noAppointments")}</EmptyRow>}
          {items.map((a) => (
            <TR key={a.id}>
              <TD className="whitespace-nowrap tabular-nums">
                {formatDate(new Date(a.appt_date))} {a.slot_start ? formatTime(new Date(a.slot_start)) : p("walkIn")}
              </TD>
              <TD>{a.session ? `${a.session.treatment} — ${tr("sessionN", { n: a.session.seq })}` : t("consultation")}</TD>
              <TD>{a.doctor ?? "—"}</TD>
              <TD>
                <ApptStatusBadge status={a.status} />
              </TD>
              <TD>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(a.documents ?? []).map((d) => (
                    <Button key={d.id} variant="ghost" onClick={() => void openDoc(d.file_id)} aria-label={t("openDoc", { title: d.title })}>
                      <FileText aria-hidden />
                      {d.title}
                    </Button>
                  ))}
                  {(a.bills ?? []).map((b) => <BillChip key={b.id} bill={b} back={back} />)}
                  {VISITED.has(a.status) && (a.bills ?? []).length === 0 && (
                    <Button variant="ghost" disabled={makeBill.isPending} onClick={() => makeBill.mutate(a)} aria-label={t("billVisit", { date: formatDate(new Date(a.appt_date)) })}>
                      {billing === a.id ? <Loader2 aria-hidden className="animate-spin" /> : <Receipt aria-hidden />}
                      {tr("bill")}
                    </Button>
                  )}
                </div>
              </TD>
              <TD className="text-right">
                <AppointmentActions appt={a} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </div>
  );
}
