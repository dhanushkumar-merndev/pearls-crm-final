"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookmarkPlus, CheckCheck, Pencil, Pill, Printer, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime, leftoverPlaceholders, renderPlaceholders, type PlaceholderVars } from "@pearl/shared";
import type { Admission } from "@/components/admissions/types";
import { MedicationsEditor, SectionsEditor, type Medication, type Section } from "@/components/discharge/sections-editor";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { saveTemplateSchema, summaryAmendSchema, summaryContentSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

export interface Content {
  sections: Section[];
  medications: Medication[];
  follow_up_days: number | null;
  follow_up_note: string;
  doctor_id: string | null;
}
interface Rendered {
  sections: Section[];
  medications: Medication[];
  follow_up_note: string;
  follow_up_days: number | null;
  vars: PlaceholderVars;
}
export interface Summary {
  id: string;
  admission_id: string;
  patient_id: string;
  status: "draft" | "finalized" | "cancelled";
  version: number;
  content: Content;
  rendered: Rendered | null;
  preview: Rendered;
  template: string | null;
  finalized_at: string | null;
  admission: Admission;
}

const withDefaults = (c: Partial<Content>): Content => ({
  sections: (c.sections ?? []).map((s) => ({ key: s.key || newId(), title: s.title ?? "", body: s.body ?? "" })),
  medications: c.medications ?? [],
  follow_up_days: c.follow_up_days ?? null,
  follow_up_note: c.follow_up_note ?? "",
  doctor_id: c.doctor_id ?? null,
});

/** Text with any {{…}} still unfilled marked, so it can be found and fixed before finalize. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]*\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{[^}]*\}\}$/.test(p) ? (
          <mark key={i} className="rounded bg-secondary px-1 font-semibold text-status-warning">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** Discharge summary: draft (autosaved) → preview → finalize → print; admin amends with a reason. */
export function SummaryScreen({ initial }: { initial: Summary }) {
  const t = useTranslations("discharge");
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const summary = useQuery({
    queryKey: ["discharge_summary", initial.id],
    initialData: initial,
    queryFn: () => rpc<Summary>("get_discharge_summary", { p_id: initial.id }),
  });
  const s = summary.data;
  const [content, setContent] = useState<Content>(() => withDefaults(initial.content));
  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState("");
  const [dialog, setDialog] = useState<"finalize" | "template" | null>(null);
  const version = useRef(initial.version);
  const [dirty, setDirty] = useState(false);
  const editable = s.status === "draft" || amending;
  const vars = useMemo(() => s.preview?.vars ?? s.rendered?.vars ?? {}, [s.preview, s.rendered]);
  const [doctor, setDoctor] = useState<LibraryItem | null>(() => {
    const d = s.admission.surgeons.find((x) => x.doctor_id === initial.content.doctor_id);
    return d ? { id: d.doctor_id, label: d.name, subtitle: null, on_the_fly: false, defaults: {} } : null;
  });

  // Live preview with the server's values (the same filling rule as the database).
  const preview = useMemo(() => {
    const r = (x: string) => renderPlaceholders(x, vars);
    const sections = content.sections.map((x) => ({ ...x, title: r(x.title), body: r(x.body) }));
    const meds = content.medications.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "string" ? r(v) : v])) as unknown as Medication);
    const note = r(content.follow_up_note);
    const all = [...sections.flatMap((x) => [x.title, x.body]), ...meds.flatMap((m) => Object.values(m).filter((v): v is string => typeof v === "string")), note].join("\n");
    return { sections, meds, note, left: leftoverPlaceholders(all) };
  }, [content, vars]);

  const save = useMutation({
    mutationFn: (c: Content) => rpc<Summary>("save_discharge_summary", { p_id: s.id, p_admission_id: s.admission_id, p_content: c, p_version: version.current }),
    onSuccess: (next) => {
      version.current = next.version;
      queryClient.setQueryData(["discharge_summary", s.id], next);
    },
    onError: failed,
  });
  // Autosave a draft 1.5 s after the last change.
  useEffect(() => {
    if (s.status !== "draft" || !dirty) return;
    const timer = setTimeout(() => save.mutate(content), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save on content changes only
  }, [content]);
  const checks = useZodForm(amending ? summaryAmendSchema : summaryContentSchema);
  const change = (patch: Partial<Content>) => {
    setDirty(true);
    setContent((c) => ({ ...c, ...patch }));
    for (const k of Object.keys(patch)) checks.clear(k);
  };
  const [daysText, setDaysText] = useState(content.follow_up_days === null ? "" : String(content.follow_up_days));

  const finalize = useMutation({
    mutationFn: async () => {
      const latest = await save.mutateAsync(content);
      return rpc<Summary>("finalize_discharge_summary", { p_id: s.id, p_version: latest.version });
    },
    onSuccess: (next) => {
      saved(t("finalized"));
      queryClient.setQueryData(["discharge_summary", s.id], next);
      void queryClient.invalidateQueries({ queryKey: ["admission", s.admission_id] });
      setDialog(null);
      router.refresh();
    },
    onError: failed,
  });
  const amend = useMutation({
    mutationFn: (r: string) => rpc<Summary>("amend_discharge_summary", { p_id: s.id, p_content: content, p_reason: r }),
    onSuccess: (next) => {
      saved(t("amended"));
      queryClient.setQueryData(["discharge_summary", s.id], next);
      setAmending(false);
      setReason("");
    },
    onError: failed,
  });
  const pharmacyBill = useMutation({
    mutationFn: () => rpc<{ id: string }>("pharmacy_bill_from_meds", { p_summary_id: s.id, p_client_id: newId() }),
    onSuccess: (b) => router.push(`/bills/${b.id}`),
    onError: failed,
  });

  const a = s.admission;
  const frozen = s.rendered;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href={`/admissions/${a.id}`}>
            <ArrowLeft aria-hidden />
            {t("backToStay", { ip: a.ip_number })}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
          <StatusBadge kind={s.status === "finalized" ? "good" : "warning"} label={t(`status.${s.status}`)} />
          {s.status === "draft" && <span className="text-text-secondary">{save.isPending ? t("saving") : dirty ? t("savedAuto") : ""}</span>}
        </div>
        <p className="mt-1 text-text-secondary">
          {a.patient} · {a.uhid} · {a.ip_number} · {formatDateTime(new Date(a.admitted_at))} – {a.discharged_at ? formatDateTime(new Date(a.discharged_at)) : t("stillAdmitted")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {s.status === "draft" && (
          <Button
            disabled={finalize.isPending}
            onClick={() => {
              // Headings, medicine names, follow-up days and the signing doctor are checked first.
              if (checks.validate({ ...content, follow_up_days: daysText })) setDialog("finalize");
            }}
          >
            <CheckCheck aria-hidden />
            {t("finalize")}
          </Button>
        )}
        <Button variant="secondary" asChild>
          {/* A plain link: a prefetch would count as a print. */}
          <a href={`/print/discharge/${s.id}`} target="_blank" rel="noopener">
            <Printer aria-hidden />
            {s.status === "draft" ? t("printDraft") : t("print")}
          </a>
        </Button>
        {s.status === "draft" && (
          <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate(content, { onSuccess: () => saved(t("savedNow")) })}>
            <Save aria-hidden />
            {t("save")}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setDialog("template")}>
          <BookmarkPlus aria-hidden />
          {t("saveAsTemplate")}
        </Button>
        {content.medications.some((m) => m.pharmacy_item_id) && (
          <Button variant="ghost" disabled={pharmacyBill.isPending} onClick={() => pharmacyBill.mutate()}>
            <Pill aria-hidden />
            {t("pharmacyBill")}
          </Button>
        )}
        {me?.role === "admin" && s.status === "finalized" && !amending && (
          <Button variant="ghost" onClick={() => (setContent(withDefaults(s.content)), setAmending(true))}>
            <Pencil aria-hidden />
            {t("amend")}
          </Button>
        )}
      </div>

      {editable ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="flex flex-col gap-5">
            <SectionsEditor sections={content.sections} onChange={(sections) => change({ sections })} errorOf={checks.error} onEdit={checks.clear} />
            {checks.error("sections") && (
              <p role="alert" className="text-bad-text">
                {checks.error("sections")}
              </p>
            )}
            <Card className="flex flex-col gap-3">
              <CardTitle>{t("medications")}</CardTitle>
              <MedicationsEditor meds={content.medications} onChange={(medications) => change({ medications })} errorOf={checks.error} onEdit={checks.clear} />
            </Card>
            <Card className="grid gap-4 sm:grid-cols-2">
              <Field label={t("followUpDays")} hint={t("followUpHint")} error={checks.error("follow_up_days")}>
                {(f) => (
                  <Input
                    {...f}
                    inputMode="numeric"
                    value={daysText}
                    onChange={(e) => {
                      setDaysText(e.target.value);
                      change({ follow_up_days: /^\d{1,4}$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : null });
                    }}
                  />
                )}
              </Field>
              <Field label={t("signedBy")} error={checks.error("doctor_id")}>
                {(f) => (
                  <LibraryCombobox
                    {...f}
                    kind="doctor"
                    value={doctor}
                    onChange={(d) => {
                      setDoctor(d);
                      change({ doctor_id: d?.id ?? null });
                    }}
                  />
                )}
              </Field>
              <Field label={t("followUpNote")} error={checks.error("follow_up_note")} className="sm:col-span-2">
                {(f) => <Textarea {...f} rows={2} maxLength={500} value={content.follow_up_note} onChange={(e) => change({ follow_up_note: e.target.value })} />}
              </Field>
            </Card>
            {amending && (
              <Card className="flex flex-wrap items-end gap-3">
                <Field label={t("amendReason")} error={checks.error("reason")} className="min-w-72 flex-1">
                  {(f) => <Input {...f} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
                </Field>
                <Button variant="ghost" onClick={() => setAmending(false)}>
                  {t("cancelAmend")}
                </Button>
                <Button
                  disabled={preview.left.length > 0 || amend.isPending}
                  onClick={() => {
                    const d = checks.validate({ ...content, follow_up_days: daysText, reason });
                    if (d && "reason" in d) amend.mutate((d as { reason: string }).reason);
                  }}
                >
                  <Save aria-hidden />
                  {t("saveAmendment")}
                </Button>
              </Card>
            )}
          </div>
          <aside className="flex flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
            <Card className="flex flex-col gap-3">
              <CardTitle>{t("preview")}</CardTitle>
              {preview.left.length > 0 ? (
                <p role="status" className="text-status-warning">
                  {t("stillToFill", { list: preview.left.join(", ") })}
                </p>
              ) : (
                <p role="status" className="text-good-text">
                  {t("allFilled")}
                </p>
              )}
              {preview.sections.map((x) => (
                <section key={x.key}>
                  <h3 className="font-semibold">
                    <Marked text={x.title} />
                  </h3>
                  <p className="whitespace-pre-wrap">
                    <Marked text={x.body} />
                  </p>
                </section>
              ))}
            </Card>
          </aside>
        </div>
      ) : (
        frozen && (
          <Card className="flex flex-col gap-4">
            {s.finalized_at && <p className="text-text-secondary">{t("finalizedAt", { at: formatDateTime(new Date(s.finalized_at)) })}</p>}
            {frozen.sections.map((x) => (
              <section key={x.key}>
                <h3 className="font-semibold">{x.title}</h3>
                <p className="whitespace-pre-wrap">{x.body}</p>
              </section>
            ))}
            {frozen.medications.length > 0 && (
              <section>
                <h3 className="font-semibold">{t("medications")}</h3>
                <ul className="list-disc pl-6">
                  {frozen.medications.map((m, i) => (
                    <li key={i}>{[m.name, m.dose, m.frequency, m.duration, m.instructions].filter(Boolean).join(" — ")}</li>
                  ))}
                </ul>
              </section>
            )}
          </Card>
        )
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "finalize" && (
          <DialogContent
            title={t("finalizeTitle")}
            description={preview.left.length > 0 ? t("stillToFill", { list: preview.left.join(", ") }) : t("finalizeHint")}
            footer={
              <Button disabled={preview.left.length > 0 || finalize.isPending} onClick={() => finalize.mutate()}>
                <CheckCheck aria-hidden />
                {t("finalize")}
              </Button>
            }
          >
            <ul className="list-disc pl-6 text-text-secondary">
              <li>{t("checkDischarged")}</li>
              <li>{t("checkSurgeon")}</li>
              <li>{t("checkDates")}</li>
            </ul>
          </DialogContent>
        )}
        {dialog === "template" && <TemplateDialog summaryId={s.id} beforeSave={() => save.mutateAsync(content)} draft={s.status === "draft"} onDone={() => setDialog(null)} />}
      </Dialog>
    </div>
  );
}

function TemplateDialog({ summaryId, beforeSave, draft, onDone }: { summaryId: string; beforeSave: () => Promise<unknown>; draft: boolean; onDone: () => void }) {
  const t = useTranslations("discharge");
  const { saved, failed } = useFeedback();
  const templates = useQuery({
    queryKey: ["discharge_templates"],
    queryFn: () => rpc<{ id: string; name: string }[]>("discharge_templates_list"),
  });
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const checks = useZodForm(saveTemplateSchema);
  const queryClient = useQueryClient();
  const go = useMutation({
    mutationFn: async (d: { target: string | null; name: string | null }) => {
      if (draft) await beforeSave();
      return rpc("save_discharge_template", { p_summary_id: summaryId, p_name: d.name ?? "", p_template_id: d.target });
    },
    onSuccess: () => {
      saved(t("templateSaved"));
      void queryClient.invalidateQueries({ queryKey: ["discharge_templates"] });
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "duplicate") return checks.setError("name", "errors.duplicate");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={t("saveAsTemplate")}
      description={t("templateHint")}
      footer={
        <Button
          disabled={go.isPending}
          onClick={() => {
            const d = checks.validate({ target, name });
            if (d) go.mutate(d);
          }}
        >
          <BookmarkPlus aria-hidden />
          {target ? t("updateTemplate") : t("createTemplate")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("templateTarget")}>
          {(a) => (
            <Select {...a} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("newTemplate")}</option>
              {templates.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {t("replace", { name: x.name })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("templateName")} error={checks.error("name")}>
          {(a) => <Input {...a} maxLength={200} value={name} onChange={(e) => (setName(e.target.value), checks.clear("name"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
