"use client";

import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ClinicMark } from "@/components/clinic-mark";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useLiveWhatsApp } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";
import { isActive, navFor, PRIMARY_ACTIONS } from "@/lib/nav";
import type { Me } from "@/lib/session";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

export function Sidebar({
  me,
  collapsed,
  onToggle,
  onNavigate,
  headerAction,
  className,
}: {
  me: Me;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  /** Button at the right of the header (the mobile drawer's close button). */
  headerAction?: ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const items = navFor(me.role).filter((item) => item.inMenu !== false);
  const action = PRIMARY_ACTIONS[me.role];
  // One small call for every badge; refreshed every few minutes.
  const badges = useQuery({
    queryKey: ["nav_badges"],
    queryFn: () => rpc<Record<string, number>>("nav_badges"),
    enabled: items.some((i) => i.badge),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  // The unread-WhatsApp badge moves the moment a reply arrives or someone reads it.
  useLiveWhatsApp(null, [["nav_badges"]], items.some((i) => i.badge === "whatsapp"));

  return (
    <aside
      className={cn(
        // overflow-hidden: while the width animates (or if a label is longer than the bar) the
        // content is cut cleanly at the bar's edge instead of spilling over the page.
        "flex h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[4.5rem]" : "w-64",
        className,
      )}
    >
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "justify-center")}>
        {!collapsed && (
          <Link href="/home" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-sidebar-accent">
            <ClinicMark name={me.clinic.name} logoPath={me.clinic.logo_path} size={26} />
            <span className="truncate font-semibold">{me.clinic.name ?? t("app.name")}</span>
          </Link>
        )}
        {onToggle && (
          <Tooltip label={collapsed ? t("nav.expand") : t("nav.collapse")}>
            <Button variant="ghost" size="icon" onClick={onToggle} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}>
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </Button>
          </Tooltip>
        )}
        {headerAction}
      </div>

      {action && (
        <div className="px-3 pb-2">
          {action.href ? (
            <Button asChild variant="secondary" className={cn("w-full justify-start", collapsed && "justify-center px-0")}>
              <Link href={action.href} onClick={onNavigate}>
                <action.icon aria-hidden />
                {!collapsed && t(action.labelKey)}
              </Link>
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled
              className={cn("w-full justify-start", collapsed && "justify-center px-0")}
              aria-label={`${t(action.labelKey)} — ${t("actions.soon")}`}
            >
              <action.icon aria-hidden />
              {!collapsed && (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">{t(action.labelKey)}</span>
                  <span className="shrink-0 rounded-full border border-border px-2 text-[0.9rem] font-normal">
                    {t("actions.soonShort")}
                  </span>
                </span>
              )}
            </Button>
          )}
        </div>
      )}

      <nav aria-label={t("nav.mainMenu")} className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const count = item.badge ? (badges.data?.[item.badge] ?? 0) : 0;
            const label = count > 0 ? t(item.badgeLabelKey ?? "nav.withCount", { label: t(item.labelKey), n: count }) : t(item.labelKey);
            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-xl px-3 hover:bg-sidebar-accent",
                  active && "bg-sidebar-accent font-semibold",
                  collapsed && "justify-center px-0",
                )}
              >
                <span className="relative">
                  <item.icon aria-hidden className="size-[1.15rem] shrink-0" />
                  {collapsed && count > 0 && <span aria-hidden className="absolute -top-1 -right-1 size-2.5 rounded-full bg-status-warning" />}
                </span>
                {collapsed ? (
                  <span className="sr-only">{label}</span>
                ) : (
                  <>
                    <span className="sr-only">{label}</span>
                    <span aria-hidden className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate">{t(item.labelKey)}</span>
                      {count > 0 && (
                        <span className="min-w-7 shrink-0 rounded-full border border-border bg-secondary px-2 text-center text-[0.9rem] font-semibold tabular-nums">{count}</span>
                      )}
                    </span>
                  </>
                )}
              </Link>
            );
            return <li key={item.href}>{collapsed ? <Tooltip label={label}>{link}</Tooltip> : link}</li>;
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <UserMenu me={me} collapsed={collapsed} />
      </div>
    </aside>
  );
}
