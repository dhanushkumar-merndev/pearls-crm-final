"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleX, DoorOpen, FilePlus2, FileText, Pencil, Pill, Plus, ReceiptIndianRupee, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatDateTime, formatINR, fromIstDateTimeLocal, istDateString, istDateTimeLocal } from "@pearl/shared";
import { AdmissionForm } from "@/components/admissions/admission-form";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { admissionBadge } from "@/components/admissions/admissions-table";
import type { Admission } from "@/components/admissions/types";
import type { BillType } from "@/components/bills/types";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoreMenu } from "@/components/ui/more-menu";
import { DetailHeader, Page } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { dischargeSchema, reasonSchema, stayChargesSchema } from "@/lib/schemas/clinical";
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
  const [dialog, setDialog] = useState<"edit" | "discharge" | "cancel" | "summary" | "charge" | null>(null);
  const finalBill = a.bills.find((x) => x.bill_type === "final_bill" && x.status !== "cancelled");
  // Charges go on the draft final bill; once it is finalized, new ones need a new procedure bill.
  const chargesOpen = a.status !== "cancelled" && finalBill?.status !== "finalized";
  const newBill = useMutation({
    mutationFn: (type: BillType) =>
      rpc<{ id: string }>("create_bill", { p_type: type, p_patient_id: a.patient_id, p_links: { admission_id: a.id }, p_client_id: newId() }),
    onSuccess: (bill) => router.push(`/bills/${bill.id}`),
    onError: failed,
  });
  const close = () => (setDialog(null), void query.refetch());

  return (
    <Page>
      <DetailHeader
        back={{ href: `/patients/${a.patient_id}`, label: t("backTo", { name: a.patient }) }}
        title={t("stayTitle", { ip: a.ip_number })}
        badges={<StatusBadge kind={admissionBadge(a.status)} label={t(`status.${a.status}`)} />}
        meta={
          <>
            {a.patient} · {a.uhid} · {formatDateTime(new Date(a.admitted_at))} – {a.discharged_at ? formatDateTime(new Date(a.discharged_at)) : t("stillAdmitted")} ·{" "}
            {t("nights", { n: a.room_days })}
          </>
        }
      />

      {/* The next step of the stay is the primary action; bills on the side and changes are under "More". */}
      <div className="flex flex-wrap gap-2">
        {a.status === "admitted" && (
          <Button onClick={() => setDialog("discharge")}>
            <DoorOpen aria-hidden />
            {t("discharge")}
          </Button>
        )}
        {chargesOpen && (
          <Button variant="secondary" onClick={() => setDialog("charge")}>
            <Plus aria-hidden />
            {t("addCharge")}
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
              <Button variant={a.status === "discharged" ? "primary" : "secondary"} disabled={newBill.isPending} onClick={() => newBill.mutate("final_bill")}>
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
          </>
        )}
        <MoreMenu>
          {a.status !== "cancelled" && (
            <DropdownMenuItem disabled={newBill.isPending} onSelect={() => newBill.mutate("procedure_receipt")}>
              <FilePlus2 aria-hidden />
              {t("newReceipt")}
            </DropdownMenuItem>
          )}
          {a.status !== "cancelled" && (
            <DropdownMenuItem disabled={newBill.isPending} onSelect={() => newBill.mutate("pharmacy_invoice")}>
              <Pill aria-hidden />
              {t("newPharmacyBill")}
            </DropdownMenuItem>
          )}
          {a.status !== "cancelled" && (
            <DropdownMenuItem onSelect={() => setDialog("edit")}>
              <Pencil aria-hidden />
              {t("edit")}
            </DropdownMenuItem>
          )}
          {a.status === "admitted" && (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>
              <CircleX aria-hidden />
              {t("cancelAdmission")}
            </DropdownMenuItem>
          )}
        </MoreMenu>
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

      <Card className="flex flex-col gap-3" data-testid="stay-charges">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("charges")}</CardTitle>
          {chargesOpen && (
            <Button variant="ghost" onClick={() => setDialog("charge")}>
              <Plus aria-hidden />
              {t("addCharge")}
            </Button>
          )}
        </div>
        {!chargesOpen && a.status !== "cancelled" && <p className="text-text-secondary">{t("chargesLocked")}</p>}
        <Table>
          <THead>
            <tr>
              <TH>{t("col.date")}</TH>
              <TH>{t("col.charge")}</TH>
              <TH>{t("col.bill")}</TH>
              <TH className="text-right">{t("col.qty")}</TH>
              <TH className="text-right">{t("col.rate")}</TH>
              <TH className="text-right">{t("col.amount")}</TH>
            </tr>
          </THead>
          <tbody>
            {a.charges.length === 0 && <EmptyRow colSpan={6}>{t("noCharges")}</EmptyRow>}
            {a.charges.map((c) => (
              <TR key={c.id}>
                <TD className="whitespace-nowrap">{formatDate(new Date(c.service_date))}</TD>
                <TD>{c.description}</TD>
                <TD>
                  <Link href={`/bills/${c.bill_id}`} className="text-link underline-offset-4 hover:underline">
                    {c.bill_no ?? `${b(`type.${c.bill_type}`)} · ${b("status.draft")}`}
                  </Link>
                </TD>
                <TD className="text-right tabular-nums">{Number(c.qty)}</TD>
                <TD className="text-right tabular-nums">{formatINR(c.rate_paise)}</TD>
                <TD className="text-right tabular-nums">{formatINR(c.total_paise)}</TD>
              </TR>
            ))}
          </tbody>
          {a.charges.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <TD colSpan={5}>{t("chargesTotal")}</TD>
                <TD className="text-right tabular-nums" data-testid="charges-total">
                  {formatINR(a.charges_total_paise)}
                </TD>
              </tr>
            </tfoot>
          )}
        </Table>
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
                  <span className="block text-[0.9rem] text-text-secondary">
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
        {dialog === "charge" && <AddChargeDialog admission={a} onDone={close} />}
      </Dialog>
    </Page>
  );
}

interface ChargeRow {
  key: string;
  /** Each line keeps its own client id, so trying again after a failure never adds a line twice. */
  clientId: string;
  service: LibraryItem | null;
  description: string;
  category: LibraryItem | null;
  qty: string;
  rate_paise: number | null;
  gst: { gst_rate_bp: number; hsn_sac: string | null } | null;
}

const emptyRow = (): ChargeRow => ({ key: newId(), clientId: newId(), service: null, description: "", category: null, qty: "1", rate_paise: null, gst: null });

/** A row filled from a library service: its name, price, category and GST. */
function rowFromService(s: LibraryItem): ChargeRow {
  const d = s.defaults as { price_paise?: number; gst_rate_bp?: number; sac?: string | null; category_id?: string | null };
  return {
    ...emptyRow(),
    service: s,
    description: s.label,
    rate_paise: d.price_paise ?? null,
    category: d.category_id ? { id: d.category_id, label: s.subtitle?.split(" · ")[0] ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null,
    gst: { gst_rate_bp: d.gst_rate_bp ?? 0, hsn_sac: d.sac ?? null },
  };
}

/**
 * Several charges at once on the stay's draft final bill: each service picked adds a row (or add a
 * typed one), then one click saves them all. Lines are sent one by one; a line that fails stays in
 * the list with its message and the saved ones leave it, so trying again never doubles anything.
 */
function AddChargeDialog({ admission, onDone }: { admission: Admission; onDone: () => void }) {
  const t = useTranslations("ip");
  const { saved, failed } = useFeedback();
  const [today] = useState(() => istDateString(new Date()));
  const admittedOn = istDateString(new Date(admission.admitted_at));
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [added, setAdded] = useState(0);
  const [schema] = useState(() => stayChargesSchema(admittedOn, today));
  const checks = useZodForm(schema);
  const update = (key: string, patch: Partial<ChargeRow>) => {
    const i = rows.findIndex((r) => r.key === key);
    for (const f of Object.keys(patch)) checks.clear(`lines.${i}.${f}`);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRow = (r: ChargeRow) => (setRows((rs) => [...rs, r]), checks.clear("lines"));
  const remove = (key: string) => {
    // Messages are per position: drop them all, they come back on the next check.
    for (let i = 0; i < rows.length; i++) for (const f of ["description", "qty", "rate_paise"]) checks.clear(`lines.${i}.${f}`);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };
  const total = rows.reduce((sum, r) => sum + Math.round((Number(r.qty) || 0) * (r.rate_paise ?? 0)), 0);

  const save = useMutation({
    mutationFn: async (d: { date: string; lines: { service: string | null; description: string; category: string | null; qty: number; rate_paise: number }[] }) => {
      let done = 0;
      for (const [i, line] of d.lines.entries()) {
        const row = rows[i]!;
        try {
          await rpc("add_stay_charge", {
            p_admission_id: admission.id,
            p_line: {
              description: line.description,
              service_id: line.service,
              category_id: line.category,
              service_date: d.date,
              qty: line.qty,
              rate_paise: line.rate_paise,
              ...(line.service && row.gst ? row.gst : {}),
            },
            p_client_id: row.clientId,
          });
          done++;
        } catch (e) {
          throw Object.assign(new Error("partly"), { cause: e, done });
        }
      }
      return done;
    },
    onSuccess: (n) => (saved(t("chargesAdded", { n: added + n })), onDone()),
    onError: (e) => {
      const { cause, done } = e as Error & { cause: unknown; done: number };
      // The saved lines leave the list; the one that failed is now first.
      setRows((rs) => rs.slice(done));
      setAdded((n) => n + done);
      failed(cause ?? e);
    },
  });

  return (
    <DialogContent
      wide
      title={t("addChargeTitle", { ip: admission.ip_number })}
      description={t("addChargeHint")}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="tabular-nums">
            {t("chargesTotal")}: <span className="font-semibold" data-testid="new-charges-total">{formatINR(total)}</span>
          </p>
          <Button
            disabled={save.isPending}
            onClick={() => {
              const d = checks.validate({ date, lines: rows });
              if (d) save.mutate(d);
            }}
          >
            <Plus aria-hidden />
            {t("saveCharges", { n: rows.length })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label={t("pickService")} hint={t("pickServiceHint")} error={checks.error("lines")}>
            {(a) => <LibraryCombobox {...a} kind="service" value={null} onChange={(s) => s && addRow(rowFromService(s))} />}
          </Field>
          <Field label={t("chargeDate")} error={checks.error("date")}>
            {(a) => <Input {...a} type="date" min={admittedOn} max={today} value={date} onChange={(e) => (setDate(e.target.value), checks.clear("date"))} />}
          </Field>
        </div>

        {rows.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label={t("chargeList")}>
            {rows.map((r, i) => (
              <li key={r.key} className="grid items-start gap-2 rounded-xl border border-border p-2.5 sm:grid-cols-[1fr_5rem_9rem_auto]">
                <Field label={t("chargeDescription")} labelClassName={i > 0 ? "sm:sr-only" : undefined} error={checks.error(`lines.${i}.description`)}>
                  {(a) => <Input {...a} maxLength={300} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />}
                </Field>
                <Field label={t("chargeQty")} labelClassName={i > 0 ? "sm:sr-only" : undefined} error={checks.error(`lines.${i}.qty`)}>
                  {(a) => <Input {...a} inputMode="decimal" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />}
                </Field>
                <Field label={t("chargeRate")} labelClassName={i > 0 ? "sm:sr-only" : undefined} error={checks.error(`lines.${i}.rate_paise`)}>
                  {(a) => <MoneyInput {...a} value={r.rate_paise} onChange={(v) => update(r.key, { rate_paise: v })} />}
                </Field>
                <Button
                  variant="ghost"
                  className={i === 0 ? "sm:mt-6" : undefined}
                  aria-label={t("removeCharge", { name: r.description || String(i + 1) })}
                  onClick={() => remove(r.key)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <Button variant="secondary" className="self-start" onClick={() => addRow(emptyRow())}>
          <Plus aria-hidden />
          {t("addTypedCharge")}
        </Button>
      </div>
    </DialogContent>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[0.9rem] text-text-secondary">{label}</p>
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
