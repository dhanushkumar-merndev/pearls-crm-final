"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Pager } from "@/components/ui/pager";
import { RowSkeletons } from "@/components/ui/skeletons";
import { type Notification, markNotificationRead, NOTIFICATION_COLUMNS, NotificationText } from "@/components/notifications/notification-text";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useUrlParam } from "@/lib/use-url-param";
import { cn } from "@/lib/utils";

const PAGE = 30;
type Show = "all" | "unread";
const isShow = (v: string): v is Show => v === "all" || v === "unread";
const isOffset = (v: string): v is `${number}` => /^\d{1,6}$/.test(v);

/**
 * Every notification of the signed-in person, newest first (the bell shows only the newest 10).
 * Server-side offset pages of 30 with the total (the page number stays in the address, so Back returns to it);
 * RLS keeps it to their own. Opening one marks it read.
 */
export function NotificationsScreen() {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();
  const [show, setShow] = useUrlParam<Show>("show", "all", isShow);
  const [at, setAt] = useUrlParam<`${number}`>("from", "0", isOffset);
  const offset = Number(at);
  const [marking, setMarking] = useState(false);

  const list = useQuery({
    queryKey: ["notifications", "page", show, offset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = getSupabaseBrowser()
        .from("notifications")
        .select(NOTIFICATION_COLUMNS, { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (show === "unread") q = q.is("read_at", null);
      const { data, count, error } = await q;
      if (error) throw error;
      return { items: data as Notification[], total: count ?? 0 };
    },
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  // Past the end (e.g. after marking read on the Unread view): back to the last page there is.
  useEffect(() => {
    if (list.isSuccess && items.length === 0 && offset > 0) setAt(`${Math.max(0, Math.floor((total - 1) / PAGE) * PAGE)}`);
  }, [list.isSuccess, items.length, offset, total, setAt]);
  const anyUnread = items.some((n) => !n.read_at);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  async function markAllRead() {
    setMarking(true);
    try {
      await getSupabaseBrowser().rpc("mark_notifications_read", { p_ids: null });
      await refresh();
    } finally {
      setMarking(false);
    }
  }

  function opened(n: Notification) {
    if (!n.read_at) void markNotificationRead(n.id).then(refresh);
  }

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          anyUnread && (
            <Button variant="secondary" onClick={() => void markAllRead()} disabled={marking}>
              <CheckCheck aria-hidden />
              {t("markAllRead")}
            </Button>
          )
        }
      />
      <div className="flex gap-2" role="group" aria-label={t("show")}>
        {(["all", "unread"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={show === v}
            onClick={() => {
              setShow(v);
              setAt("0");
            }}
            className={cn(
              "min-h-8 rounded-full border px-3 font-medium",
              show === v ? "border-transparent bg-secondary text-foreground" : "border-border text-text-secondary hover:bg-accent hover:text-foreground",
            )}
          >
            {t(`filter.${v}`)}
          </button>
        ))}
      </div>
      {list.isPending && <RowSkeletons rows={4} />}
      {list.isError && <p className="text-bad-text">{t("loadFailed")}</p>}
      {list.isSuccess && items.length === 0 && <p className="text-text-secondary">{show === "unread" ? t("noUnread") : t("none")}</p>}
      {items.length > 0 && (
        <ul aria-label={t("title")} className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {items.map((n) => {
            const row = (
              <>
                <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-link")} />
                <NotificationText n={n} />
                {!n.read_at && <span className="sr-only">{t("unreadMark")}</span>}
              </>
            );
            return (
              <li key={n.id} data-id={n.id} data-unread={n.read_at ? undefined : "true"}>
                {n.link ? (
                  <Link href={n.link} onClick={() => opened(n)} className="flex gap-3 px-4 py-3 hover:bg-accent">
                    {row}
                  </Link>
                ) : (
                  <button type="button" onClick={() => opened(n)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-accent">
                    {row}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager offset={offset} limit={PAGE} total={total} onOffset={(o) => setAt(`${o}`)} />
    </Page>
  );
}
