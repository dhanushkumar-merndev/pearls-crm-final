"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CalendarX2, Flag, IndianRupee, Link2, MessageSquarePlus, Pencil, Phone, PhoneCall, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { formatDate, formatDateTime, formatINR, fromIstDateTimeLocal, istDateTimeLocal, optionalDateTime, requiredItem, requiredText } from "@pearl/shared";
import { ApptStatusBadge } from "@/components/appointments/status";
import { BookDialog } from "@/components/appointments/book-dialog";
import type { ApptStatus } from "@/components/appointments/status";
import { AmountDialog, DeleteLeadDialog, EditLeadDialog, LogCallDialog } from "@/components/leads/lead-dialogs";
import { StageBadge } from "@/components/leads/stage-badge";
import { StageDialog } from "@/components/leads/stage-dialog";
import type { Lead } from "@/components/leads/types";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { RecordingsList } from "@/components/recordings/recordings-list";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { MoreMenu } from "@/components/ui/more-menu";
import { DetailHeader, Page } from "@/components/ui/page";
import { WhatsAppPanel } from "@/components/whatsapp/whatsapp-panel";
import { newId, rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

export interface LeadDetail extends Lead {
  created_at: string;
  patient: {
    patient_id: string;
    name: string;
    uhid: string;
    upcoming: { id: string; slot_start: string; status: ApptStatus; doctor: string | null }[];
    last_visit: string | null;
    treatment: { name: string; status: string; agreed_price_paise: number | null; start_date: string } | null;
    agreed_price_paise: number | null;
  } | null;
  duplicates: { id: string; sl_no: number; name: string; stage: Lead["stage"]; lead_date: string; assigned_name: string | null; phone_e164: string }[];
  appointments: { id: string; slot_start: string | null; status: ApptStatus; type: string; doctor: string | null }[];
  followups: { id: string; kind: string; due_date: string; due_at: string | null; reason: string | null }[];
  calls: { id: string; started_at: string; direction: string; duration_s: number; outcome: string | null; notes: string | null; staff_name: string | null }[];
}
interface Activity {
  id: string;
  kind: string;
  body: string | null;
  data: Record<string, unknown>;
  at: string;
  staff_name: string | null;
}

type DialogKind = "stage" | "edit" | "amount" | "call" | "book" | "delete" | null;
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const minutes = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** One lead: details, stage, agreed amount, follow-up, bookings, calls and the activity history. */
export function LeadScreen({ initial }: { initial: LeadDetail }) {
  const t = useTranslations("leads");
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const lead = useQuery({
    queryKey: ["lead_detail", initial.id],
    initialData: initial,
    queryFn: () => rpc<LeadDetail>("lead_detail", { p_id: initial.id }),
  });
  const l = lead.data;
  const [dialog, setDialog] = useState<DialogKind>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["lead_detail", l.id] });
    void queryClient.invalidateQueries({ queryKey: ["lead_activities", l.id] });
    void queryClient.invalidateQueries({ queryKey: ["leads_table"] });
    void queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
  };
  const done = () => {
    setDialog(null);
    refresh();
  };
  const isAdmin = me?.role === "admin";

  return (
    <Page>
      <DetailHeader
        back={{ href: "/leads", label: t("backToLeads") }}
        title={l.name}
        badges={
          <>
            <StageBadge stage={l.stage} />
            <span className="text-text-secondary tabular-nums">#{l.sl_no}</span>
          </>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`tel:${l.phone_e164}`} className="inline-flex min-h-8 items-center gap-1 text-link underline-offset-4 hover:underline">
              <Phone aria-hidden className="size-4" />
              {l.phone_e164}
            </a>
            {l.alt_phone_e164 && <span>{l.alt_phone_e164}</span>}
            <span>{t("cameIn", { date: formatDate(day(l.lead_date)), via: t(`via.${l.created_via}`) })}</span>
            <span>{l.assigned_name ? t("ownerIs", { name: l.assigned_name }) : t("unassigned")}</span>
          </span>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog("call")}>
          <PhoneCall aria-hidden />
          {t("logCall")}
        </Button>
        <Button variant="secondary" onClick={() => setDialog("stage")}>
          <Flag aria-hidden />
          {t("changeStage")}
        </Button>
        <Button variant="secondary" onClick={() => setDialog("book")}>
          <CalendarPlus aria-hidden />
          {t("bookConsultation")}
        </Button>
        <MoreMenu>
          <DropdownMenuItem onSelect={() => setDialog("amount")}>
            <IndianRupee aria-hidden />
            {t("setAmount")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <Pencil aria-hidden />
            {t("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("delete")}>
            <Trash2 aria-hidden />
            {t("delete")}
          </DropdownMenuItem>
        </MoreMenu>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-5">
          <Card className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <CardTitle className="sm:col-span-2">{t("details")}</CardTitle>
            <Info label={t("f.treatment")} value={l.treatment} />
            <Info label={t("f.source")} value={l.source_label} />
            <Info label={t("f.doctor")} value={l.doctor_name} />
            <Info label={t("f.referredBy")} value={l.referred_by_text} />
            <Info label={t("f.email")} value={l.email} />
            <Info label={t("f.mode")} value={l.appointment_mode ? t(`mode.${l.appointment_mode}`) : null} />
            <Info label={t("f.surgeryDate")} value={l.surgery_date ? formatDate(day(l.surgery_date)) : null} />
            <Info label={t("f.amountQuoted")} value={l.amount_quoted_paise !== null ? formatINR(l.amount_quoted_paise) : null} />
            <Info
              label={t("f.amountFinalised")}
              value={l.amount_finalised_paise !== null ? `${formatINR(l.amount_finalised_paise)}${l.amount_locked ? ` · ${t("locked")}` : ""}` : null}
            />
            {l.stage === "lost" && <Info label={t("f.lostReason")} value={l.lost_reason} />}
            <Info label={t("f.comments1")} value={l.comments1} wide />
            <Info label={t("f.comments2")} value={l.comments2} wide />
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle>{t("bookings")}</CardTitle>
            {l.appointments.length === 0 && <p className="text-text-secondary">{t("noBookings")}</p>}
            <ul className="flex flex-col gap-2">
              {l.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                  <span className="font-medium tabular-nums">{a.slot_start ? formatDateTime(new Date(a.slot_start)) : "—"}</span>
                  <span className="flex-1 text-text-secondary">{a.doctor ?? ""}</span>
                  <ApptStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
            {l.appointments.some((a) => a.status === "pending_confirmation") && <CardDescription>{t("confirmHint")}</CardDescription>}
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle>{t("calls")}</CardTitle>
            {l.calls.length === 0 && <p className="text-text-secondary">{t("noCalls")}</p>}
            <ul className="flex flex-col gap-2">
              {l.calls.map((c) => (
                <li key={c.id} className="rounded-xl border border-border p-3">
                  <p className="flex flex-wrap gap-x-3">
                    <span className="font-medium">{formatDateTime(new Date(c.started_at))}</span>
                    <span>{t(`direction.${c.direction}`)}</span>
                    {c.outcome && <span>{t(`outcome.${c.outcome}`)}</span>}
                    <span className="tabular-nums text-text-secondary">{minutes(c.duration_s)}</span>
                    {c.staff_name && <span className="text-text-secondary">{c.staff_name}</span>}
                  </p>
                  {c.notes && <p className="mt-1 whitespace-pre-wrap text-text-secondary">{c.notes}</p>}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle>{t("recordings")}</CardTitle>
            <RecordingsList filters={{ lead_id: l.id }} showLead={false} />
          </Card>

          <Activities leadId={l.id} />
        </div>

        <aside className="flex flex-col gap-5">
          <FollowupCard lead={l} onSaved={refresh} />
          <PatientCard lead={l} isAdmin={isAdmin} onLinked={refresh} />
          <WhatsAppPanel leadId={l.id} canDrip={me?.role === "sales_manager" || isAdmin} />
          {l.duplicates.length > 0 && (
            <Card className="flex flex-col gap-2">
              <CardTitle>{t("sameNumber")}</CardTitle>
              <ul className="flex flex-col gap-2">
                {l.duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${d.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                      #{d.sl_no} {d.name}
                    </Link>
                    <StageBadge stage={d.stage} />
                    <span className="text-[0.9rem] text-text-secondary">{formatDate(day(d.lead_date))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "stage" && <StageDialog lead={l} onDone={done} />}
        {dialog === "edit" && <EditLeadDialog lead={l} onDone={done} />}
        {dialog === "amount" && <AmountDialog lead={l} canOverride={isAdmin} onDone={done} />}
        {dialog === "call" && <LogCallDialog lead={l} onDone={done} />}
        {dialog === "book" && <BookDialog lead={{ id: l.id, name: l.name }} onDone={done} />}
        {dialog === "delete" && <DeleteLeadDialog lead={l} onDone={() => (setDialog(null), router.push("/leads"))} />}
      </Dialog>
    </Page>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <p className="text-[0.9rem] text-text-secondary">{label}</p>
      <p className="whitespace-pre-wrap">{value || "—"}</p>
    </div>
  );
}

const followupSchema = z.object({ at: optionalDateTime() });

/** "Due date": the next call. Setting it gives the owner a task; clearing it removes the task. */
function FollowupCard({ lead, onSaved }: { lead: LeadDetail; onSaved: () => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [at, setAt] = useState(lead.next_followup_at ? istDateTimeLocal(new Date(lead.next_followup_at)) : "");
  const checks = useZodForm(followupSchema);
  const save = useMutation({
    mutationFn: (local: string | null) =>
      rpc("update_lead", { p_id: lead.id, p_patch: { next_followup_at: local ? fromIstDateTimeLocal(local) : null }, p_version: lead.version }),
    onSuccess: () => {
      saved(t("dueSaved"));
      onSaved();
    },
    onError: failed,
  });
  const [now] = useState(() => Date.now());
  const overdue = lead.next_followup_at && new Date(lead.next_followup_at).getTime() < now;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("nextCall")}</CardTitle>
      <CardDescription>
        {lead.next_followup_at
          ? `${formatDateTime(new Date(lead.next_followup_at))}${overdue ? ` · ${t("overdue")}` : ""}`
          : t("noNextCall")}
      </CardDescription>
      <Field label={t("f.due")} error={checks.error("at")}>
        {(a) => <Input {...a} type="datetime-local" value={at} onChange={(e) => (setAt(e.target.value), checks.clear("at"))} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ at });
            if (!d) return;
            if (!d.at) return checks.setError("at", "dateTime");
            save.mutate(d.at);
          }}
        >
          <CalendarPlus aria-hidden />
          {t("setDue")}
        </Button>
        {lead.next_followup_at && (
          <Button variant="ghost" disabled={save.isPending} onClick={() => (setAt(""), save.mutate(null))}>
            <CalendarX2 aria-hidden />
            {t("clearDue")}
          </Button>
        )}
      </div>
    </Card>
  );
}

const linkSchema = z.object({ patient: requiredItem() });

/** The patient behind the lead (once reception registered them): visits, treatment, agreed price. */
function PatientCard({ lead, isAdmin, onLinked }: { lead: LeadDetail; isAdmin: boolean; onLinked: () => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const checks = useZodForm(linkSchema);
  const link = useMutation({
    mutationFn: (patientId: string) => rpc("link_lead_to_patient", { p_lead_id: lead.id, p_patient_id: patientId }),
    onSuccess: () => {
      saved(t("linked"));
      onLinked();
    },
    onError: failed,
  });
  const p = lead.patient;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("patient")}</CardTitle>
      {p ? (
        <>
          <p>
            {isAdmin ? (
              <Link href={`/patients/${p.patient_id}`} className="font-semibold text-link underline-offset-4 hover:underline">
                {p.name}
              </Link>
            ) : (
              <span className="font-semibold">{p.name}</span>
            )}{" "}
            <span className="text-text-secondary">· {p.uhid}</span>
          </p>
          {p.last_visit && <p className="text-text-secondary">{t("lastVisit", { date: formatDate(day(p.last_visit)) })}</p>}
          {p.treatment && (
            <p>
              {t("treatmentIs", { name: p.treatment.name, status: p.treatment.status })}
              {p.treatment.agreed_price_paise !== null && ` · ${t("agreedAt", { amount: formatINR(p.treatment.agreed_price_paise) })}`}
            </p>
          )}
          {p.upcoming.length > 0 && (
            <ul className="flex flex-col gap-1 text-[0.95rem]">
              {p.upcoming.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{formatDateTime(new Date(a.slot_start))}</span>
                  <ApptStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <CardDescription>{t("notRegistered")}</CardDescription>
          {isAdmin && (
            <>
              <Field label={t("linkPatient")} error={checks.error("patient")}>
                {(a) => <PatientPicker {...a} value={patient} onChange={(v) => (setPatient(v), checks.clear("patient"))} />}
              </Field>
              <Button
                variant="secondary"
                className="self-start"
                disabled={link.isPending}
                onClick={() => {
                  const d = checks.validate({ patient });
                  if (d) link.mutate(d.patient);
                }}
              >
                <Link2 aria-hidden />
                {t("link")}
              </Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}

const noteSchema = z.object({ body: requiredText(4000) });

/** Everything that happened, newest first, with a box to add a note. */
function Activities({ leadId }: { leadId: string }) {
  const t = useTranslations("leads");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [body, setBody] = useState("");
  const [clientId, setClientId] = useState(newId);
  const checks = useZodForm(noteSchema);
  const list = useInfiniteQuery({
    queryKey: ["lead_activities", leadId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: Activity[]; next_cursor: string | null }>("lead_activities", { p_id: leadId, p_cursor: pageParam, p_limit: 20 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const add = useMutation({
    mutationFn: (text: string) => rpc("add_lead_note", { p_id: leadId, p_body: text, p_client_id: clientId }),
    onSuccess: () => {
      saved(t("noteAdded"));
      setBody("");
      setClientId(newId());
      void queryClient.invalidateQueries({ queryKey: ["lead_activities", leadId] });
    },
    onError: failed,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("history")}</CardTitle>
      <Field label={t("addNote")} error={checks.error("body")}>
        {(a) => <Textarea {...a} rows={2} maxLength={4000} value={body} onChange={(e) => (setBody(e.target.value), checks.clear("body"))} />}
      </Field>
      <Button
        variant="secondary"
        className="self-start"
        disabled={add.isPending}
        onClick={() => {
          const d = checks.validate({ body });
          if (d) add.mutate(d.body);
        }}
      >
        <MessageSquarePlus aria-hidden />
        {t("saveNote")}
      </Button>
      <ol className="flex flex-col gap-3">
        {items.map((a) => (
          <li key={a.id} className="border-l-2 border-border pl-3">
            <p className="text-[0.9rem] text-text-secondary">
              {formatDateTime(new Date(a.at))}
              {a.staff_name ? ` · ${a.staff_name}` : ""}
            </p>
            <p className="font-medium">{activityText(t, a)}</p>
            {a.body && <p className="whitespace-pre-wrap">{a.body}</p>}
          </li>
        ))}
      </ol>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
        {t("showOlder")}
      </LoadMore>
    </Card>
  );
}

function activityText(t: ReturnType<typeof useTranslations<"leads">>, a: Activity): string {
  const d = a.data ?? {};
  switch (a.kind) {
    case "stage":
      return t("act.stage", { to: t(`stage.${String(d.to)}` as "stage.new"), auto: d.auto ? "yes" : "no" });
    case "call":
      return t("act.call", { outcome: d.outcome ? t(`outcome.${String(d.outcome)}` as "outcome.connected") : "—" });
    case "amount":
      return t("act.amount", { amount: typeof d.to === "number" ? formatINR(d.to) : "—" });
    case "created":
      return t("act.created", { via: t(`via.${String(d.via ?? "web")}` as "via.web") });
    default:
      return t.has(`act.${a.kind}`) ? t(`act.${a.kind}` as "act.note") : a.kind;
  }
}
