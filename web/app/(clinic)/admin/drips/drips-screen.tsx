"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { DialogContent, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, PageHeader, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Page, useAdminBack } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR, wrapText } from "@/components/ui/table";
import { rpc, unwrap } from "@/lib/rpc";
import { DRIP_AUDIENCES, DRIP_TRIGGERS, dripCampaignSchema, LEAD_TRIGGERS } from "@/lib/schemas/whatsapp";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  trigger: (typeof DRIP_TRIGGERS)[number];
  audience: (typeof DRIP_AUDIENCES)[number];
  stop_on_reply: boolean;
  stop_on_booking: boolean;
  active: boolean;
  version: number;
  steps: { id: string; seq: number; template_id: string; template: string; offset_minutes: number }[];
  active_enrollments: number;
  completed_enrollments: number;
}

interface StepDraft {
  template_id: string;
  days: string;
  hours: string;
}

/** "after 2 days 3 hours" from minutes. */
function delayParts(minutes: number): { days: number; hours: number } {
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60) };
}

/**
 * Admin → Drip campaigns: a series of approved WhatsApp templates sent on a schedule after
 * an event (a lead coming in, a consultation, a treatment, a discharge) or when staff add
 * someone. Replies and bookings can stop it; opted-out numbers never get it.
 */
export function DripsScreen() {
  const adminBack = useAdminBack();
  const t = useTranslations("drips");
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const campaigns = useQuery({ queryKey: ["drip_campaigns"], queryFn: () => rpc<Campaign[]>("drip_campaigns_list") });
  return (
    <Page>
      <PageHeader back={adminBack}
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("new")}
          </Button>
        }
      />
      <Table>
        <THead>
          <tr>
            <TH>{t("col.name")}</TH>
            <TH>{t("col.starts")}</TH>
            <TH>{t("col.steps")}</TH>
            <TH>{t("col.people")}</TH>
            <TH>{t("col.state")}</TH>
            <TH className="text-right">
              <span className="sr-only">{t("col.actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {campaigns.isPending && <RowSkeletons asRow rows={3} cols={6} />}
          {campaigns.isSuccess && campaigns.data.length === 0 && <EmptyRow colSpan={6}>{t("empty")}</EmptyRow>}
          {(campaigns.data ?? []).map((c) => (
            <TR key={c.id}>
              <TD>
                <span className="block font-medium">{c.name}</span>
                {c.description && <span className="block text-[0.9rem] text-text-secondary">{c.description}</span>}
              </TD>
              <TD>
                {t(`trigger.${c.trigger}`)}
                <span className="block text-[0.9rem] text-text-secondary">{t(`audience.${c.audience}`)}</span>
              </TD>
              <TD className={cn("text-[0.95rem]", wrapText)}>
                {c.steps.map((s) => {
                  const d = delayParts(s.offset_minutes);
                  return (
                    <span key={s.id} className="block">
                      {t("stepLine", { n: s.seq, days: d.days, hours: d.hours, template: s.template })}
                    </span>
                  );
                })}
              </TD>
              <TD className="tabular-nums">{t("people", { active: c.active_enrollments, done: c.completed_enrollments })}</TD>
              <TD>
                <StatusBadge kind={c.active ? "good" : "serious"} label={c.active ? t("on") : t("off")} />
              </TD>
              <TD className="text-right">
                <Button variant="ghost" onClick={() => setEditing(c)}>
                  <Pencil aria-hidden />
                  {t("edit")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <CampaignDialog campaign={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </Page>
  );
}

function CampaignDialog({ campaign, onDone }: { campaign: Campaign | null; onDone: () => void }) {
  const t = useTranslations("drips");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [f, setF] = useState({
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
    trigger: campaign?.trigger ?? "manual",
    audience: campaign?.audience ?? "patient",
    stop_on_reply: campaign?.stop_on_reply ?? true,
    stop_on_booking: campaign?.stop_on_booking ?? true,
    active: campaign?.active ?? true,
  });
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    campaign?.steps.length
      ? campaign.steps.map((s) => {
          const d = delayParts(s.offset_minutes);
          return { template_id: s.template_id, days: String(d.days), hours: String(d.hours) };
        })
      : [{ template_id: "", days: "0", hours: "0" }],
  );
  const templates = useQuery({
    queryKey: ["wa_templates", "usable"],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser().from("wa_templates").select("id, name, body_text, category").eq("active", true).eq("status", "APPROVED").order("name"),
      ) as { id: string; name: string }[],
  });
  const checks = useZodForm(dripCampaignSchema);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    checks.clear(k);
  };
  const setStep = (i: number, patch: Partial<StepDraft>) => {
    setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    for (const k of Object.keys(patch)) checks.clear(`steps.${i}.${k}`);
    checks.clear("steps");
  };
  const save = useMutation({
    mutationFn: (d: z.output<typeof dripCampaignSchema>) =>
      rpc("drip_campaign_save", { p: { ...d, id: campaign?.id ?? null, version: campaign?.version ?? null } }),
    onSuccess: () => {
      saved();
      void queryClient.invalidateQueries({ queryKey: ["drip_campaigns"] });
      onDone();
    },
    onError: (e) => {
      if (!checks.fromServer(e, { name: "name", steps: "steps" })) failed(e);
    },
  });
  const triggers = DRIP_TRIGGERS.filter((x) => (f.audience === "lead" ? LEAD_TRIGGERS.includes(x) : x !== "lead_created"));
  return (
    <DialogContent
      wide
      title={campaign ? t("editTitle", { name: campaign.name }) : t("newTitle")}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ ...f, steps });
            if (d) save.mutate(d);
          }}
        >
          <Save aria-hidden />
          {save.isPending ? t("saving") : t("save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("f.name")} error={checks.error("name")} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label={t("f.description")} error={checks.error("description")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={f.description} onChange={(e) => set("description", e.target.value)} />}
        </Field>
        <Field label={t("f.audience")} error={checks.error("audience")}>
          {(a) => (
            <Select
              {...a}
              value={f.audience}
              onChange={(e) => {
                const audience = e.target.value as Campaign["audience"];
                set("audience", audience);
                // Keep the trigger valid for the new audience.
                if (audience === "lead" ? !LEAD_TRIGGERS.includes(f.trigger) : f.trigger === "lead_created") set("trigger", "manual");
              }}
            >
              {DRIP_AUDIENCES.map((x) => (
                <option key={x} value={x}>
                  {t(`audience.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("f.trigger")} error={checks.error("trigger")}>
          {(a) => (
            <Select {...a} value={f.trigger} onChange={(e) => set("trigger", e.target.value as Campaign["trigger"])}>
              {triggers.map((x) => (
                <option key={x} value={x}>
                  {t(`trigger.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox label={t("f.stop_on_reply")} checked={f.stop_on_reply} onChange={(e) => set("stop_on_reply", e.target.checked)} className="sm:col-span-2" />
        <Checkbox label={t("f.stop_on_booking")} checked={f.stop_on_booking} onChange={(e) => set("stop_on_booking", e.target.checked)} className="sm:col-span-2" />
        <Checkbox label={t("f.active")} hint={t("f.activeHint")} checked={f.active} onChange={(e) => set("active", e.target.checked)} className="sm:col-span-2" />
      </div>

      <fieldset className="mt-5 flex flex-col gap-3">
        <legend className="mb-1 font-semibold">{t("stepsTitle")}</legend>
        <p className="text-[0.95rem] text-text-secondary">{t("stepsHint")}</p>
        {templates.isSuccess && templates.data.length === 0 && <p className="text-bad-text">{t("noTemplates")}</p>}
        {steps.map((s, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-start">
            <Field label={t("f.template", { n: i + 1 })} error={checks.error(`steps.${i}.template_id`)}>
              {(a) => (
                <Select {...a} value={s.template_id} onChange={(e) => setStep(i, { template_id: e.target.value })}>
                  <option value="">{t("chooseTemplate")}</option>
                  {(templates.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("f.days")} error={checks.error(`steps.${i}.days`)}>
              {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={364} value={s.days} onChange={(e) => setStep(i, { days: e.target.value })} />}
            </Field>
            <Field label={t("f.hours")} error={checks.error(`steps.${i}.hours`)}>
              {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={23} value={s.hours} onChange={(e) => setStep(i, { hours: e.target.value })} />}
            </Field>
            <Button
              variant="ghost"
              className="sm:mt-7"
              disabled={steps.length === 1}
              aria-label={t("removeStep", { n: i + 1 })}
              onClick={() => setSteps((list) => list.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {checks.error("steps") && (
          <p role="alert" className="text-[0.95rem] text-bad-text">
            {checks.error("steps")}
          </p>
        )}
        <Button
          variant="secondary"
          className="self-start"
          disabled={steps.length >= 50}
          onClick={() => setSteps((list) => [...list, { template_id: "", days: list.at(-1)?.days ?? "0", hours: list.at(-1)?.hours ?? "0" }])}
        >
          <Plus aria-hidden />
          {t("addStep")}
        </Button>
      </fieldset>
    </DialogContent>
  );
}
