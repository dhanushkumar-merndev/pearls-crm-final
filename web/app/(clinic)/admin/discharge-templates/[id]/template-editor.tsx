"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MedicationsEditor, SectionsEditor, type Medication, type Section } from "@/components/discharge/sections-editor";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { dischargeTemplateSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

export interface Template {
  id: string;
  name: string;
  sections: Section[];
  medications: Medication[];
  follow_up_days: number | null;
  active: boolean;
}

/** Edit a template's sections (with {{placeholders}}), medicines and follow-up. */
export function TemplateEditor({ initial }: { initial: Template }) {
  const t = useTranslations("dischargeTemplates");
  const router = useRouter();
  const { saved, failed } = useFeedback();
  const [name, setName] = useState(initial.name);
  const [sections, setSections] = useState<Section[]>(() => initial.sections.map((s) => ({ ...s, key: s.key || newId() })));
  const [meds, setMeds] = useState<Medication[]>(initial.medications);
  const [days, setDays] = useState(initial.follow_up_days === null ? "" : String(initial.follow_up_days));
  const checks = useZodForm(dischargeTemplateSchema);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => rpc("update_discharge_template", { p_template_id: initial.id, p_patch: patch }),
    onSuccess: () => {
      saved(t("saved"));
      router.push("/admin/discharge-templates");
    },
    onError: failed,
  });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href="/admin/discharge-templates">
            <ArrowLeft aria-hidden />
            {t("back")}
          </Link>
        </Button>
        <PageHeader title={t("editTitle", { name: initial.name })} description={t("editHint")} />
      </div>
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} error={checks.error("name")}>
          {(a) => (
            <Input
              {...a}
              maxLength={200}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                checks.clear("name");
              }}
            />
          )}
        </Field>
        <Field label={t("followUp")} error={checks.error("follow_up_days")}>
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                checks.clear("follow_up_days");
              }}
            />
          )}
        </Field>
      </Card>
      <SectionsEditor sections={sections} onChange={setSections} errorOf={checks.error} onEdit={checks.clear} />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("medications")}</CardTitle>
        <MedicationsEditor meds={meds} onChange={setMeds} errorOf={checks.error} onEdit={checks.clear} />
      </Card>
      <Button
        className="self-end"
        disabled={save.isPending}
        onClick={() => {
          const patch = checks.validate({ name, follow_up_days: days, sections, medications: meds });
          if (patch) save.mutate(patch);
        }}
      >
        <Save aria-hidden />
        {t("save")}
      </Button>
    </div>
  );
}
