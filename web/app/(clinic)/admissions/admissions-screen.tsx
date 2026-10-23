"use client";

import { BedDouble } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AdmissionForm } from "@/components/admissions/admission-form";
import { AdmissionsTable } from "@/components/admissions/admissions-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/form";

export function AdmissionsScreen() {
  const t = useTranslations("ip");
  const [admitting, setAdmitting] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdmitting(true)}>
            <BedDouble aria-hidden />
            {t("admit")}
          </Button>
        }
      />
      <AdmissionsTable />
      <Dialog open={admitting} onOpenChange={setAdmitting}>
        {admitting && <AdmissionForm />}
      </Dialog>
    </div>
  );
}
