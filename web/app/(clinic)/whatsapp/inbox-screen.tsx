"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { CheckCheck, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatDate, formatTime } from "@pearl/shared";
import { WhatsAppPanel } from "@/components/whatsapp/whatsapp-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox, PageHeader } from "@/components/ui/form";
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section aria-label={t("conversations")} className="flex flex-col gap-2">
          <Checkbox label={t("unreadOnly")} checked={unreadOnly} onChange={(e) => go({ unread: e.target.checked ? "1" : null })} />
          {inbox.isPending && <p className="text-text-secondary">{t("loading")}</p>}
          {inbox.isSuccess && items.length === 0 && <p className="text-text-secondary">{unreadOnly ? t("noUnread") : t("empty")}</p>}
          <ul className="flex flex-col gap-1">
            {items.map((c) => (
              <li key={c.phone_e164}>
                <button
                  type="button"
                  aria-current={c.phone_e164 === selected ? "true" : undefined}
                  onClick={() => go({ c: c.phone_e164 })}
                  className={cn(
                    "flex min-h-16 w-full flex-col gap-0.5 rounded-xl border border-border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2",
                    c.phone_e164 === selected && "bg-secondary",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name ?? c.phone_e164}</span>
                    <span className="shrink-0 text-[0.85rem] text-text-secondary tabular-nums">{when(c.last_message_at)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[0.95rem] text-text-secondary">
                    {c.last_direction === "outbound" && <CheckCheck aria-hidden className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{c.last_preview || "—"}</span>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-primary px-2 text-[0.85rem] font-semibold text-primary-foreground tabular-nums">
                        {t("unread", { n: c.unread_count })}
                      </span>
                    )}
                  </span>
                  <span className="text-[0.85rem] text-text-secondary">
                    {c.patient_id ? t("patient", { uhid: c.uhid ?? "" }) : c.lead_id ? t("lead", { n: c.sl_no ?? 0 }) : t("unknown")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {inbox.hasNextPage && (
            <Button variant="secondary" className="self-start" disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
              {t("more")}
            </Button>
          )}
        </section>

        <section aria-label={t("chat")}>
          {!current ? (
            <Card className="flex flex-col items-center gap-2 py-10 text-center">
              <MessageCircle aria-hidden className="size-8 text-text-secondary" />
              <CardDescription>{t("pick")}</CardDescription>
            </Card>
          ) : current.patient_id || current.lead_id ? (
            <div className="flex flex-col gap-2">
              <Link
                href={current.patient_id ? `/patients/${current.patient_id}` : `/leads/${current.lead_id}`}
                className="self-start text-link underline-offset-4 hover:underline"
              >
                {current.patient_id ? t("openPatient") : t("openLead")}
              </Link>
              <WhatsAppPanel
                key={current.phone_e164}
                patientId={current.patient_id ?? undefined}
                leadId={current.patient_id ? undefined : (current.lead_id ?? undefined)}
                canDrip={canDrip}
              />
            </div>
          ) : (
            <Card className="flex flex-col gap-3">
              <CardTitle>{current.phone_e164}</CardTitle>
              <CardDescription>{t("unknownHint")}</CardDescription>
              {current.last_preview && <p className="rounded-xl border border-border p-3 whitespace-pre-wrap">{current.last_preview}</p>}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <a href={`tel:${current.phone_e164}`}>
                    <Phone aria-hidden />
                    {t("call")}
                  </a>
                </Button>
                {(me?.role === "receptionist" || me?.role === "admin") && (
                  <Button asChild variant="secondary">
                    <Link href="/patients/new">{t("register")}</Link>
                  </Button>
                )}
                {(me?.role === "sales_manager" || me?.role === "admin") && (
                  <Button asChild variant="secondary">
                    <Link href="/leads?new=1">{t("addLead")}</Link>
                  </Button>
                )}
              </div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
