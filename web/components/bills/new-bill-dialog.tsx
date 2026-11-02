"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { formatDate, istDateString } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { newId, rpc } from "@/lib/rpc";
import { billTargetLinks, billTargetSchema } from "@/lib/schemas/billing";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Visit {
  id: string;
  appt_date: string;
  status: string;
  doctor: string | null;
  session: { seq: number; treatment: string } | null;
}
interface TreatmentRow {
  id: string;
  name: string;
  status: string;
  sessions: { id: string; seq: number; status: string; appointment_id: string | null; actual_date: string | null }[];
}
interface StayRow {
  id: string;
  ip_number: string;
  status: string;
}

const VISITED = new Set(["arrived", "with_doctor", "done"]);

/**
 * New bill: first "What is this bill for?" (owner, 02/11/2026: every bill must say which visit, session or
 * stay it belongs to). Today's visit is chosen already; "Nothing in particular" is a deliberate choice.
 */
export function NewBillDialog({ patientId, type, onDone }: { patientId: string; type: "procedure_receipt" | "pharmacy_invoice"; onDone: () => void }) {
  const t = useTranslations("newBill");
  const tr = useTranslations("treatments");
  const router = useRouter();
  const { failed } = useFeedback();
  const checks = useZodForm(billTargetSchema);
  const visits = useQuery({
    queryKey: ["bill_targets_visits", patientId],
    queryFn: () => rpc<{ items: Visit[] }>("patient_appointments", { p_patient_id: patientId, p_limit: 30 }),
  });
  const treatments = useQuery({
    queryKey: ["patient_treatments", patientId],
    queryFn: () => rpc<TreatmentRow[]>("patient_treatments_list", { p_patient_id: patientId }),
  });
  const stays = useQuery({
    queryKey: ["bill_targets_stays", patientId],
    queryFn: () => rpc<{ rows: StayRow[] }>("admissions_table", { p_filters: { patient_id: patientId }, p_limit: 20 }),
  });
  const options = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const v of (visits.data?.items ?? []).filter((x) => VISITED.has(x.status))) {
      const what = v.session ? `${v.session.treatment} — ${tr("sessionN", { n: v.session.seq })}` : t("consultation");
      out.push({ value: `appointment:${v.id}`, label: t("visitOption", { date: formatDate(new Date(v.appt_date)), what, doctor: v.doctor ?? "—" }) });
    }
    for (const x of (treatments.data ?? []).filter((x) => x.status === "active" || x.status === "on_hold")) {
      // Sessions done without a booking (with a booking they are listed as that visit above).
      for (const s of x.sessions.filter((s) => s.status === "done" && !s.appointment_id)) {
        out.push({
          value: `session:${s.id}`,
          label: t("sessionOption", { what: `${x.name} — ${tr("sessionN", { n: s.seq })}`, date: s.actual_date ? formatDate(new Date(s.actual_date)) : "—" }),
        });
      }
      out.push({ value: `treatment:${x.id}`, label: t("treatmentOption", { name: x.name }) });
    }
    for (const a of (stays.data?.rows ?? []).filter((a) => a.status !== "cancelled")) {
      out.push({ value: `admission:${a.id}`, label: t("stayOption", { ip: a.ip_number }) });
    }
    return out;
  }, [visits.data, treatments.data, stays.data, t, tr]);
  // Today's latest visit is the usual answer.
  const today = istDateString(new Date());
  const todayVisit = (visits.data?.items ?? []).find((v) => VISITED.has(v.status) && v.appt_date === today);
  const [picked, setPicked] = useState<string | null>(null);
  const target = picked ?? (todayVisit ? `appointment:${todayVisit.id}` : "");
  const loading = visits.isPending || treatments.isPending || stays.isPending;
  const create = useMutation({
    mutationFn: (links: Record<string, string>) =>
      rpc<{ id: string }>("create_bill", { p_type: type, p_patient_id: patientId, p_links: links, p_client_id: newId() }),
    onSuccess: (b) => router.push(`/bills/${b.id}`),
    onError: failed,
  });
  return (
    <DialogContent
      title={t(type === "pharmacy_invoice" ? "titlePharmacy" : "title")}
      description={t("description")}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button
            disabled={create.isPending || loading}
            onClick={() => {
              const d = checks.validate({ target });
              if (d) create.mutate(billTargetLinks(d.target));
            }}
          >
            {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <FilePlus2 aria-hidden />}
            {t("make")}
          </Button>
        </>
      }
    >
      <Field label={t("for")} error={checks.error("target")}>
        {(a) => (
          <Select {...a} value={target} disabled={loading} onChange={(e) => (setPicked(e.target.value), checks.clear("target"))}>
            <option value="" disabled>
              {loading ? t("loading") : t("choose")}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="none">{t("none")}</option>
          </Select>
        )}
      </Field>
    </DialogContent>
  );
}
