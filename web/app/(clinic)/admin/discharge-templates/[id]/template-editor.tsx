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
import { useFeedback } from "@/lib/use-feedback";

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
  const save = useMutation({
    mutationFn: () =>
      rpc("update_discharge_template", {
        p_template_id: initial.id,
        p_patch: { name, sections, medications: meds, follow_up_days: /^\d+$/.test(days) ? Number(days) : null },
      }),
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
        <Field label={t("name")}>{(a) => <Input {...a} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("followUp")}>{(a) => <Input {...a} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
      </Card>
      <SectionsEditor sections={sections} onChange={setSections} />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("medications")}</CardTitle>
        <MedicationsEditor meds={meds} onChange={setMeds} />
      </Card>
      <Button className="self-end" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
        <Save aria-hidden />
        {t("save")}
      </Button>
    </div>
  );
}
