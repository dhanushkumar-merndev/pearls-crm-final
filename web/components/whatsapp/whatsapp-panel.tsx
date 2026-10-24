"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Check, CheckCheck, CircleAlert, Clock, ExternalLink, Hand, Pause, Play, Plus, Send, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatDateTime, formatTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { callFunction, newId, rpc, unwrap } from "@/lib/rpc";
import { dripEnrollSchema, waTemplateSendSchema, waTextSchema } from "@/lib/schemas/whatsapp";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { useLiveWhatsApp } from "@/lib/realtime";
import { waLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

interface WaMessage {
  id: string;
  direction: "outbound" | "inbound";
  kind: string;
  body: string | null;
  vars: string[];
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "received" | "manual";
  status_at: string;
  error_text: string | null;
  created_at: string;
  template: string | null;
  sent_by_name: string | null;
  action: string | null;
}

interface WaThread {
  phone_e164: string | null;
  wa_mode: string | null;
  enabled: boolean;
  opted_out: boolean;
  window_open_until: string | null;
  items: WaMessage[];
  next_cursor: string | null;
}

interface WaTemplate {
  id: string;
  name: string;
  body_text: string | null;
  category: string;
}

interface Enrollment {
  id: string;
  campaign: string;
  status: "active" | "paused" | "completed" | "stopped";
  next_send_at: string | null;
  stopped_reason: string | null;
  sent: number;
  steps: number;
}

/** A template's text with its {{n}} filled in (what the person saw). */
export function fillTemplate(body: string | null, vars: string[]): string {
  return (body ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => vars[Number(n) - 1] ?? all);
}

const STATUS_ICON = { queued: Clock, sent: Check, delivered: CheckCheck, read: CheckCheck, failed: CircleAlert, manual: Hand, received: Check };

/**
 * WhatsApp with one patient or lead: the conversation (newest at the bottom), sending an
 * approved template or — within 24 hours of their last message — free text, the manual
 * wa.me fallback when the Cloud API is off, opt-out, and drip campaigns (`canDrip`).
 */
export function WhatsAppPanel({ patientId, leadId, canDrip }: { patientId?: string; leadId?: string; canDrip: boolean }) {
  const t = useTranslations("whatsapp");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const key = ["wa_thread", patientId ?? null, leadId ?? null];
  const thread = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<WaThread>("wa_thread", { p_patient_id: patientId ?? null, p_lead_id: leadId ?? null, p_cursor: pageParam, p_limit: 30 }),
    getNextPageParam: (last) => last.next_cursor,
    // Live updates come through useLiveWhatsApp; this is only a safety net.
    refetchInterval: 120_000,
  });
  const head = thread.data?.pages[0];
  const items = (thread.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  useLiveWhatsApp(head?.phone_e164 ?? undefined, [key, ["drip_enrollments"]], !!head?.phone_e164);
  // Like a chat: keep the newest message in view when one arrives.
  const listRef = useRef<HTMLOListElement>(null);
  const newestId = items.at(-1)?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);
  // Open = read for the team: clears the unread count in the inbox and the menu badge.
  const newestInbound = items.findLast((m) => m.direction === "inbound")?.id;
  useEffect(() => {
    if (!newestInbound) return;
    void rpc<number>("wa_mark_read", { p_patient_id: patientId ?? null, p_lead_id: leadId ?? null })
      .then((n) => {
        if (n > 0) {
          void queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
          void queryClient.invalidateQueries({ queryKey: ["wa_inbox"] });
        }
      })
      .catch(() => undefined);
  }, [newestInbound, patientId, leadId, queryClient]);

  const optOut = useMutation({
    mutationFn: (out: boolean) => rpc("wa_set_opt_out", { p_patient_id: patientId ?? null, p_lead_id: leadId ?? null, p_out: out }),
    onSuccess: (_, out) => {
      saved(out ? t("optedOutSaved") : t("optedInSaved"));
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["drip_enrollments"] });
    },
    onError: failed,
  });

  if (thread.isPending) return <p className="text-text-secondary">{t("loading")}</p>;
  if (thread.isError || !head) return <p className="text-text-secondary">{t("cantLoad")}</p>;
  const api = head.enabled && head.wa_mode !== "manual";
  const windowOpen = !!head.window_open_until && new Date(head.window_open_until) > new Date();

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{t("title")}</CardTitle>
          {head.opted_out ? (
            <StatusBadge kind="critical" label={t("optedOut")} />
          ) : !api ? (
            <StatusBadge kind="serious" label={head.enabled ? t("manualNumber") : t("apiOff")} />
          ) : windowOpen ? (
            <StatusBadge kind="good" label={t("windowOpen", { time: formatTime(new Date(head.window_open_until!)) })} />
          ) : (
            <StatusBadge kind="warning" label={t("templatesOnly")} />
          )}
        </div>
        {!head.phone_e164 ? (
          <CardDescription>{t("noPhone")}</CardDescription>
        ) : (
          <>
            <ol ref={listRef} aria-live="polite" aria-label={t("conversation")} className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto rounded-xl border border-border p-3">
              {thread.hasNextPage && (
                <li className="self-center">
                  <Button variant="ghost" disabled={thread.isFetchingNextPage} onClick={() => void thread.fetchNextPage()}>
                    {t("older")}
                  </Button>
                </li>
              )}
              {items.length === 0 && <li className="text-text-secondary">{t("empty")}</li>}
              {items.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
            </ol>
            {head.opted_out ? (
              <div className="flex flex-wrap items-center gap-3">
                <CardDescription className="flex-1">{t("optedOutHint")}</CardDescription>
                <Button variant="secondary" disabled={optOut.isPending} onClick={() => optOut.mutate(false)}>
                  <BellRing aria-hidden />
                  {t("optIn")}
                </Button>
              </div>
            ) : api ? (
              <ApiComposer patientId={patientId} leadId={leadId} windowOpen={windowOpen} onSent={refresh} />
            ) : (
              <ManualComposer patientId={patientId} leadId={leadId} phone={head.phone_e164} enabled={head.enabled} onSent={refresh} />
            )}
            {!head.opted_out && (
              <Button variant="ghost" className="self-start" disabled={optOut.isPending} onClick={() => optOut.mutate(true)}>
                <BellOff aria-hidden />
                {t("optOut")}
              </Button>
            )}
          </>
        )}
      </Card>
      {canDrip && head.phone_e164 && <Drips patientId={patientId} leadId={leadId} />}
    </div>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const t = useTranslations("whatsapp");
  const Icon = STATUS_ICON[m.status];
  const out = m.direction === "outbound";
  const text = m.kind === "template" ? fillTemplate(m.body, m.vars) : (m.body ?? "");
  return (
    <li className={cn("flex max-w-[85%] flex-col gap-1 rounded-2xl border border-border px-3 py-2", out ? "self-end bg-secondary" : "self-start bg-background")}>
      {m.template && <span className="text-[0.85rem] text-text-secondary">{t("template", { name: m.template })}</span>}
      <p className="whitespace-pre-wrap break-words">{text || "—"}</p>
      <span className="flex flex-wrap items-center gap-x-2 text-[0.85rem] text-text-secondary">
        <span>{formatDateTime(new Date(m.created_at))}</span>
        {m.sent_by_name && <span>{m.sent_by_name}</span>}
        {out && (
          <span className={cn("inline-flex items-center gap-1", m.status === "failed" && "text-bad-text", m.status === "read" && "text-link")}>
            <Icon aria-hidden className="size-4" />
            {t(`status.${m.status}`)}
          </span>
        )}
        {m.action && <span className="font-medium text-foreground">{t(`action.${m.action}`)}</span>}
      </span>
      {m.status === "failed" && m.error_text && <span className="text-[0.85rem] text-bad-text">{m.error_text}</span>}
    </li>
  );
}

function ApiComposer({ patientId, leadId, windowOpen, onSent }: { patientId?: string; leadId?: string; windowOpen: boolean; onSent: () => void }) {
  const t = useTranslations("whatsapp");
  const { saved, failed } = useFeedback();
  const [mode, setMode] = useState<"template" | "text">(windowOpen ? "text" : "template");
  const [templateId, setTemplateId] = useState("");
  const [text, setText] = useState("");
  // One id per message being written: a retry after a network error can't send it twice.
  const [clientId, setClientId] = useState(newId);
  const templates = useQuery({
    queryKey: ["wa_templates", "usable"],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser().from("wa_templates").select("id, name, body_text, category").eq("active", true).eq("status", "APPROVED").order("name"),
      ) as WaTemplate[],
  });
  const tplChecks = useZodForm(waTemplateSendSchema);
  const textChecks = useZodForm(waTextSchema);
  const picked = templates.data?.find((x) => x.id === templateId);
  const send = useMutation({
    mutationFn: (p: { template_id?: string; text?: string }) =>
      rpc("wa_send", { p: { patient_id: patientId ?? null, lead_id: leadId ?? null, ...p }, p_client_id: clientId }),
    onSuccess: () => {
      saved(t("queued"));
      setText("");
      setTemplateId("");
      setClientId(newId());
      // Send now instead of waiting for the 5-minute run; if this fails, that run sends it.
      void callFunction("wa-dispatch", { source: "staff" }).catch(() => undefined).finally(onSent);
      onSent();
    },
    onError: failed,
  });
  const effective = windowOpen ? mode : "template";
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t("sendAs")} className="flex flex-wrap gap-2">
        <Button role="radio" aria-checked={effective === "template"} variant={effective === "template" ? "primary" : "secondary"} onClick={() => setMode("template")}>
          {t("useTemplate")}
        </Button>
        <Button
          role="radio"
          aria-checked={effective === "text"}
          variant={effective === "text" ? "primary" : "secondary"}
          disabled={!windowOpen}
          onClick={() => setMode("text")}
        >
          {t("useText")}
        </Button>
      </div>
      {!windowOpen && <CardDescription>{t("windowClosedHint")}</CardDescription>}
      {effective === "template" ? (
        <>
          <Field label={t("templateField")} error={tplChecks.error("template_id")} hint={templates.data?.length === 0 ? t("noTemplates") : undefined}>
            {(a) => (
              <Select
                {...a}
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  tplChecks.clear("template_id");
                }}
              >
                <option value="">{t("chooseTemplate")}</option>
                {(templates.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {picked?.body_text && <p className="rounded-xl border border-border p-3 whitespace-pre-wrap text-text-secondary">{picked.body_text}</p>}
          <Button
            className="self-start"
            disabled={send.isPending}
            onClick={() => {
              const d = tplChecks.validate({ template_id: templateId });
              if (d) send.mutate(d);
            }}
          >
            <Send aria-hidden />
            {send.isPending ? t("sending") : t("send")}
          </Button>
        </>
      ) : (
        <>
          <Field label={t("message")} error={textChecks.error("text")}>
            {(a) => (
              <Textarea
                {...a}
                rows={3}
                maxLength={4096}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  textChecks.clear("text");
                }}
              />
            )}
          </Field>
          <Button
            className="self-start"
            disabled={send.isPending}
            onClick={() => {
              const d = textChecks.validate({ text });
              if (d) send.mutate(d);
            }}
          >
            <Send aria-hidden />
            {send.isPending ? t("sending") : t("send")}
          </Button>
        </>
      )}
    </div>
  );
}

function ManualComposer({ patientId, leadId, phone, enabled, onSent }: { patientId?: string; leadId?: string; phone: string; enabled: boolean; onSent: () => void }) {
  const t = useTranslations("whatsapp");
  const { failed } = useFeedback();
  const [text, setText] = useState("");
  const checks = useZodForm(waTextSchema);
  const log = useMutation({
    mutationFn: (d: { text: string }) => rpc<{ phone_e164: string; text: string }>("wa_prepare_manual", { p: { patient_id: patientId ?? null, lead_id: leadId ?? null, text: d.text } }),
    onError: failed,
  });
  return (
    <div className="flex flex-col gap-3">
      <CardDescription>{enabled ? t("manualNumberHint") : t("apiOffHint")}</CardDescription>
      <Field label={t("message")} error={checks.error("text")}>
        {(a) => (
          <Textarea
            {...a}
            rows={3}
            maxLength={4096}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              checks.clear("text");
            }}
          />
        )}
      </Field>
      <Button
        className="self-start"
        disabled={log.isPending}
        onClick={() => {
          const d = checks.validate({ text });
          if (!d) return;
          // Opened now (a click) so the browser doesn't block it; filled once the message is logged.
          const tab = window.open("about:blank", "_blank");
          log.mutate(d, {
            onSuccess: (r) => {
              if (tab) tab.location.href = waLink(r.phone_e164 || phone, r.text);
              setText("");
              onSent();
            },
            onError: () => tab?.close(),
          });
        }}
      >
        <ExternalLink aria-hidden />
        {t("openWhatsApp")}
      </Button>
    </div>
  );
}

function Drips({ patientId, leadId }: { patientId?: string; leadId?: string }) {
  const t = useTranslations("whatsapp");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [adding, setAdding] = useState(false);
  const enrollments = useQuery({
    queryKey: ["drip_enrollments", patientId ?? null, leadId ?? null],
    queryFn: () => rpc<Enrollment[]>("drip_enrollments_for", { p_patient_id: patientId ?? null, p_lead_id: leadId ?? null }),
  });
  const setStatus = useMutation({
    mutationFn: (p: { id: string; status: "active" | "paused" | "stopped" }) => rpc("drip_set_status", { p_enrollment_id: p.id, p_status: p.status }),
    onSuccess: () => {
      saved();
      void queryClient.invalidateQueries({ queryKey: ["drip_enrollments"] });
    },
    onError: failed,
  });
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">{t("drips")}</CardTitle>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t("addToDrip")}
        </Button>
      </div>
      {enrollments.data?.length === 0 && <CardDescription>{t("noDrips")}</CardDescription>}
      <ul className="flex flex-col gap-2">
        {(enrollments.data ?? []).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <span className="font-medium">{e.campaign}</span>
            <StatusBadge
              kind={e.status === "active" ? "good" : e.status === "paused" ? "warning" : e.status === "completed" ? "good" : "serious"}
              label={t(`dripStatus.${e.status}`)}
            />
            <span className="text-text-secondary tabular-nums">{t("dripProgress", { sent: e.sent, steps: e.steps })}</span>
            {e.status === "active" && e.next_send_at && (
              <span className="text-text-secondary">{t("dripNext", { at: formatDateTime(new Date(e.next_send_at)) })}</span>
            )}
            {e.stopped_reason && <span className="text-text-secondary">{e.stopped_reason}</span>}
            <span className="ml-auto flex gap-1">
              {e.status === "active" && (
                <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: e.id, status: "paused" })}>
                  <Pause aria-hidden />
                  {t("pause")}
                </Button>
              )}
              {e.status === "paused" && (
                <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: e.id, status: "active" })}>
                  <Play aria-hidden />
                  {t("resume")}
                </Button>
              )}
              {(e.status === "active" || e.status === "paused") && (
                <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: e.id, status: "stopped" })}>
                  <Square aria-hidden />
                  {t("stop")}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <EnrollDialog
            patientId={patientId}
            leadId={leadId}
            onDone={() => {
              setAdding(false);
              void queryClient.invalidateQueries({ queryKey: ["drip_enrollments"] });
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function EnrollDialog({ patientId, leadId, onDone }: { patientId?: string; leadId?: string; onDone: () => void }) {
  const t = useTranslations("whatsapp");
  const { saved, failed } = useFeedback();
  const [campaignId, setCampaignId] = useState("");
  const checks = useZodForm(dripEnrollSchema);
  const campaigns = useQuery({
    queryKey: ["drip_campaigns"],
    queryFn: () => rpc<{ id: string; name: string; audience: string; active: boolean; steps: unknown[] }[]>("drip_campaigns_list"),
  });
  const audience = patientId ? "patient" : "lead";
  const usable = (campaigns.data ?? []).filter((c) => c.active && c.audience === audience && c.steps.length > 0);
  const enroll = useMutation({
    mutationFn: (d: { campaign_id: string }) => rpc("drip_enroll", { p_campaign_id: d.campaign_id, p_patient_id: patientId ?? null, p_lead_id: leadId ?? null }),
    onSuccess: () => {
      saved(t("enrolled"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("addToDrip")}
      description={t("addToDripHint")}
      footer={
        <Button
          disabled={enroll.isPending}
          onClick={() => {
            const d = checks.validate({ campaign_id: campaignId });
            if (d) enroll.mutate(d);
          }}
        >
          <Plus aria-hidden />
          {t("enroll")}
        </Button>
      }
    >
      <Field label={t("campaign")} error={checks.error("campaign_id")} hint={campaigns.isSuccess && usable.length === 0 ? t("noCampaigns") : undefined}>
        {(a) => (
          <Select
            {...a}
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              checks.clear("campaign_id");
            }}
          >
            <option value="">{t("chooseCampaign")}</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </DialogContent>
  );
}
