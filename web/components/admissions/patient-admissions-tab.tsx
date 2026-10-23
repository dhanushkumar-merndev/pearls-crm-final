"use client";

import { BedDouble } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdmissionForm } from "./admission-form";
import { AdmissionsTable } from "./admissions-table";

/** Patient file → IP stays: the patient's admissions and "Admit". */
export function PatientAdmissionsTab({ patient }: { patient: PatientHit }) {
  const t = useTranslations("ip");
  const [admitting, setAdmitting] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Button className="self-start" onClick={() => setAdmitting(true)}>
        <BedDouble aria-hidden />
        {t("admit")}
      </Button>
      <AdmissionsTable patientId={patient.id} />
      <Dialog open={admitting} onOpenChange={setAdmitting}>
        {admitting && <AdmissionForm patient={patient} />}
      </Dialog>
    </div>
  );
}
