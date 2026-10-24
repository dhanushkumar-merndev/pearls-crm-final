"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleX, DoorOpen, FilePlus2, FileText, Pencil, Pill, ReceiptIndianRupee } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, formatINR, fromIstDateTimeLocal, istDateTimeLocal } from "@pearl/shared";
import { AdmissionForm } from "@/components/admissions/admission-form";
import { admissionBadge } from "@/components/admissions/admissions-table";
import type { Admission } from "@/components/admissions/types";
import type { BillType } from "@/components/bills/types";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { dischargeSchema, reasonSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

/** One IP stay: details, discharge, the stay's bills, final bill and discharge summary. */
export function AdmissionScreen({ initial }: { initial: Admission }) {
  const t = useTranslations("ip");
  const b = useTranslations("bill");
  const router = useRouter();
  const { failed } = useFeedback();
  const query = useQuery({
    queryKey: ["admission", initial.id],
    initialData: initial,
    queryFn: () => rpc<Admission>("get_admission", { p_admission_id: initial.id }),
  });
  const a = query.data;
  const [dialog, setDialog] = useState<"edit" | "discharge" | "cancel" | "summary" | null>(null);
  const finalBill = a.bills.find((x) => x.bill_type === "final_bill" && x.status !== "cancelled");
  const newBill = useMutation({
    mutationFn: (type: BillType) =>
      rpc<{ id: string }>("create_bill", { p_type: type, p_patient_id: a.patient_id, p_links: { admission_id: a.id }, p_client_id: newId() }),
    onSuccess: (bill) => router.push(`/bills/${bill.id}`),
    onError: failed,
  });
  const close = () => (setDialog(null), void query.refetch());

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href={`/patients/${a.patient_id}`}>
            <ArrowLeft aria-hidden />
            {t("backTo", { name: a.patient })}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("stayTitle", { ip: a.ip_number })}</h1>
          <StatusBadge kind={admissionBadge(a.status)} label={t(`status.${a.status}`)} />
        </div>
        <p className="mt-1 text-text-secondary">
          {a.patient} · {a.uhid} · {formatDateTime(new Date(a.admitted_at))} – {a.discharged_at ? formatDateTime(new Date(a.discharged_at)) : t("stillAdmitted")} ·{" "}
          {t("nights", { n: a.room_days })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {a.status === "admitted" && (
          <Button onClick={() => setDialog("discharge")}>
            <DoorOpen aria-hidden />
            {t("discharge")}
          </Button>
        )}
        {a.status !== "cancelled" && (
          <>
            {finalBill ? (
              <Button variant={a.status === "discharged" ? "primary" : "secondary"} asChild>
                <Link href={`/bills/${finalBill.id}`}>
                  <ReceiptIndianRupee aria-hidden />
                  {t("openFinalBill")}
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" disabled={newBill.isPending} onClick={() => newBill.mutate("final_bill")}>
                <ReceiptIndianRupee aria-hidden />
                {t("makeFinalBill")}
              </Button>
            )}
            {a.summary ? (
              <Button variant="secondary" asChild>
                <Link href={`/discharge/${a.summary.id}`}>
                  <FileText aria-hidden />
                  {t("openSummary")}
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setDialog("summary")}>
                <FileText aria-hidden />
                {t("writeSummary")}
              </Button>
            )}
            <Button variant="ghost" disabled={newBill.isPending} onClick={() => newBill.mutate("procedure_receipt")}>
              <FilePlus2 aria-hidden />
              {t("newReceipt")}
            </Button>
            <Button variant="ghost" disabled={newBill.isPending} onClick={() => newBill.mutate("pharmacy_invoice")}>
              <Pill aria-hidden />
              {t("newPharmacyBill")}
            </Button>
            <Button variant="ghost" onClick={() => setDialog("edit")}>
              <Pencil aria-hidden />
              {t("edit")}
            </Button>
          </>
        )}
        {a.status === "admitted" && (
          <Button variant="ghost" onClick={() => setDialog("cancel")}>
            <CircleX aria-hidden />
            {t("cancelAdmission")}
          </Button>
        )}
      </div>

      <Card className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("treatment")} value={a.treatment} />
        <Detail label={t("roomType")} value={[a.room_type, a.room_label].filter(Boolean).join(" · ")} />
        <Detail label={t("dailyRate")} value={a.room_rate_paise !== null ? formatINR(a.room_rate_paise) : null} />
        <Detail label={t("procedures")} value={a.procedures.join(", ")} />
        <Detail label={t("diagnosis")} value={a.diagnosis} />
        <Detail label={t("anaesthesia")} value={a.anaesthesia} />
        <Detail label={t("surgeryAt")} value={a.surgery_at ? formatDateTime(new Date(a.surgery_at)) : null} />
        <Detail label={t("surgeons")} value={a.surgeons.map((s) => `${s.name} (${t(`roles.${s.role}`)})`).join(", ")} />
        <Detail label={t("attender")} value={[a.attender_name, a.attender_relation, a.attender_phone].filter(Boolean).join(" · ")} />
        {a.cancel_reason && <Detail label={t("cancelledBecause")} value={a.cancel_reason} />}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("stayBills")}</CardTitle>
        <Table>
          <THead>
            <tr>
              <TH>{t("col.bill")}</TH>
              <TH>{t("col.date")}</TH>
              <TH>{t("col.status")}</TH>
              <TH className="text-right">{t("col.total")}</TH>
            </tr>
          </THead>
          <tbody>
            {a.bills.length === 0 && <EmptyRow colSpan={4}>{t("noBills")}</EmptyRow>}
            {a.bills.map((x) => (
              <TR key={x.id}>
                <TD>
                  <Link href={`/bills/${x.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                    {x.bill_no ?? b("status.draft")}
                  </Link>
                  <span className="block text-[0.85rem] text-text-secondary">
                    {b(`type.${x.bill_type}`)}
                    {x.consolidated_into_id && ` · ${t("inFinalBill")}`}
                  </span>
                </TD>
                <TD className="whitespace-nowrap">{x.bill_at ? formatDateTime(new Date(x.bill_at)) : "—"}</TD>
                <TD>
                  <StatusBadge kind={x.status === "finalized" ? "good" : x.status === "draft" ? "warning" : "critical"} label={b(`status.${x.status}`)} />
                </TD>
                <TD className="text-right tabular-nums">{formatINR(x.total_paise)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "edit" && <AdmissionForm admission={a} onDone={close} />}
        {dialog === "discharge" && <DischargeDialog admission={a} onDone={close} />}
        {dialog === "cancel" && <CancelDialog admission={a} onDone={close} />}
        {dialog === "summary" && <StartSummaryDialog admission={a} />}
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[0.85rem] text-text-secondary">{label}</p>
      <p>{value || "—"}</p>
    </div>
  );
}

function DischargeDialog({ admission, onDone }: { admission: Admission; onDone: () => void }) {
  const t = useTranslations("ip");
  const { saved, failed } = useFeedback();
  const [at, setAt] = useState(istDateTimeLocal(new Date()));
  const [schema] = useState(() => dischargeSchema(admission.admitted_at));
  const checks = useZodForm(schema);
  const discharge = useMutation({
    mutationFn: (local: string) => rpc("discharge_patient", { p_admission_id: admission.id, p_discharged_at: fromIstDateTimeLocal(local) }),
    onSuccess: () => (saved(t("discharged")), onDone()),
    onError: (e) => {
      if (asAppError(e).code === "dates_invalid") return checks.setError("at", "errors.dates_invalid");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={t("dischargeTitle", { name: admission.patient })}
      description={t("dischargeHint")}
      footer={
        <Button
          disabled={discharge.isPending}
          onClick={() => {
            const d = checks.validate({ at });
            if (d) discharge.mutate(d.at);
          }}
        >
          <DoorOpen aria-hidden />
          {t("discharge")}
        </Button>
      }
    >
      <Field label={t("dischargedAt")} error={checks.error("at")}>
        {(a) => <Input {...a} type="datetime-local" value={at} onChange={(e) => (setAt(e.target.value), checks.clear("at"))} />}
      </Field>
    </DialogContent>
  );
}

function CancelDialog({ admission, onDone }: { admission: Admission; onDone: () => void }) {
  const t = useTranslations("ip");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const checks = useZodForm(reasonSchema);
  const cancel = useMutation({
    mutationFn: (r: string) => rpc("cancel_admission", { p_admission_id: admission.id, p_reason: r }),
    onSuccess: () => (saved(t("cancelled")), onDone()),
    onError: failed,
  });
  return (
    <DialogContent
      title={t("cancelTitle", { ip: admission.ip_number })}
      description={t("cancelHint")}
      footer={
        <Button
          disabled={cancel.isPending}
          onClick={() => {
            const d = checks.validate({ reason });
            if (d) cancel.mutate(d.reason);
          }}
        >
          <CircleX aria-hidden />
          {t("cancelAdmission")}
        </Button>
      }
    >
      <Field label={t("reason")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
      </Field>
    </DialogContent>
  );
}

interface Autofill {
  template: { id: string; name: string; sections: unknown[]; medications: unknown[]; follow_up_days: number | null } | null;
  pharmacy_medicines: Record<string, unknown>[];
}

/** Start a discharge summary from a template (the treatment's, or chosen), plus the stay's medicines. */
function StartSummaryDialog({ admission }: { admission: Admission }) {
  const t = useTranslations("ip");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { failed } = useFeedback();
  const templates = useQuery({
    queryKey: ["discharge_templates"],
    queryFn: () => rpc<{ id: string; name: string; active: boolean }[]>("discharge_templates_list"),
  });
  const auto = useQuery({
    queryKey: ["discharge_autofill", admission.id],
    queryFn: () => rpc<Autofill>("discharge_autofill", { p_admission_id: admission.id }),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const templateId = chosen ?? auto.data?.template?.id ?? "";
  const [summaryId] = useState(newId);
  const start = useMutation({
    mutationFn: async () => {
      const source = templateId
        ? await rpc<Autofill>("discharge_autofill", { p_admission_id: admission.id, p_template_id: templateId })
        : auto.data!;
      const tpl = source.template;
      const content = {
        sections: tpl?.sections ?? [{ key: newId(), title: t("defaultSection"), body: "" }],
        medications: [...(tpl?.medications ?? []), ...source.pharmacy_medicines],
        follow_up_days: tpl?.follow_up_days ?? null,
        follow_up_note: "",
        doctor_id: admission.surgeons.find((s) => s.role === "primary")?.doctor_id ?? admission.surgeons[0]?.doctor_id ?? null,
      };
      return rpc<{ id: string }>("save_discharge_summary", {
        p_id: summaryId,
        p_admission_id: admission.id,
        p_content: content,
        p_version: null,
        p_template_id: tpl?.id ?? null,
      });
    },
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ["admission", admission.id] });
      router.push(`/discharge/${s.id}`);
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("writeSummary")}
      description={t("summaryStartHint")}
      footer={
        <Button disabled={auto.isPending || start.isPending} onClick={() => start.mutate()}>
          <FileText aria-hidden />
          {t("startSummary")}
        </Button>
      }
    >
      <Field label={t("template")}>
        {(a) => (
          <Select {...a} value={templateId} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t("blankSummary")}</option>
            {templates.data?.filter((x) => x.active).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {(auto.data?.pharmacy_medicines.length ?? 0) > 0 && (
        <p className="mt-3 text-text-secondary">{t("medsFromBills", { n: auto.data!.pharmacy_medicines.length })}</p>
      )}
    </DialogContent>
  );
}
