"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarPlus, GitMerge, Link2, Pencil, Phone, Printer, Save, Unlink, Users } from "lucide-react";
import { AppointmentActions, type ApptCard } from "@/components/appointments/appointment-actions";
import { BookDialog } from "@/components/appointments/book-dialog";
import { ApptStatusBadge } from "@/components/appointments/status";
import { FollowupDialog } from "@/components/followups/followup-dialog";
import { TreatmentsTab } from "@/components/treatments/treatments-tab";
import { PatientAdmissionsTab } from "@/components/admissions/patient-admissions-tab";
import { PatientBillsTab } from "@/components/bills/patient-bills-tab";
import { DocumentsTab } from "@/components/scan/documents-tab";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { formatDate, formatDateTime, formatTime, PATIENT_SERVER_FIELDS, patientDraftSchema } from "@pearl/shared";
import { draftFrom, PatientForm, type PatientDraft } from "@/components/patients/patient-form";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { useFeedback } from "@/lib/use-feedback";
import { linkRelativeSchema, mergePatientSchema } from "@/lib/schemas/clinical";
import { useZodForm } from "@/lib/use-zod-form";

export interface PatientHeader extends Record<string, unknown> {
  id: string;
  uhid: string;
  full_name: string;
  title: string | null;
  gender: string;
  age: number | null;
  dob: string | null;
  dob_estimated: boolean;
  phone_e164: string | null;
  allergies: string[];
  tags: string[];
  version: number;
  merged_into_id: string | null;
  heard_from: string | null;
  attender_relation: string | null;
  family: { id: string; uhid: string; full_name: string; age: number | null; gender: string }[];
  documents_count: number;
}

/** One patient: header strip + tabs. Later phases add Appointments, Treatments, Bills, … */
export function PatientFile({ initial }: { initial: PatientHeader }) {
  const t = useTranslations("patientFile");
  const f = useTranslations("patientForm");
  const me = useMe();
  const header = useQuery({
    queryKey: ["patient_header", initial.id],
    initialData: initial,
    queryFn: () => rpc<PatientHeader>("patient_header", { p_patient_id: initial.id }),
  });
  const p = header.data;
  const [dialog, setDialog] = useState<"edit" | "merge" | "book" | "followup" | null>(null);
  const hit = { id: p.id, title: p.full_name, uhid: p.uhid, subtitle: p.uhid };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.9rem] font-semibold tracking-tight">
            {p.title ? `${p.title} ` : ""}
            {p.full_name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
            <span className="font-medium text-foreground tabular-nums">{p.uhid}</span>
            {p.age !== null && <span>{p.dob_estimated ? t("ageAbout", { n: p.age }) : t("age", { n: p.age })}</span>}
            <span>{f(`genders.${p.gender}`)}</span>
            {p.phone_e164 && (
              <a href={`tel:${p.phone_e164}`} className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline">
                <Phone aria-hidden className="size-4" />
                {p.phone_e164}
              </a>
            )}
          </p>
          {p.allergies.length > 0 && (
            <StatusBadge kind="critical" label={t("allergies", { list: p.allergies.join(", ") })} className="mt-2" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("book")}>
            <CalendarPlus aria-hidden />
            {t("book")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("followup")}>
            <CalendarCheck aria-hidden />
            {t("addFollowup")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("edit")}>
            <Pencil aria-hidden />
            {t("edit")}
          </Button>
          <Button asChild variant="secondary">
            <a href={`/print/registration/${p.id}`} target="_blank" rel="noopener">
              <Printer aria-hidden />
              {t("printForm")}
            </a>
          </Button>
          {me?.role === "admin" && (
            <Button variant="ghost" onClick={() => setDialog("merge")}>
              <GitMerge aria-hidden />
              {t("merge")}
            </Button>
          )}
        </div>
      </header>

      <Tabs.Root defaultValue="overview" className="flex flex-col gap-4">
        <Tabs.List aria-label={t("sections")} className="flex flex-wrap gap-1 border-b border-border">
          {(["overview", "appointments", "treatments", "ip", "bills", "documents", "family", "timeline"] as const).map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="min-h-11 rounded-t-xl px-4 font-medium text-text-secondary hover:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-foreground data-[state=active]:text-foreground"
            >
              {t(`tab.${tab}`)}
              {tab === "documents" && p.documents_count > 0 && <span className="ml-1.5 tabular-nums">({p.documents_count})</span>}
              {tab === "family" && p.family.length > 0 && <span className="ml-1.5 tabular-nums">({p.family.length})</span>}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview">
          <Overview p={p} />
        </Tabs.Content>
        <Tabs.Content value="appointments">
          <Appointments patientId={p.id} />
        </Tabs.Content>
        <Tabs.Content value="treatments">
          <TreatmentsTab patient={hit} />
        </Tabs.Content>
        <Tabs.Content value="ip">
          <PatientAdmissionsTab patient={hit} />
        </Tabs.Content>
        <Tabs.Content value="bills">
          <PatientBillsTab patientId={p.id} />
        </Tabs.Content>
        <Tabs.Content value="documents">
          <DocumentsTab patientId={p.id} />
        </Tabs.Content>
        <Tabs.Content value="family">
          <Family p={p} />
        </Tabs.Content>
        <Tabs.Content value="timeline">
          <Timeline patientId={p.id} />
        </Tabs.Content>
      </Tabs.Root>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "edit" && <EditDialog p={p} onDone={() => (setDialog(null), void header.refetch())} />}
        {dialog === "merge" && <MergeDialog p={p} />}
        {dialog === "book" && <BookDialog patient={hit} onDone={() => setDialog(null)} />}
        {dialog === "followup" && <FollowupDialog patient={hit} onDone={() => setDialog(null)} />}
      </Dialog>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.9rem] text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words">{children || "—"}</dd>
    </div>
  );
}

function Overview({ p }: { p: PatientHeader }) {
  const f = useTranslations("patientForm");
  const t = useTranslations("patientFile");
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]).join(", ") : "");
  const consents = (p.consents ?? {}) as Record<string, { given?: boolean; at?: string }>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle className="mb-3">{f("contact")}</CardTitle>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail label={f("phone")}>{s("phone_e164")}</Detail>
          <Detail label={f("whatsapp")}>{s("whatsapp_e164")}</Detail>
          <Detail label={f("alt_phone")}>{s("alt_phone_e164")}</Detail>
          <Detail label={f("email")}>{s("email")}</Detail>
          <Detail label={f("address")}>{[s("address"), s("area"), s("city"), s("pincode")].filter(Boolean).join(", ")}</Detail>
          <Detail label={f("attender")}>
            {[s("attender_name"), p.attender_relation, s("attender_phone_e164")].filter(Boolean).join(" · ")}
          </Detail>
        </dl>
      </Card>
      <Card>
        <CardTitle className="mb-3">{f("medical")}</CardTitle>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail label={f("dob")}>{p.dob ? (p.dob_estimated ? t("estimated", { date: formatDate(new Date(p.dob)) }) : formatDate(new Date(p.dob))) : ""}</Detail>
          <Detail label={f("blood_group")}>{s("blood_group")}</Detail>
          <Detail label={f("allergies")}>{list("allergies")}</Detail>
          <Detail label={f("conditions")}>{list("conditions")}</Detail>
          <Detail label={f("chief_complaints")}>{s("chief_complaints")}</Detail>
          <Detail label={f("complaint_since")}>{s("complaint_since")}</Detail>
          <Detail label={f("current_medicines")}>{s("current_medicines")}</Detail>
          <Detail label={f("previous_surgeries")}>{s("previous_surgeries")}</Detail>
        </dl>
      </Card>
      <Card>
        <CardTitle className="mb-3">{f("more")}</CardTitle>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail label={f("heard_from")}>{p.heard_from ?? ""}</Detail>
          <Detail label={f("referred_by_text")}>{s("referred_by_text")}</Detail>
          <Detail label={f("occupation")}>{s("occupation")}</Detail>
          <Detail label={f("preferred_language")}>{s("preferred_language")}</Detail>
          <Detail label={f("id_proof_type")}>{[s("id_proof_type"), s("id_proof_number")].filter(Boolean).join(" ")}</Detail>
        </dl>
      </Card>
      <Card>
        <CardTitle className="mb-3">{f("consents")}</CardTitle>
        <ul className="flex flex-col gap-2">
          {(["treatment", "whatsapp", "marketing"] as const).map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              {consents[k]?.given ? <StatusBadge kind="good" label={t("given")} /> : <StatusBadge kind="warning" label={t("notGiven")} />}
              <span>{f(`consent_${k}`)}</span>
              {consents[k]?.at && <span className="text-[0.9rem] text-text-secondary">{formatDateTime(new Date(consents[k]!.at!))}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function EditDialog({ p, onDone }: { p: PatientHeader; onDone: () => void }) {
  const t = useTranslations("patientFile");
  const r = useTranslations("register");
  const { saved, failed } = useFeedback();
  const [draft, setDraft] = useState<PatientDraft>(() => draftFrom(p, { relation: p.attender_relation, heard_from: p.heard_from }));
  const form = useZodForm(patientDraftSchema);
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      // Only send consents that changed, so their "given at" time stays true.
      const before = (p.consents ?? {}) as Record<string, { given?: boolean }>;
      const consents = Object.fromEntries(
        Object.entries(payload.consents as Record<string, { given: boolean }>).filter(([k, v]) => Boolean(before[k]?.given) !== v.given),
      );
      const patch = { ...payload, consents };
      if (Object.keys(consents).length === 0) delete (patch as Record<string, unknown>).consents;
      return rpc("update_patient", { p_id: p.id, p_patch: patch, p_version: p.version, p_reason: reason.trim() || null });
    },
    onSuccess: () => {
      saved();
      onDone();
    },
    onError: (e) => {
      if (!form.fromServer(e, PATIENT_SERVER_FIELDS)) failed(e);
    },
  });
  return (
    <DialogContent
      wide
      title={t("editTitle", { name: p.full_name })}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const payload = form.validate(draft);
            if (!payload) return toast.error(r("fixFields"));
            save.mutate(payload);
          }}
        >
          <Save aria-hidden />
          {save.isPending ? r("saving") : t("saveChanges")}
        </Button>
      }
    >
      <PatientForm
        draft={draft}
        onChange={setDraft}
        errors={form.errors}
        onEdit={form.clear}
        extra={
          <Field label={t("reason")} hint={t("reasonHint")}>
            {(a) => <Input {...a} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        }
      />
    </DialogContent>
  );
}

function Family({ p }: { p: PatientHeader }) {
  const t = useTranslations("patientFile");
  const f = useTranslations("patientForm");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [relative, setRelative] = useState<PatientHit | null>(null);
  const linkChecks = useZodForm(linkRelativeSchema);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["patient_header", p.id] });
  const link = useMutation({
    mutationFn: (relativeId: string) => rpc("link_family", { p_patient_id: p.id, p_relative_id: relativeId }),
    onSuccess: () => {
      saved(t("linked"));
      setRelative(null);
      refresh();
    },
    onError: failed,
  });
  const unlink = useMutation({
    mutationFn: (id: string) => rpc("unlink_family", { p_patient_id: id }),
    onSuccess: () => {
      saved(t("unlinked"));
      refresh();
    },
    onError: failed,
  });
  return (
    <div className="flex flex-col gap-4">
      {p.family.length === 0 ? (
        <p className="text-text-secondary">{t("noFamily")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {p.family.map((m) => (
            <li key={m.id}>
              <Card className="flex items-center gap-3">
                <Users aria-hidden className="size-6 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <Link href={`/patients/${m.id}`} className="font-semibold text-link underline-offset-4 hover:underline">
                    {m.full_name}
                  </Link>
                  <p className="text-text-secondary">
                    {[m.uhid, m.age !== null ? t("age", { n: m.age }) : null, f(`genders.${m.gender}`)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => unlink.mutate(m.id)}>
                  <Unlink aria-hidden />
                  {t("unlink")}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card className="flex flex-wrap items-end gap-3">
        <Field label={t("linkRelative")} error={linkChecks.error("relative")} className="min-w-64 flex-1">
          {(a) => <PatientPicker {...a} excludeId={p.id} value={relative} onChange={(r) => (setRelative(r), linkChecks.clear("relative"))} />}
        </Field>
        <Button
          disabled={link.isPending}
          onClick={() => {
            const d = linkChecks.validate({ relative });
            if (d) link.mutate(d.relative);
          }}
        >
          <Link2 aria-hidden />
          {t("link")}
        </Button>
      </Card>
    </div>
  );
}

function Appointments({ patientId }: { patientId: string }) {
  const t = useTranslations("patientFile");
  const c = useTranslations("common");
  const list = useInfiniteQuery({
    queryKey: ["patient_appointments", patientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: (ApptCard & { appt_date: string })[]; next_cursor: string | null }>("patient_appointments", {
        p_patient_id: patientId,
        p_cursor: pageParam,
      }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((x) => x.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <tr>
            <TH>{t("apptWhen")}</TH>
            <TH>{t("apptDoctor")}</TH>
            <TH>{c("status")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{t("noAppointments")}</EmptyRow>}
          {items.map((a) => (
            <TR key={a.id}>
              <TD className="whitespace-nowrap tabular-nums">
                {formatDate(new Date(a.appt_date))} {a.slot_start ? formatTime(new Date(a.slot_start)) : t("walkIn")}
              </TD>
              <TD>{a.doctor ?? "—"}</TD>
              <TD>
                <ApptStatusBadge status={a.status} />
              </TD>
              <TD className="text-right">
                <AppointmentActions appt={a} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.hasNextPage && (
        <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>
          {c("loadMore")}
        </Button>
      )}
    </div>
  );
}

interface TimelineItem {
  at: string;
  id: string;
  kind: string;
  title: string;
}

function Timeline({ patientId }: { patientId: string }) {
  const t = useTranslations("patientFile");
  const c = useTranslations("common");
  const list = useInfiniteQuery({
    queryKey: ["patient_timeline", patientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: TimelineItem[]; next_cursor: string | null }>("patient_timeline", { p_patient_id: patientId, p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-2">
      {list.isPending && <p>{c("loading")}</p>}
      <ol className="flex flex-col gap-2 border-l-2 border-border pl-5">
        {items.map((e) => (
          <li key={`${e.kind}-${e.id}`} className="relative">
            <span aria-hidden className="absolute top-2 -left-[27px] size-3 rounded-full bg-text-secondary" />
            <p className="font-medium">{e.title}</p>
            <p className="text-[0.9rem] text-text-secondary">
              {t(`event.${e.kind}`)} · {formatDateTime(new Date(e.at))}
            </p>
          </li>
        ))}
      </ol>
      {list.hasNextPage && (
        <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>
          {c("loadMore")}
        </Button>
      )}
    </div>
  );
}

function MergeDialog({ p }: { p: PatientHeader }) {
  const t = useTranslations("patientFile");
  const router = useRouter();
  const { saved, failed } = useFeedback();
  const [into, setInto] = useState<PatientHit | null>(null);
  const [reason, setReason] = useState("");
  const checks = useZodForm(mergePatientSchema);
  const merge = useMutation({
    mutationFn: (d: { into: string; reason: string }) => rpc("merge_patients", { p_from: p.id, p_into: d.into, p_reason: d.reason }),
    onSuccess: (_, d) => {
      saved(t("mergedDone"));
      router.push(`/patients/${d.into}`);
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("mergeTitle", { name: p.full_name, uhid: p.uhid })}
      description={t("mergeHint")}
      footer={
        <Button
          variant="danger"
          disabled={merge.isPending}
          onClick={() => {
            const d = checks.validate({ into, reason });
            if (d) merge.mutate(d);
          }}
        >
          <GitMerge aria-hidden />
          {t("mergeButton")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("mergeInto")} error={checks.error("into")}>
          {(a) => <PatientPicker {...a} excludeId={p.id} value={into} onChange={(v) => (setInto(v), checks.clear("into"))} />}
        </Field>
        <Field label={t("reason")} error={checks.error("reason")}>
          {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
