"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, FileUser, MessageCircle, Phone, Search, Target, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatTime } from "@pearl/shared";
import { ChatAvatar } from "@/components/whatsapp/chat-avatar";
import { WhatsAppPanel } from "@/components/whatsapp/whatsapp-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { RowSkeletons } from "@/components/ui/skeletons";
import { useLiveWhatsApp } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";

interface Conversation {
  phone_e164: string;
  patient_id: string | null;
  lead_id: string | null;
  name: string | null;
  uhid: string | null;
  sl_no: number | null;
  last_message_at: string;
  last_preview: string | null;
  last_direction: "outbound" | "inbound";
  last_status: string;
  unread_count: number;
}

/** Today → time; earlier → date. */
function when(at: string): string {
  const d = new Date(at);
  return formatDate(d) === formatDate(new Date()) ? formatTime(d) : formatDate(d);
}

/**
 * WhatsApp inbox for the team: every conversation this person may see, newest first, with
 * unread replies marked; choosing one opens the chat beside the list. Updates live.
 */
export function InboxScreen() {
  const t = useTranslations("waInbox");
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const unreadOnly = params.get("unread") === "1";
  const selected = params.get("c");
  const inbox = useInfiniteQuery({
    queryKey: ["wa_inbox", unreadOnly],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: Conversation[]; next_cursor: string | null }>("wa_inbox", { p_unread_only: unreadOnly, p_cursor: pageParam, p_limit: 30 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  useLiveWhatsApp(null, [["wa_inbox"]]);
  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  const current = items.find((c) => c.phone_e164 === selected) ?? null;
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const canDrip = current?.patient_id ? me?.role === "receptionist" || me?.role === "admin" : me?.role === "sales_manager" || me?.role === "admin";

  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  // Search filters the conversations already loaded (name, number, UHID).
  const shown = needle
    ? items.filter((c) => [c.name, c.phone_e164, c.uhid].some((v) => v?.toLowerCase().includes(needle)))
    : items;
  const kindLine = (c: Conversation) =>
    c.patient_id ? t("patient", { uhid: c.uhid ?? "" }) : c.lead_id ? t("lead", { n: c.sl_no ?? 0 }) : t("unknown");

  // WhatsApp Web: the page is exactly the workspace's height; only the list and the messages scroll.
  // Phone width: the list, or (once one is chosen) the chat with a back arrow.
  return (
    <div className="-mx-4 -mt-3 -mb-8 flex h-[calc(100dvh-3.5rem)] min-h-[30rem] overflow-hidden border-t border-border md:-mx-6 lg:mx-0 lg:mt-0 lg:mb-0 lg:h-[calc(100dvh-3.5rem-2.75rem)] lg:rounded-2xl lg:border">
      <section
        aria-label={t("conversations")}
        className={cn("flex w-full min-w-0 flex-col border-border bg-card lg:w-[22rem] lg:shrink-0 lg:border-r", current && "hidden lg:flex")}
      >
        <div className="flex flex-col gap-2 border-b border-border px-3 pt-3 pb-2.5">
          <div className="flex items-center gap-2">
            <h1 className="mr-auto text-[1.35rem] font-semibold tracking-tight" title={t("description")}>
              {t("title")}
            </h1>
            <button
              type="button"
              aria-pressed={unreadOnly}
              onClick={() => go({ unread: unreadOnly ? null : "1" })}
              className={cn(
                "min-h-8 rounded-full border px-3 text-[0.9rem] font-medium",
                unreadOnly ? "chat-unread border-transparent text-foreground" : "border-border text-text-secondary hover:bg-accent hover:text-foreground",
              )}
            >
              {t("unreadFilter")}
            </button>
          </div>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="rounded-full bg-secondary pl-9" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {inbox.isPending && (
            <div className="p-3">
              <RowSkeletons rows={4} />
            </div>
          )}
          {inbox.isSuccess && items.length === 0 && <p className="p-4 text-text-secondary">{unreadOnly ? t("noUnread") : t("empty")}</p>}
          {items.length > 0 && shown.length === 0 && <p className="p-4 text-text-secondary">{t("noMatch")}</p>}
          <ul className="flex flex-col">
            {shown.map((c) => {
              const unread = c.unread_count > 0;
              const on = c.phone_e164 === selected;
              return (
                <li key={c.phone_e164} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => go({ c: c.phone_e164 })}
                    className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2", on && "bg-popover-accent")}
                  >
                    <ChatAvatar name={c.name ?? c.phone_e164} className="size-11" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate", unread ? "font-semibold" : "font-medium")}>{c.name ?? c.phone_e164}</span>
                        <span className={cn("shrink-0 text-[0.9rem] tabular-nums", unread ? "font-semibold text-foreground" : "text-text-secondary")}>
                          {when(c.last_message_at)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[0.95rem] text-text-secondary">
                        {c.last_direction === "outbound" && <CheckCheck aria-hidden className="size-4 shrink-0" />}
                        <span className={cn("min-w-0 flex-1 truncate", unread && "text-foreground")}>{c.last_preview || "—"}</span>
                        {unread && (
                          <span className="chat-unread inline-flex min-w-6 shrink-0 justify-center rounded-full px-1.5 text-[0.9rem] font-semibold text-foreground tabular-nums">
                            <span aria-hidden>{c.unread_count}</span>
                            <span className="sr-only">{t("unread", { n: c.unread_count })}</span>
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[0.9rem] text-text-secondary">{kindLine(c)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-center p-3 empty:hidden">
            <LoadMore hasMore={inbox.hasNextPage} loading={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
              {t("more")}
            </LoadMore>
          </div>
        </div>
      </section>

      <section aria-label={t("chat")} className={cn("min-w-0 flex-1 flex-col bg-card", current ? "flex" : "hidden lg:flex")}>
        {!current ? (
          <div className="chat-wall flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-secondary">
            <MessageCircle aria-hidden className="size-10" />
            <p className="text-lg font-medium">{t("pickShort")}</p>
            <p className="max-w-sm text-[0.95rem]">{t("pick")}</p>
          </div>
        ) : current.patient_id || current.lead_id ? (
          <WhatsAppPanel
            key={current.phone_e164}
            patientId={current.patient_id ?? undefined}
            leadId={current.patient_id ? undefined : (current.lead_id ?? undefined)}
            canDrip={canDrip}
            contact={{
              name: current.name ?? current.phone_e164,
              subtitle: [current.phone_e164, kindLine(current)].join(" · "),
              link: current.patient_id
                ? { href: `/patients/${current.patient_id}`, label: t("openPatient"), icon: <FileUser aria-hidden /> }
                : { href: `/leads/${current.lead_id}`, label: t("openLead"), icon: <Target aria-hidden /> },
              onBack: () => go({ c: null }),
            }}
          />
        ) : (
          <UnknownNumber c={current} onBack={() => go({ c: null })} />
        )}
      </section>
    </div>
  );
}

/** A number that is neither a patient nor a lead: who it is, and how to take them on. */
function UnknownNumber({ c, onBack }: { c: Conversation; onBack: () => void }) {
  const t = useTranslations("waInbox");
  const w = useTranslations("whatsapp");
  const me = useMe();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-16 items-center gap-2 border-b border-border px-2 py-2 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={w("backToChats")}>
          <ArrowLeft aria-hidden />
        </Button>
        <ChatAvatar name={c.phone_e164} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{c.phone_e164}</h2>
          <p className="truncate text-[0.9rem] text-text-secondary">{t("unknown")}</p>
        </div>
      </div>
      <div className="chat-wall flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="max-w-prose rounded-xl border border-border bg-card p-3 text-[0.95rem] text-text-secondary">{t("unknownHint")}</p>
        {c.last_preview && (
          <p className="chat-in max-w-[85%] self-start rounded-2xl rounded-tl-sm border border-border px-3 py-2 whitespace-pre-wrap shadow-sm">{c.last_preview}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2.5 sm:px-4">
        <Button asChild variant="secondary">
          <a href={`tel:${c.phone_e164}`}>
            <Phone aria-hidden />
            {t("call")}
          </a>
        </Button>
        {(me?.role === "receptionist" || me?.role === "admin") && (
          <Button asChild variant="secondary">
            <Link href="/patients/new">
              <UserPlus aria-hidden />
              {t("register")}
            </Link>
          </Button>
        )}
        {(me?.role === "sales_manager" || me?.role === "admin") && (
          <Button asChild variant="secondary">
            <Link href="/leads?new=1">
              <Target aria-hidden />
              {t("addLead")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
