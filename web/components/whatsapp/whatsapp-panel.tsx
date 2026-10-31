"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  EllipsisVertical,
  Hand,
  MoonStar,
  ListChecks,
  Pause,
  Play,
  Plus,
  Send,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { formatDate, formatDateTime, formatTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, Select, Textarea } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { callFunction, newId, rpc, unwrap } from "@/lib/rpc";
import { dripEnrollSchema, waTemplateSendSchema, waTextSchema } from "@/lib/schemas/whatsapp";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { useLiveWhatsApp } from "@/lib/realtime";
import { waLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./chat-avatar";
import { DndBadge, DndDialog, useDnd, type ChatTarget } from "./dnd";

export interface WaMessage {
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
  param_count: number;
  variable_map: string[];
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
// Statuses worth words in the bubble; the rest are a tick (with the word for screen readers).
const STATUS_IN_WORDS = new Set(["queued", "failed", "manual"]);

/**
 * Meta's 24-hour window: open until `until`; flips to closed by itself when the time passes, so
 * the composer offers templates only without a reload.
 */
export function useWindowOpen(until: string | null | undefined): boolean {
  const end = until ? new Date(until).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const left = end - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(left + 500, 2_147_483_647));
    return () => clearTimeout(id);
  }, [end]);
  return end > now;
}

/** Can they get WhatsApp from the CRM now: stopped, off/manual, free reply until …, or templates only. */
export function ChatStateChip({ optedOut, api, enabled, windowOpen, until }: {
  optedOut: boolean;
  api: boolean;
  enabled: boolean;
  windowOpen: boolean;
  until: string | null;
}) {
  const t = useTranslations("whatsapp");
  if (optedOut) return <StatusBadge kind="critical" label={t("optedOut")} />;
  if (!api) return <StatusBadge kind="serious" label={enabled ? t("manualNumber") : t("apiOff")} />;
  if (windowOpen && until) {
    const end = new Date(until);
    const time = formatDate(end) === formatDate(new Date()) ? formatTime(end) : formatDateTime(end);
    return <StatusBadge kind="good" label={t("windowOpen", { time })} />;
  }
  return <StatusBadge kind="warning" label={t("templatesOnly")} />;
}

/** The person the chat is with, for the inbox's chat header (avatar, name, link to their page). */
export interface ChatContact {
  name: string;
  subtitle?: string;
  link?: { href: string; label: string; icon: ReactNode };
  /** Phone width: back to the list. */
  onBack?: () => void;
}

/** "Today" / "Yesterday" / DD/MM/YYYY for the pill between days. */
function useDayLabel() {
  const t = useTranslations("whatsapp");
  return (d: Date) => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const key = formatDate(d);
    return key === formatDate(today) ? t("today") : key === formatDate(yesterday) ? t("yesterday") : key;
  };
}

/**
 * WhatsApp with one patient or lead, laid out like WhatsApp Web: chat header, the conversation
 * (newest at the bottom, a pill between days), and the composer pinned at the bottom. Sending an
 * approved template or — within 24 hours of their last message — free text, the manual wa.me
 * fallback when the Cloud API is off, opt-out, and drip campaigns (`canDrip`).
 * With `contact` (the inbox) it fills its box; without (patient file, lead page) it is a card.
 */
export function WhatsAppPanel({ patientId, leadId, canDrip, contact }: { patientId?: string; leadId?: string; canDrip: boolean; contact?: ChatContact }) {
  const t = useTranslations("whatsapp");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [dripDialog, setDripDialog] = useState<"list" | "enroll" | null>(null);
  const [dndOpen, setDndOpen] = useState(false);
  const target: ChatTarget = { patientId, leadId };
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
  const windowOpen = useWindowOpen(head?.window_open_until);
  const dnd = useDnd(target, !!head?.phone_e164);
  const items = (thread.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  useLiveWhatsApp(head?.phone_e164 ?? undefined, [key, ["drip_enrollments"]], !!head?.phone_e164);
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

  const inbox = !!contact;
  if (thread.isPending) return <div className={inbox ? "p-4" : undefined}><RowSkeletons rows={3} /></div>;
  if (thread.isError || !head) return <p className={cn("text-text-secondary", inbox && "p-4")}>{t("cantLoad")}</p>;
  const api = head.enabled && head.wa_mode !== "manual";
  const drips = canDrip && !!head.phone_e164;

  const chip = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ChatStateChip optedOut={head.opted_out} api={api} enabled={head.enabled} windowOpen={windowOpen} until={head.window_open_until} />
      <DndBadge dnd={dnd.data} />
    </span>
  );

  // The ⋮ menu: what WhatsApp Web keeps there too (campaigns in the inbox, stop messages).
  const showMenu = (inbox && drips) || !!head.phone_e164;
  const menu = showMenu && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("chatOptions")}>
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {inbox && drips && (
          <>
            <DropdownMenuItem onSelect={() => setDripDialog("enroll")}>
              <Plus aria-hidden />
              {t("addToDrip")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDripDialog("list")}>
              <ListChecks aria-hidden />
              {t("drips")}
            </DropdownMenuItem>
          </>
        )}
        {head.phone_e164 && (
          <DropdownMenuItem onSelect={() => setDndOpen(true)}>
            <MoonStar aria-hidden />
            {t("dnd.menu")}
          </DropdownMenuItem>
        )}
        {!head.opted_out && head.phone_e164 && (
          <DropdownMenuItem disabled={optOut.isPending} onSelect={() => optOut.mutate(true)}>
            <BellOff aria-hidden />
            {t("optOut")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const header = inbox ? (
    <div className="flex min-h-16 items-center gap-2 border-b border-border px-2 py-2 sm:px-4">
      {contact.onBack && (
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={contact.onBack} aria-label={t("backToChats")}>
          <ArrowLeft aria-hidden />
        </Button>
      )}
      <ChatAvatar name={contact.name} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold">{contact.name}</h2>
        {contact.subtitle && <p className="truncate text-[0.9rem] text-text-secondary">{contact.subtitle}</p>}
      </div>
      <span className="hidden md:inline-flex">{chip}</span>
      {contact.link && (
        <Tooltip label={contact.link.label} side="bottom">
          <Button asChild variant="ghost" size="icon">
            <Link href={contact.link.href} aria-label={contact.link.label}>
              {contact.link.icon}
            </Link>
          </Button>
        </Tooltip>
      )}
      {menu}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <CardTitle className="mr-auto">{t("title")}</CardTitle>
      {chip}
      {menu}
    </div>
  );

  const body = !head.phone_e164 ? (
    <p className="chat-wall flex-1 p-4 text-text-secondary">{t("noPhone")}</p>
  ) : (
    <>
      {/* The chip moves under the header on a phone-width inbox (no room beside the name). */}
      {inbox && <div className="border-b border-border px-4 py-1.5 md:hidden">{chip}</div>}
      <ChatMessages
        items={items}
        hasMore={thread.hasNextPage}
        loadingMore={thread.isFetchingNextPage}
        onMore={() => void thread.fetchNextPage()}
        className={inbox ? "min-h-0 flex-1" : "h-[24rem] max-h-[60dvh]"}
      />
      <div className="border-t border-border bg-card px-3 py-2.5 sm:px-4">
        {head.opted_out ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[0.95rem] text-text-secondary">{t("optedOutHint")}</p>
            <Button variant="secondary" disabled={optOut.isPending} onClick={() => optOut.mutate(false)}>
              <BellRing aria-hidden />
              {t("optIn")}
            </Button>
          </div>
        ) : api ? (
          <ApiComposer target={target} windowOpen={windowOpen} onSent={refresh} />
        ) : (
          <ManualComposer patientId={patientId} leadId={leadId} phone={head.phone_e164} enabled={head.enabled} onSent={refresh} />
        )}
      </div>
    </>
  );

  return (
    <>
      {inbox ? (
        <div className="flex h-full min-h-0 flex-col">
          {header}
          {body}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col overflow-hidden p-0 sm:p-0">
            {header}
            {body}
          </Card>
          {drips && <Drips patientId={patientId} leadId={leadId} />}
        </div>
      )}
      <Dialog open={dndOpen} onOpenChange={setDndOpen}>
        {dndOpen && <DndDialog target={target} current={dnd.data} onDone={() => setDndOpen(false)} />}
      </Dialog>
      {inbox && drips && (
        <Dialog open={dripDialog !== null} onOpenChange={(o) => !o && setDripDialog(null)}>
          {dripDialog === "list" && (
            <DialogContent
              title={t("drips")}
              footer={
                <Button variant="secondary" onClick={() => setDripDialog("enroll")}>
                  <Plus aria-hidden />
                  {t("addToDrip")}
                </Button>
              }
            >
              <DripList patientId={patientId} leadId={leadId} />
            </DialogContent>
          )}
          {dripDialog === "enroll" && (
            <EnrollDialog
              patientId={patientId}
              leadId={leadId}
              onDone={() => {
                setDripDialog(null);
                void queryClient.invalidateQueries({ queryKey: ["drip_enrollments"] });
              }}
            />
          )}
        </Dialog>
      )}
    </>
  );
}

/**
 * The conversation, oldest first: a day line between days, our messages (staff, bot, automatic)
 * on the right, theirs on the left; keeps the newest in view when one arrives.
 */
export function ChatMessages({ items, hasMore, loadingMore, onMore, className }: {
  items: WaMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  className?: string;
}) {
  const t = useTranslations("whatsapp");
  const dayLabel = useDayLabel();
  const listRef = useRef<HTMLOListElement>(null);
  const newestId = items.at(-1)?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);
  return (
    <ol
      ref={listRef}
      aria-live="polite"
      aria-label={t("conversation")}
      className={cn("chat-wall flex flex-col gap-1 overflow-y-auto px-3 py-2 sm:px-6", className)}
    >
      {hasMore && (
        <li className="self-center pb-2">
          <LoadMore hasMore loading={loadingMore} onClick={onMore}>
            {t("older")}
          </LoadMore>
        </li>
      )}
      {items.length === 0 && <li className="m-auto rounded-full bg-card px-4 py-1.5 text-text-secondary">{t("empty")}</li>}
      {items.map((m, i) => {
        const d = new Date(m.created_at);
        const newDay = i === 0 || formatDate(new Date(items[i - 1]!.created_at)) !== formatDate(d);
        return (
          <Fragment key={m.id}>
            {newDay && (
              <li className="my-1 self-center rounded-md border border-border bg-card px-2.5 py-0.5 text-[0.85rem] text-text-secondary shadow-sm">
                {dayLabel(d)}
              </li>
            )}
            <Bubble m={m} />
          </Fragment>
        );
      })}
    </ol>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const t = useTranslations("whatsapp");
  const Icon = STATUS_ICON[m.status];
  const out = m.direction === "outbound";
  const text = m.kind === "template" ? fillTemplate(m.body, m.vars) : (m.body ?? "");
  const at = new Date(m.created_at);
  const meta = (
    <>
      {m.action && <span className="font-medium text-foreground">{t(`action.${m.action}`)}</span>}
      {m.sent_by_name && <span>{m.sent_by_name}</span>}
      <time dateTime={m.created_at} title={formatDateTime(at)} className="tabular-nums">
        {formatTime(at)}
      </time>
      {out && (
        <span className={cn("inline-flex items-center gap-1", m.status === "failed" && "text-bad-text", m.status === "read" && "text-link")}>
          <Icon aria-hidden className="size-4" />
          {STATUS_IN_WORDS.has(m.status) ? t(`status.${m.status}`) : <span className="sr-only">{t(`status.${m.status}`)}</span>}
        </span>
      )}
    </>
  );
  // Like WhatsApp: the time and ticks float at the end of the last line when there is room, else below it.
  return (
    <li
      className={cn(
        "flex max-w-[85%] flex-col rounded-lg px-2.5 py-1 shadow-sm sm:max-w-[70%]",
        out ? "chat-out self-end rounded-tr-none" : "chat-in self-start rounded-tl-none border border-border",
      )}
    >
      {m.template && <span className="text-[0.9rem] text-text-secondary">{t("template", { name: m.template })}</span>}
      <p className="flow-root whitespace-pre-wrap break-words">
        {text || "—"}
        <span className="float-right mt-1 ml-3 flex items-center gap-x-2 text-[0.85rem] leading-5 text-text-secondary">{meta}</span>
      </p>
      {m.status === "failed" && m.error_text && <span className="text-[0.9rem] text-bad-text">{m.error_text}</span>}
    </li>
  );
}

/** Enter sends (like WhatsApp Web); Shift+Enter starts a new line. */
function enterSends(send: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
}

const COMPOSER_TEXT = "min-h-10 max-h-36 resize-none rounded-3xl py-2 [field-sizing:content]";

/** The round send button at the end of the composer (icon; its name says what it does). */
function SendButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Tooltip label={label} side="top">
      <Button size="icon" className="shrink-0" aria-label={label} disabled={busy} onClick={onClick}>
        <Send aria-hidden />
      </Button>
    </Tooltip>
  );
}

/** Send through the API: a template, or free text inside the 24-hour window. */
export function ApiComposer({ target, windowOpen, onSent }: { target: ChatTarget; windowOpen: boolean; onSent: () => void }) {
  const t = useTranslations("whatsapp");
  const { failed } = useFeedback();
  const [mode, setMode] = useState<"template" | "text">(windowOpen ? "text" : "template");
  const [templateId, setTemplateId] = useState("");
  const [text, setText] = useState("");
  // One id per message being written: a retry after a network error can't send it twice.
  const [clientId, setClientId] = useState(newId);
  const templates = useQuery({
    queryKey: ["wa_templates", "usable"],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser().from("wa_templates").select("id, name, body_text, category, param_count, variable_map").eq("active", true).eq("status", "APPROVED").order("name"),
      ) as WaTemplate[],
  });
  const tplChecks = useZodForm(waTemplateSendSchema);
  const textChecks = useZodForm(waTextSchema);
  const picked = templates.data?.find((x) => x.id === templateId);
  const v = useTranslations("waAdmin.var");
  // The CRM fills {{1}}, {{2}}… itself from the template's values (Admin → WhatsApp → Edit); shown as [Clinic name].
  const valuesSet = !picked || (picked.variable_map ?? []).length === picked.param_count;
  const preview = picked?.body_text?.replace(/\{\{(\d+)\}\}/g, (all, n: string) => {
    const key = picked.variable_map?.[Number(n) - 1];
    return key ? `[${v(key as "name")}]` : all;
  });
  const send = useMutation({
    mutationFn: (p: { template_id?: string; text?: string }) =>
      target.phone
        ? rpc("wa_number_send", { p_phone: target.phone, p, p_client_id: clientId })
        : rpc("wa_send", { p: { patient_id: target.patientId ?? null, lead_id: target.leadId ?? null, ...p }, p_client_id: clientId }),
    // No toast: the message shows in the chat at once, with its ticks.
    onSuccess: () => {
      setText("");
      setTemplateId("");
      setClientId(newId());
      // Send now instead of waiting for the 5-minute run; if this fails, that run sends it (and staff are told).
      void callFunction("wa-dispatch", { source: "staff" }).catch(() => toast.info(t("sendLater"))).finally(onSent);
      onSent();
    },
    onError: failed,
  });
  const effective = windowOpen ? mode : "template";
  const sendTemplate = () => {
    const d = tplChecks.validate({ template_id: templateId });
    if (d) send.mutate(d);
  };
  const sendText = () => {
    const d = textChecks.validate({ text });
    if (d) send.mutate(d);
  };
  const seg = (on: boolean) =>
    cn("min-h-8 rounded-full px-3 text-[0.9rem] font-medium", on ? "bg-primary text-primary-foreground" : "text-text-secondary hover:bg-accent hover:text-foreground");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="radiogroup" aria-label={t("sendAs")} className="inline-flex gap-1 rounded-full border border-border p-0.5">
          <button type="button" role="radio" aria-checked={effective === "template"} className={seg(effective === "template")} onClick={() => setMode("template")}>
            {t("useTemplate")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={effective === "text"}
            className={cn(seg(effective === "text"), "disabled:opacity-50")}
            disabled={!windowOpen}
            onClick={() => setMode("text")}
          >
            {t("useText")}
          </button>
        </div>
        {!windowOpen && <p className="min-w-0 flex-1 text-[0.9rem] text-text-secondary">{t("windowClosedHint")}</p>}
      </div>
      {effective === "template" ? (
        <>
          {preview && <p className="rounded-xl border border-border p-2.5 whitespace-pre-wrap text-text-secondary">{preview}</p>}
          {!valuesSet && <p className="text-[0.9rem] text-bad-text">{t("templateValuesMissing")}</p>}
          <div className="flex items-start gap-2">
            <Field
              label={t("templateField")}
              labelClassName="sr-only"
              className="min-w-0 flex-1"
              error={tplChecks.error("template_id")}
              hint={templates.data?.length === 0 ? t("noTemplates") : undefined}
            >
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
            <SendButton label={send.isPending ? t("sending") : t("send")} busy={send.isPending || !valuesSet} onClick={sendTemplate} />
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <Field label={t("message")} labelClassName="sr-only" className="min-w-0 flex-1" error={textChecks.error("text")}>
            {(a) => (
              <Textarea
                {...a}
                rows={1}
                maxLength={4096}
                placeholder={t("typeMessage")}
                className={COMPOSER_TEXT}
                value={text}
                onKeyDown={enterSends(sendText)}
                onChange={(e) => {
                  setText(e.target.value);
                  textChecks.clear("text");
                }}
              />
            )}
          </Field>
          <SendButton label={send.isPending ? t("sending") : t("send")} busy={send.isPending} onClick={sendText} />
        </div>
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
  const submit = () => {
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
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.9rem] text-text-secondary">{enabled ? t("manualNumberHint") : t("apiOffHint")}</p>
      <div className="flex items-start gap-2">
        <Field label={t("message")} labelClassName="sr-only" className="min-w-0 flex-1" error={checks.error("text")}>
          {(a) => (
            <Textarea
              {...a}
              rows={1}
              maxLength={4096}
              placeholder={t("typeMessage")}
              className={COMPOSER_TEXT}
              value={text}
              onKeyDown={enterSends(submit)}
              onChange={(e) => {
                setText(e.target.value);
                checks.clear("text");
              }}
            />
          )}
        </Field>
        <SendButton label={t("openWhatsApp")} busy={log.isPending} onClick={submit} />
      </div>
    </div>
  );
}

function Drips({ patientId, leadId }: { patientId?: string; leadId?: string }) {
  const t = useTranslations("whatsapp");
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">{t("drips")}</CardTitle>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t("addToDrip")}
        </Button>
      </div>
      <DripList patientId={patientId} leadId={leadId} />
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

/** The campaigns this person is in, with pause / resume / stop. */
function DripList({ patientId, leadId }: { patientId?: string; leadId?: string }) {
  const t = useTranslations("whatsapp");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
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
    <div className="flex flex-col gap-2">
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
    </div>
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
