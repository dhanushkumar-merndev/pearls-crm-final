"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CirclePlus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { z } from "zod";
import { fromIstDateTimeLocal, istDateTimeLocal } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { admissionSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import type { Admission } from "./types";

interface SurgeonRow {
  key: string;
  doctor: LibraryItem | null;
  role: "primary" | "assistant" | "visiting";
}

const lib = (id: string | null | undefined, label: string | null | undefined): LibraryItem | null =>
  id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;

/** Admit a patient, or edit a stay (after discharge: admin only, with a reason). */
export function AdmissionForm({
  admission,
  patient: fixedPatient,
  onDone,
}: {
  admission?: Admission;
  patient?: PatientHit;
  onDone?: (a: Admission) => void;
}) {
  const t = useTranslations("ip");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const editing = Boolean(admission);
  const [patient, setPatient] = useState<PatientHit | null>(
    fixedPatient ?? (admission ? { id: admission.patient_id, title: admission.patient, uhid: admission.uhid, subtitle: "" } : null),
  );
  const [admittedAt, setAdmittedAt] = useState(istDateTimeLocal(admission ? new Date(admission.admitted_at) : new Date()));
  const [treatmentId, setTreatmentId] = useState(admission?.treatment_id ?? "");
  const [room, setRoom] = useState<LibraryItem | null>(lib(admission?.room_type_id, admission?.room_type));
  const [roomLabel, setRoomLabel] = useState(admission?.room_label ?? "");
  const [procedures, setProcedures] = useState((admission?.procedures ?? []).join(", "));
  const [diagnosis, setDiagnosis] = useState(admission?.diagnosis ?? "");
  const [anaesthesia, setAnaesthesia] = useState(admission?.anaesthesia ?? "");
  const [surgeryAt, setSurgeryAt] = useState(admission?.surgery_at ? istDateTimeLocal(new Date(admission.surgery_at)) : "");
  const [attender, setAttender] = useState({
    name: admission?.attender_name ?? "",
    phone: admission?.attender_phone ?? "",
    relation: admission?.attender_relation ?? "",
  });
  const [surgeons, setSurgeons] = useState<SurgeonRow[]>(() =>
    admission?.surgeons.length
      ? admission.surgeons.map((s) => ({ key: newId(), doctor: lib(s.doctor_id, s.name), role: s.role }))
      : [{ key: newId(), doctor: null, role: "primary" }],
  );
  const [reason, setReason] = useState("");
  const [clientId] = useState(newId);
  const afterDischarge = editing && admission!.status !== "admitted";

  const treatments = useQuery({
    queryKey: ["treatments", patient?.id],
    queryFn: () => rpc<{ id: string; name: string; status: string }[]>("patient_treatments_list", { p_patient_id: patient!.id }),
    enabled: Boolean(patient),
  });

  const [schema] = useState(() => admissionSchema(afterDischarge));
  const checks = useZodForm(schema);
  const clear = (path: string) => checks.clear(path);
  type Checked = z.output<typeof schema>;
  const payload = (d: Checked) => ({
    patient_id: d.patient,
    admitted_at: fromIstDateTimeLocal(d.admitted_at),
    treatment_id: d.treatment,
    room_type_id: d.room,
    room_label: d.room_label,
    procedures: d.procedures,
    diagnosis: d.diagnosis,
    anaesthesia: d.anaesthesia,
    surgery_at: d.surgery_at ? fromIstDateTimeLocal(d.surgery_at) : null,
    attender_name: d.attender_name,
    attender_phone: d.attender_phone,
    attender_relation: d.attender_relation,
    surgeons: d.surgeons.filter((s) => s.doctor).map((s) => ({ doctor_id: s.doctor, role: s.role })),
  });
  const save = useMutation({
    mutationFn: (d: Checked) =>
      editing
        ? rpc<Admission>("update_admission", { p_admission_id: admission!.id, p_patch: payload(d), p_version: admission!.version, p_reason: d.reason })
        : rpc<Admission>("admit_patient", { p_admission: payload(d), p_client_id: clientId }),
    onSuccess: (a) => {
      saved(editing ? t("updated") : t("admitted", { ip: a.ip_number }));
      for (const key of ["admission", "admissions"]) void queryClient.invalidateQueries({ queryKey: [key] });
      if (onDone) onDone(a);
      else router.push(`/admissions/${a.id}`);
    },
    onError: (e) => {
      if (asAppError(e).code === "dates_invalid") return checks.setError("surgery_at", "errors.dates_invalid");
      failed(e);
    },
  });

  return (
    <DialogContent
      wide
      title={editing ? t("editTitle", { ip: admission!.ip_number }) : t("admitTitle")}
      description={editing ? undefined : t("admitHint")}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({
              patient,
              admitted_at: admittedAt,
              treatment: treatmentId,
              room,
              room_label: roomLabel,
              procedures,
              diagnosis,
              anaesthesia,
              surgery_at: surgeryAt,
              attender_name: attender.name,
              attender_phone: attender.phone,
              attender_relation: attender.relation,
              surgeons: surgeons.map((s) => ({ doctor: s.doctor, role: s.role })),
              reason,
            });
            if (d) save.mutate(d);
          }}
        >
          {editing ? <Save aria-hidden /> : <BedDouble aria-hidden />}
          {editing ? t("saveChanges") : t("admit")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!editing && !fixedPatient && (
          <Field label={t("patient")} error={checks.error("patient")} className="sm:col-span-2">
            {(a) => <PatientPicker {...a} value={patient} onChange={(p) => (setPatient(p), clear("patient"))} />}
          </Field>
        )}
        <Field label={t("admittedAt")} error={checks.error("admitted_at")}>
          {(a) => <Input {...a} type="datetime-local" value={admittedAt} onChange={(e) => (setAdmittedAt(e.target.value), clear("admitted_at"))} />}
        </Field>
        <Field label={t("treatment")} hint={t("treatmentHint")} error={checks.error("treatment")}>
          {(a) => (
            <Select {...a} value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)} disabled={!patient}>
              <option value="">{t("noTreatment")}</option>
              {treatments.data?.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("roomType")} error={checks.error("room")}>{(a) => <LibraryCombobox {...a} kind="room_type" value={room} onChange={setRoom} />}</Field>
        <Field label={t("roomLabel")} hint={t("roomLabelHint")} error={checks.error("room_label")}>
          {(a) => <Input {...a} maxLength={60} value={roomLabel} onChange={(e) => (setRoomLabel(e.target.value), clear("room_label"))} />}
        </Field>
        <Field label={t("procedures")} hint={t("proceduresHint")} error={checks.error("procedures")} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={500} value={procedures} onChange={(e) => (setProcedures(e.target.value), clear("procedures"))} />}
        </Field>
        <Field label={t("diagnosis")} error={checks.error("diagnosis")} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={500} value={diagnosis} onChange={(e) => (setDiagnosis(e.target.value), clear("diagnosis"))} />}
        </Field>
        <Field label={t("anaesthesia")} error={checks.error("anaesthesia")}>
          {(a) => <Input {...a} maxLength={120} value={anaesthesia} onChange={(e) => (setAnaesthesia(e.target.value), clear("anaesthesia"))} />}
        </Field>
        <Field label={t("surgeryAt")} error={checks.error("surgery_at")}>
          {(a) => <Input {...a} type="datetime-local" value={surgeryAt} onChange={(e) => (setSurgeryAt(e.target.value), clear("surgery_at"))} />}
        </Field>

        <fieldset className="flex flex-col gap-3 sm:col-span-2">
          <legend className="mb-2 font-medium">{t("surgeons")}</legend>
          {surgeons.map((s, i) => (
            <div key={s.key} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <Field label={t("doctor")} error={checks.error(`surgeons.${i}.doctor`)}>
                {(a) => (
                  <LibraryCombobox
                    {...a}
                    kind="doctor"
                    value={s.doctor}
                    onChange={(d) => (setSurgeons((ss) => ss.map((x) => (x.key === s.key ? { ...x, doctor: d } : x))), clear(`surgeons.${i}.doctor`))}
                  />
                )}
              </Field>
              <Field label={t("role")}>
                {(a) => (
                  <Select {...a} value={s.role} onChange={(e) => setSurgeons((ss) => ss.map((x) => (x.key === s.key ? { ...x, role: e.target.value as SurgeonRow["role"] } : x)))}>
                    {(["primary", "assistant", "visiting"] as const).map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="ghost" aria-label={t("removeSurgeon", { n: i + 1 })} onClick={() => setSurgeons((ss) => ss.filter((x) => x.key !== s.key))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button variant="ghost" className="self-start" onClick={() => setSurgeons((ss) => [...ss, { key: newId(), doctor: null, role: ss.length ? "assistant" : "primary" }])}>
            <CirclePlus aria-hidden />
            {t("addSurgeon")}
          </Button>
        </fieldset>

        <Field label={t("attenderName")} error={checks.error("attender_name")}>
          {(a) => <Input {...a} maxLength={120} value={attender.name} onChange={(e) => (setAttender((x) => ({ ...x, name: e.target.value })), clear("attender_name"))} />}
        </Field>
        <Field label={t("attenderPhone")} error={checks.error("attender_phone")}>
          {(a) => (
            <Input {...a} type="tel" inputMode="tel" maxLength={40} value={attender.phone}
              onChange={(e) => (setAttender((x) => ({ ...x, phone: e.target.value })), clear("attender_phone"))} />
          )}
        </Field>
        <Field label={t("attenderRelation")} error={checks.error("attender_relation")}>
          {(a) => (
            <Input {...a} maxLength={40} value={attender.relation}
              onChange={(e) => (setAttender((x) => ({ ...x, relation: e.target.value })), clear("attender_relation"))} />
          )}
        </Field>
        {afterDischarge && (
          <Field label={t("editReason")} error={checks.error("reason")} className="sm:col-span-2">
            {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), clear("reason"))} />}
          </Field>
        )}
      </div>
    </DialogContent>
  );
}
