"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { formatDateTime } from "@pearl/shared";
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

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Bell with unread count. Realtime pushes new notifications; no polling. */
export function NotificationBell({ staffId }: { staffId: string }) {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();
  const queryKey = ["notifications", staffId];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from("notifications")
        .select("id, title, body, link, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Notification[];
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

  const unread = data?.filter((n) => !n.read_at).length ?? 0;

  async function markAllRead() {
    await getSupabaseBrowser().rpc("mark_notifications_read", { p_ids: null });
    await queryClient.invalidateQueries({ queryKey });
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
            <DropdownMenuItem key={n.id} asChild={Boolean(n.link)} className="flex-col items-start gap-0.5 py-2">
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
        {unread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={markAllRead}>{t("markAllRead")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationText({ n }: { n: Notification }) {
  return (
    <span className="flex w-full flex-col">
      <span className={n.read_at ? "" : "font-semibold"}>{n.title}</span>
      {n.body && <span className="text-[0.9rem] text-text-secondary">{n.body}</span>}
      <span className="text-[0.9rem] text-text-secondary">{formatDateTime(new Date(n.created_at))}</span>
    </span>
  );
}
