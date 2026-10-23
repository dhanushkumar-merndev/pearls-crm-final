"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Save, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, fromIstDateTimeLocal, normalizePhone } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { StageBadge } from "./stage-badge";
import type { Lead, LeadStage } from "./types";
import { useSalesStaff } from "./use-sales-staff";

interface Duplicate {
  id: string;
  sl_no: number;
  name: string;
  stage: LeadStage;
  lead_date: string;
  assigned_name: string | null;
  phone_e164: string;
}
interface CreateResult {
  created: boolean;
  lead?: Lead;
  duplicates?: Duplicate[];
}

/** New lead. Same number as an existing lead → shown first; "Save anyway" links the two. */
export function NewLeadDialog({ canAssign, onDone }: { canAssign: boolean; onDone: () => void }) {
  const t = useTranslations("leads");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const staff = useSalesStaff();
  const [clientId] = useState(newId);
  const [f, setF] = useState({ name: "", phone: "", alt_phone: "", email: "", treatment_text: "", referred_by_text: "", comments1: "", due: "", assigned_to: "" });
  const [treatment, setTreatment] = useState<LibraryItem | null>(null);
  const [source, setSource] = useState<LibraryItem | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const phone = normalizePhone(f.phone);
  const alt = f.alt_phone.trim() ? normalizePhone(f.alt_phone) : null;
  const phoneBad = f.phone.trim() !== "" && !phone;
  const altBad = f.alt_phone.trim() !== "" && !alt;
  const valid = f.name.trim() !== "" && Boolean(phone) && !altBad;

  const create = useMutation({
    mutationFn: (force: boolean) =>
      rpc<CreateResult>("create_lead", {
        p_lead: {
          name: f.name.trim(),
          phone: phone!.e164,
          ...(alt ? { alt_phone: alt.e164 } : {}),
          ...(f.email.trim() ? { email: f.email.trim() } : {}),
          ...(treatment ? { treatment_template_id: treatment.id } : f.treatment_text.trim() ? { treatment_text: f.treatment_text.trim() } : {}),
          ...(source ? { source_id: source.id } : {}),
          ...(f.referred_by_text.trim() ? { referred_by_text: f.referred_by_text.trim() } : {}),
          ...(f.comments1.trim() ? { comments1: f.comments1.trim() } : {}),
          ...(f.due ? { next_followup_at: fromIstDateTimeLocal(f.due) } : {}),
          ...(canAssign && f.assigned_to ? { assigned_to: f.assigned_to } : {}),
          force,
        },
        p_client_id: clientId,
      }),
    onSuccess: (res) => {
      if (!res.created) return setDuplicates(res.duplicates ?? []);
      saved(t("savedLead", { n: res.lead!.sl_no }));
      void queryClient.invalidateQueries({ queryKey: ["leads_table"] });
      void queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
      onDone();
      router.push(`/leads/${res.lead!.id}`);
    },
    onError: failed,
  });

  if (duplicates) {
    return (
      <DialogContent
        wide
        title={t("dupTitle")}
        description={t("dupHint")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDuplicates(null)}>
              {t("back")}
            </Button>
            <Button variant="secondary" disabled={create.isPending} onClick={() => create.mutate(true)}>
              <Save aria-hidden />
              {t("saveAnyway")}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-2">
          {duplicates.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  #{d.sl_no} {d.name}
                </p>
                <p className="text-text-secondary">
                  {[d.phone_e164, formatDate(new Date(`${d.lead_date}T00:00:00+05:30`)), d.assigned_name ?? t("unassigned")].join(" · ")}
                </p>
              </div>
              <StageBadge stage={d.stage} />
              <Button asChild variant="secondary">
                <Link href={`/leads/${d.id}`} onClick={onDone}>
                  <ExternalLink aria-hidden />
                  {t("open")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      wide
      title={t("newTitle")}
      description={t("newHint")}
      footer={
        <Button disabled={!valid || create.isPending} onClick={() => create.mutate(false)}>
          <UserPlus aria-hidden />
          {create.isPending ? t("saving") : t("saveLead")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("f.name")}>{(a) => <Input {...a} autoFocus maxLength={200} value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label={t("f.phone")} error={phoneBad ? t("badPhone") : undefined}>
          {(a) => <Input {...a} inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
        </Field>
        <Field label={t("f.altPhone")} error={altBad ? t("badPhone") : undefined}>
          {(a) => <Input {...a} inputMode="tel" value={f.alt_phone} onChange={(e) => set("alt_phone", e.target.value)} />}
        </Field>
        <Field label={t("f.email")}>{(a) => <Input {...a} type="email" maxLength={200} value={f.email} onChange={(e) => set("email", e.target.value)} />}</Field>
        <Field label={t("f.treatment")} hint={t("treatmentHint")}>
          {(a) => <LibraryCombobox id={a.id} kind="treatment_template" value={treatment} onChange={setTreatment} />}
        </Field>
        <Field label={t("f.treatmentText")}>
          {(a) => <Input {...a} maxLength={200} disabled={Boolean(treatment)} value={f.treatment_text} onChange={(e) => set("treatment_text", e.target.value)} />}
        </Field>
        <Field label={t("f.source")}>{(a) => <LibraryCombobox id={a.id} kind="lead_source" allowCreate value={source} onChange={setSource} />}</Field>
        <Field label={t("f.referredBy")}>{(a) => <Input {...a} maxLength={200} value={f.referred_by_text} onChange={(e) => set("referred_by_text", e.target.value)} />}</Field>
        {canAssign && (
          <Field label={t("f.owner")} hint={t("ownerHint")}>
            {(a) => (
              <Select {...a} value={f.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
                <option value="">{t("roundRobin")}</option>
                {staff.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("f.due")} hint={t("dueHint")}>{(a) => <Input {...a} type="datetime-local" value={f.due} onChange={(e) => set("due", e.target.value)} />}</Field>
        <Field label={t("f.comments1")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={f.comments1} onChange={(e) => set("comments1", e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}
