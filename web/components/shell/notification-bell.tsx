"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ListChecks } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { type Notification, markNotificationRead, NOTIFICATION_COLUMNS, NotificationText } from "@/components/notifications/notification-text";

/** Bell with unread count (the newest 10; "See all notifications" opens the full list). Realtime pushes new ones; no polling. */
export function NotificationBell({ staffId }: { staffId: string }) {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();
  const queryKey = ["notifications", staffId];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Notification[];
    },
  });
  // The real number of unread ones, not just those among the newest 10.
  const { data: unreadCount } = useQuery({
    queryKey: [...queryKey, "unread"],
    queryFn: async () => {
      const { count, error } = await getSupabaseBrowser().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`notifications:${staffId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${staffId}` },
        () => void queryClient.invalidateQueries({ queryKey: ["notifications", staffId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [staffId, queryClient]);

  const unread = unreadCount ?? data?.filter((n) => !n.read_at).length ?? 0;

  async function markAllRead() {
    await getSupabaseBrowser().rpc("mark_notifications_read", { p_ids: null });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  function opened(n: Notification) {
    if (!n.read_at) void markNotificationRead(n.id).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`${t("label")}: ${unread > 99 ? t("unreadOver") : t("unread", { count: unread })}`}>
          <Bell aria-hidden />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-status-critical px-1 text-[0.75rem] font-bold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      {/* Never taller than the screen: the heading and "Mark all as read" stay put, the list scrolls. */}
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="flex max-h-[min(32rem,calc(var(--radix-dropdown-menu-content-available-height)-0.5rem))] w-80 flex-col"
      >
        <DropdownMenuLabel>{t("unread", { count: unread })}</DropdownMenuLabel>
        {(data ?? []).length === 0 && <p className="px-3 py-4 text-text-secondary">{t("empty")}</p>}
        <div className="-mx-1.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5">
          {(data ?? []).map((n) => (
            <DropdownMenuItem key={n.id} asChild={Boolean(n.link)} onSelect={() => opened(n)} className="flex-col items-start gap-0.5 py-2">
              {n.link ? (
                <Link href={n.link}>
                  <NotificationText n={n} />
                </Link>
              ) : (
                <NotificationText n={n} />
              )}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        {unread > 0 && <DropdownMenuItem onSelect={markAllRead}>{t("markAllRead")}</DropdownMenuItem>}
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            <ListChecks aria-hidden />
            {t("seeAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
