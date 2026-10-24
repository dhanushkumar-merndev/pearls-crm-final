"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, PlugZap, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime, formatINR, readSettings, SETTINGS_SCHEMAS, type Settings } from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, PageHeader, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asAppError, callFunction, rpc, unwrap } from "@/lib/rpc";
import { templateSchema, WA_PURPOSES, WA_VARS } from "@/lib/schemas/whatsapp";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Overview {
  integration: { state: "ok" | "error" | "unknown" | "off"; last_ok_at: string | null; last_error: string | null; checked_at: string | null } | null;
  month: { sent: number; delivered: number; read: number; failed: number; manual: number; cost_paise: number };
  received: number;
  queued: number;
  opted_out: number;
  last_dispatch: string | null;
  failures: { id: string; phone_e164: string; error_text: string | null; at: string; purpose: string | null }[];
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  param_count: number;
  purpose: string | null;
  variable_map: string[];
  active: boolean;
  synced_at: string | null;
}

/**
 * Admin → WhatsApp: the Cloud API connection (state, test, webhook address), this month's
 * messages and estimated cost, the settings (on/off, reminders, quiet hours) and the
 * templates — what each is for and which value fills each {{n}}.
 */
export function WhatsAppAdminScreen({ webhookUrl }: { webhookUrl: string }) {
  const t = useTranslations("waAdmin");
  const { saved, errorMessage } = useFeedback();
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["wa_overview"], queryFn: () => rpc<Overview>("wa_overview"), refetchInterval: 60_000 });
  const test = useMutation({
    mutationFn: () => callFunction<{ display_phone_number?: string; verified_name?: string }>("wa-templates-sync", { action: "test" }),
    onSuccess: (r) => saved(t("testOk", { name: r.verified_name ?? "—", number: r.display_phone_number ?? "—" })),
    onError: (e) => showError(e),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["wa_overview"] }),
  });
  const sync = useMutation({
    mutationFn: () => callFunction<{ count: number; skipped: number }>("wa-templates-sync", { action: "sync" }),
    onSuccess: (r) => saved(t("synced", { count: r.count })),
    onError: (e) => showError(e),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["wa_overview"] });
      void queryClient.invalidateQueries({ queryKey: ["wa_templates"] });
    },
  });
  // Meta's own words help the admin fix the key (shown under the translated message).
  const [problem, setProblem] = useState<string | null>(null);
  function showError(e: unknown) {
    const err = asAppError(e);
    setProblem([errorMessage(e), err.detail].filter(Boolean).join(" — "));
  }
  const o = overview.data;
  const state = o?.integration?.state ?? "unknown";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{t("connection")}</CardTitle>
          <StatusBadge kind={state === "ok" ? "good" : state === "error" ? "critical" : "serious"} label={t(`state.${state}`)} />
        </div>
        <CardDescription>
          {o?.integration?.last_ok_at ? t("lastOk", { at: formatDateTime(new Date(o.integration.last_ok_at)) }) : t("neverOk")}
          {" · "}
          {o?.last_dispatch ? t("lastRun", { at: formatDateTime(new Date(o.last_dispatch)) }) : t("noRunYet")}
        </CardDescription>
        {state === "error" && o?.integration?.last_error && <p className="text-bad-text">{o.integration.last_error}</p>}
        {problem && (
          <p role="alert" className="text-bad-text">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={test.isPending} onClick={() => (setProblem(null), test.mutate())}>
            <PlugZap aria-hidden />
            {test.isPending ? t("testing") : t("test")}
          </Button>
          <Button variant="secondary" disabled={sync.isPending} onClick={() => (setProblem(null), sync.mutate())}>
            <RefreshCw aria-hidden />
            {sync.isPending ? t("syncing") : t("sync")}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("callbackUrl")} className="min-w-72 flex-1">
            {(a) => <Input {...a} readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />}
          </Field>
          <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => saved(t("copied")))}>
            <Copy aria-hidden />
            {t("copy")}
          </Button>
        </div>
        <CardDescription>{t("setupHint")}</CardDescription>
      </Card>

      {o && (
        <section aria-label={t("monthTitle")} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("monthTitle")}</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ["sent", o.month.sent],
                ["delivered", o.month.delivered],
                ["read", o.month.read],
                ["failed", o.month.failed],
                ["manual", o.month.manual],
                ["received", o.received],
                ["queued", o.queued],
                ["optedOut", o.opted_out],
              ] as const
            ).map(([k, n]) => (
              <Card key={k} className="flex flex-col gap-1">
                <dt className="text-text-secondary">{t(`n.${k}`)}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{n.toLocaleString("en-IN")}</dd>
              </Card>
            ))}
            <Card className="flex flex-col gap-1">
              <dt className="text-text-secondary">{t("n.cost")}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{formatINR(o.month.cost_paise)}</dd>
            </Card>
          </dl>
          <p className="text-[0.9rem] text-text-secondary">{t("costHint")}</p>
        </section>
      )}

      <SettingsForm />
      <Templates />

      {o && o.failures.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("failuresTitle")}</h2>
          <Table>
            <THead>
              <tr>
                <TH>{t("col.when")}</TH>
                <TH>{t("col.phone")}</TH>
                <TH>{t("col.purpose")}</TH>
                <TH>{t("col.problem")}</TH>
              </tr>
            </THead>
            <tbody>
              {o.failures.map((f) => (
                <TR key={f.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(new Date(f.at))}</TD>
                  <TD className="tabular-nums">{f.phone_e164}</TD>
                  <TD>{f.purpose && t.has(`purpose.${f.purpose}`) ? t(`purpose.${f.purpose}` as "purpose.other") : "—"}</TD>
                  <TD className="max-w-md text-[0.95rem] text-text-secondary">{f.error_text ?? "—"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      <Link href="/admin/drips" className="self-start text-link underline-offset-4 hover:underline">
        {t("dripsLink")}
      </Link>
    </div>
  );
}

type WaSettings = Settings<"whatsapp">;

function SettingsForm() {
  const t = useTranslations("waAdmin");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: ["app_settings", "whatsapp"],
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("app_settings").select("value, version").eq("section", "whatsapp").maybeSingle()) as {
        value: unknown;
        version: number;
      } | null,
  });
  const [form, setForm] = useState<WaSettings>(() => readSettings("whatsapp", null));
  const [stopReply, setStopReply] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!stored.isSuccess || loaded) return;
    const v = readSettings("whatsapp", stored.data?.value);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time copy of server data into the editable form
    setForm(v);
    setStopReply(v.stop_reply ?? "");
    setLoaded(true);
  }, [stored.isSuccess, stored.data, loaded]);
  const checks = useZodForm(SETTINGS_SCHEMAS.whatsapp);
  const set = <K extends keyof WaSettings>(k: K, v: WaSettings[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    checks.clear(k);
  };
  const save = useMutation({
    mutationFn: (clean: WaSettings) =>
      rpc<number>("update_settings", { p_section: "whatsapp", p_value: clean, p_version: stored.data?.version ?? 0 }),
    onSuccess: () => {
      saved();
      setLoaded(false);
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void queryClient.invalidateQueries({ queryKey: ["wa_thread"] });
    },
    onError: failed,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    // An emptied price box stays NaN so it is reported (undefined would quietly take the default).
    const clean = checks.validate({ ...form, stop_reply: stopReply.trim() === "" ? null : stopReply });
    if (clean) save.mutate(clean);
  }
  const bool = (k: "enabled" | "send_booking_confirmation" | "send_reminders", hint?: string) => (
    <Checkbox label={t(`s.${k}`)} hint={hint} checked={form[k]} onChange={(e) => set(k, e.target.checked)} className="sm:col-span-2" />
  );
  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <CardTitle>{t("settingsTitle")}</CardTitle>
          <CardDescription>{t("settingsHint")}</CardDescription>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {bool("enabled", t("s.enabledHint"))}
          {bool("send_booking_confirmation")}
          {bool("send_reminders", t("s.remindersHint"))}
          <Field label={t("s.quiet_start")} error={checks.error("quiet_start")} hint={t("s.quietHint")}>
            {(a) => <Input {...a} type="time" value={form.quiet_start} onChange={(e) => set("quiet_start", e.target.value)} />}
          </Field>
          <Field label={t("s.quiet_end")} error={checks.error("quiet_end")}>
            {(a) => <Input {...a} type="time" value={form.quiet_end} onChange={(e) => set("quiet_end", e.target.value)} />}
          </Field>
          <Field label={t("s.cost_utility_paise")} error={checks.error("cost_utility_paise")}>
            {(a) => <MoneyInput {...a} value={Number.isFinite(form.cost_utility_paise) ? form.cost_utility_paise : null} onChange={(p) => set("cost_utility_paise", p ?? Number.NaN)} />}
          </Field>
          <Field label={t("s.cost_marketing_paise")} error={checks.error("cost_marketing_paise")}>
            {(a) => <MoneyInput {...a} value={Number.isFinite(form.cost_marketing_paise) ? form.cost_marketing_paise : null} onChange={(p) => set("cost_marketing_paise", p ?? Number.NaN)} />}
          </Field>
          <Field label={t("s.stop_reply")} error={checks.error("stop_reply")} hint={t("s.stopReplyHint")} className="sm:col-span-2">
            {(a) => (
              <Textarea
                {...a}
                rows={2}
                maxLength={1000}
                value={stopReply}
                onChange={(e) => {
                  setStopReply(e.target.value);
                  checks.clear("stop_reply");
                }}
              />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={save.isPending || !loaded} className="self-start">
          <Save aria-hidden />
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </form>
    </Card>
  );
}

function Templates() {
  const t = useTranslations("waAdmin");
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const templates = useQuery({
    queryKey: ["wa_templates", "all"],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser()
          .from("wa_templates")
          .select("id, name, language, category, status, body_text, param_count, purpose, variable_map, active, synced_at")
          .order("name"),
      ) as TemplateRow[],
  });
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("templatesTitle")}</h2>
      <p className="text-[0.95rem] text-text-secondary">{t("templatesHint")}</p>
      <Table>
        <THead>
          <tr>
            <TH>{t("col.template")}</TH>
            <TH>{t("col.status")}</TH>
            <TH>{t("col.purpose")}</TH>
            <TH>{t("col.values")}</TH>
            <TH className="text-right">
              <span className="sr-only">{t("col.actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {templates.isPending && <EmptyRow colSpan={5}>{t("loading")}</EmptyRow>}
          {templates.isSuccess && templates.data.length === 0 && <EmptyRow colSpan={5}>{t("noTemplates")}</EmptyRow>}
          {(templates.data ?? []).map((x) => (
            <TR key={x.id}>
              <TD>
                <span className="block font-medium">{x.name}</span>
                <span className="block text-[0.9rem] text-text-secondary">
                  {x.language} · {t(`category.${x.category}` as "category.utility")}
                  {!x.active && ` · ${t("off")}`}
                </span>
                {x.body_text && <span className="mt-1 block max-w-xl text-[0.9rem] whitespace-pre-wrap text-text-secondary">{x.body_text}</span>}
              </TD>
              <TD>
                <StatusBadge
                  kind={x.status === "APPROVED" ? "good" : x.status === "REJECTED" || x.status === "DISABLED" ? "critical" : "warning"}
                  label={t.has(`tplStatus.${x.status}`) ? t(`tplStatus.${x.status}` as "tplStatus.APPROVED") : x.status}
                />
              </TD>
              <TD>{x.purpose ? t(`purpose.${x.purpose}` as "purpose.other") : "—"}</TD>
              <TD className="text-[0.95rem]">
                {x.param_count === 0
                  ? t("noValues")
                  : x.variable_map.length === x.param_count
                    ? x.variable_map.map((v, i) => `{{${i + 1}}} ${t(`var.${v}` as "var.name")}`).join(", ")
                    : <span className="text-bad-text">{t("valuesMissing", { n: x.param_count })}</span>}
              </TD>
              <TD className="text-right">
                <Button variant="ghost" onClick={() => setEditing(x)}>
                  <Pencil aria-hidden />
                  {t("edit")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <TemplateDialog row={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </section>
  );
}

function TemplateDialog({ row, onDone }: { row: TemplateRow; onDone: () => void }) {
  const t = useTranslations("waAdmin");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [purpose, setPurpose] = useState(row.purpose ?? "");
  const [vars, setVars] = useState<string[]>(() => Array.from({ length: row.param_count }, (_, i) => row.variable_map[i] ?? ""));
  const [active, setActive] = useState(row.active);
  const checks = useZodForm(templateSchema(row.param_count));
  const save = useMutation({
    mutationFn: (patch: { purpose: string | null; variable_map: string[]; active: boolean }) => rpc("wa_template_update", { p_id: row.id, p_patch: patch }),
    onSuccess: () => {
      saved();
      void queryClient.invalidateQueries({ queryKey: ["wa_templates"] });
      onDone();
    },
    onError: (e) => {
      if (!checks.fromServer(e, { purpose: "purpose", variable_map: "variable_map" })) failed(e);
    },
  });
  return (
    <DialogContent
      wide
      title={row.name}
      description={row.body_text ?? undefined}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ purpose, variable_map: vars, active });
            if (d) save.mutate(d);
          }}
        >
          <Save aria-hidden />
          {save.isPending ? t("saving") : t("save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("purposeField")} error={checks.error("purpose")} hint={t("purposeHint")} className="sm:col-span-2">
          {(a) => (
            <Select
              {...a}
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value);
                checks.clear("purpose");
              }}
            >
              <option value="">{t("noPurpose")}</option>
              {WA_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t(`purpose.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {vars.map((v, i) => (
          <Field key={i} label={t("valueFor", { n: `{{${i + 1}}}` })} error={checks.error(`variable_map.${i}`)}>
            {(a) => (
              <Select
                {...a}
                value={v}
                onChange={(e) => {
                  setVars((list) => list.map((x, j) => (j === i ? e.target.value : x)));
                  checks.clear(`variable_map.${i}`);
                }}
              >
                <option value="">{t("chooseValue")}</option>
                {WA_VARS.map((k) => (
                  <option key={k} value={k}>
                    {t(`var.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
        <Checkbox label={t("activeField")} hint={t("activeHint")} checked={active} onChange={(e) => setActive(e.target.checked)} className="sm:col-span-2" />
      </div>
    </DialogContent>
  );
}
