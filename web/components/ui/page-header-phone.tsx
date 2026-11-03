"use client";

import { Ellipsis, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";

/**
 * Phone width only (owner, 03/11/2026: "more on the screen"): the page's description hides behind
 * this ⓘ after the title; a tap shows it in a popup. From "sm" up the description is on the page.
 */
export function AboutPage({ title, description }: { title: ReactNode; description: ReactNode }) {
  const t = useTranslations("common");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-text-secondary sm:hidden" aria-label={t("aboutPage")}>
          <Info aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={title}>
        <p className="text-text-secondary">{description}</p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A page's buttons. From "sm" up: one wrapping row, as always. On a phone the box is
 * `display: contents`, so its buttons join the title's row: the first keeps its text beside the
 * title, the rest wait behind ⋯ and show (with their words) on a line of their own below.
 * They are only hidden with CSS, never unmounted, so a button that owns a dialog keeps it open.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const box = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setCount(el.childElementCount);
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true });
    return () => observer.disconnect();
  }, []);
  const more = count > 1;
  return (
    <>
      <div
        ref={box}
        className={cn(
          "flex flex-wrap items-center gap-2 max-sm:contents",
          "max-sm:[&>*:first-child]:order-1 max-sm:[&>*:nth-child(n+2)]:order-4",
          !open && "max-sm:[&>*:nth-child(n+2)]:hidden",
        )}
      >
        {children}
      </div>
      {more && (
        <Button
          variant="secondary"
          size="icon"
          className="order-2 sm:hidden"
          aria-label={t("moreActions")}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Ellipsis aria-hidden />
        </Button>
      )}
      {/* The line break before the other buttons (phone, once ⋯ is open). */}
      {more && open && <div aria-hidden className="order-3 basis-full sm:hidden" />}
    </>
  );
}
