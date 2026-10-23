"use client";

import { ChevronsUpDown, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ThemePreference } from "@pearl/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Me } from "@/lib/session";
import { cn } from "@/lib/utils";
import { signOut } from "./sign-out-button";
import { useThemePreference } from "./use-theme-preference";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function UserMenu({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const t = useTranslations();
  const { theme, choose } = useThemePreference(me.theme);
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-sidebar-accent",
          collapsed && "justify-center px-0",
        )}
        aria-label={me.full_name}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[0.9rem] font-semibold text-primary-foreground">
          {initials(me.full_name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{me.full_name}</span>
              <span className="block truncate text-[0.85rem] text-muted-foreground">{t(`roles.${me.role}`)}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => choose(v as ThemePreference)}>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            {t("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            {t("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden />
            {t("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/account/password")}>
          <KeyRound aria-hidden />
          {t("account.title")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut aria-hidden />
          {t("actions.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
