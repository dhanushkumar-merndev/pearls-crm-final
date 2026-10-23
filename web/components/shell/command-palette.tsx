"use client";

import { Command } from "cmdk";
import { Monitor, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { StaffRole, ThemePreference } from "@pearl/shared";
import { navFor } from "@/lib/nav";

const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.85rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-base data-[selected=true]:bg-popover-accent [&_svg]:size-5";

/** One search box everywhere ("/" or Ctrl+K). Patient/lead search joins in Phase 2. */
export function CommandPalette({
  open,
  onOpenChange,
  role,
  onTheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: StaffRole;
  onTheme: (theme: ThemePreference) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("search.label")}
      overlayClassName="fixed inset-0 z-40 bg-overlay"
      contentClassName="fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden className="size-5 text-muted-foreground" />
        <Command.Input
          placeholder={t("search.placeholder")}
          className="min-h-14 flex-1 bg-transparent text-[1.05rem] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-text-secondary">
          {t("search.noResults")} {t("search.patientsSoon")}
        </Command.Empty>
        <Command.Group heading={t("search.goTo")} className={groupClass}>
          {navFor(role).map((item) => (
            <Command.Item key={item.href} value={t(item.labelKey)} onSelect={() => run(() => router.push(item.href))} className={itemClass}>
              <item.icon aria-hidden />
              {t(item.labelKey)}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={t("search.appearance")} className={groupClass}>
          <Command.Item value={`${t("theme.label")} ${t("theme.dark")}`} onSelect={() => run(() => onTheme("dark"))} className={itemClass}>
            <Moon aria-hidden />
            {t("theme.dark")}
          </Command.Item>
          <Command.Item value={`${t("theme.label")} ${t("theme.light")}`} onSelect={() => run(() => onTheme("light"))} className={itemClass}>
            <Sun aria-hidden />
            {t("theme.light")}
          </Command.Item>
          <Command.Item value={`${t("theme.label")} ${t("theme.system")}`} onSelect={() => run(() => onTheme("system"))} className={itemClass}>
            <Monitor aria-hidden />
            {t("theme.system")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
