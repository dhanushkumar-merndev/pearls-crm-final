"use client";

import { Menu, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { UploadQueueRunner } from "@/components/scan/upload-queue-runner";
import { Button } from "@/components/ui/button";
import type { Me } from "@/lib/session";
import { MeProvider } from "@/lib/use-me";
import { CommandPalette } from "./command-palette";
import { IdleLogout } from "./idle-logout";
import { NotificationBell } from "./notification-bell";
import { Sidebar } from "./sidebar";
import { useThemePreference } from "./use-theme-preference";

// Remembered per browser (a convenience only): is the sidebar collapsed?
const COLLAPSE_KEY = "pearl.sidebar.collapsed";
const collapseListeners = new Set<() => void>();

function subscribeCollapsed(onChange: () => void) {
  collapseListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    collapseListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // storage blocked: default expanded
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // ignore: the toggle simply won't be remembered
  }
  for (const listener of collapseListeners) listener();
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/** ChatGPT-style layout: left sidebar, slim top bar with one search box, full-width content. */
export function AppShell({ me, idleMinutes, children }: { me: Me; idleMinutes: number; children: ReactNode }) {
  const t = useTranslations();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { choose } = useThemePreference(me.theme);
  const toggleCollapsed = () => writeCollapsed(!collapsed);

  // "/" or Ctrl/⌘+K opens search. Shortcuts help but are never required.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MeProvider me={me}>
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("app.skipToContent")}
      </a>

      <Sidebar me={me} collapsed={collapsed} onToggle={toggleCollapsed} className="sticky top-0 hidden lg:flex" />

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 lg:hidden" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">{t("nav.mainMenu")}</Dialog.Title>
            <Sidebar
              me={me}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              headerAction={
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label={t("nav.closeMenu")}>
                    <X aria-hidden />
                  </Button>
                </Dialog.Close>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-background/85 px-4 backdrop-blur md:px-6 xl:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("nav.openMenu")}>
            <Menu aria-hidden />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mx-auto flex min-h-10 max-w-xl min-w-0 flex-1 items-center gap-3 rounded-full border border-border bg-secondary px-4 text-left text-muted-foreground hover:bg-popover-accent"
          >
            <Search aria-hidden className="size-4" />
            <span className="flex-1 truncate">{t("search.placeholder")}</span>
            <kbd className="hidden rounded-md border border-border px-1.5 text-[0.9rem] sm:inline">/</kbd>
          </button>
          <NotificationBell staffId={me.id} />
        </header>
        <main id="main" tabIndex={-1} className="w-full min-w-0 flex-1 px-4 pt-3 pb-8 outline-none md:px-6 xl:px-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={me.role} onTheme={choose} />
      <IdleLogout minutes={idleMinutes} />
      <UploadQueueRunner />
    </div>
    </MeProvider>
  );
}
