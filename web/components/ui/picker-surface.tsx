"use client";

import { Check, Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog as D, Popover as P } from "radix-ui";
import type { ReactNode } from "react";
import { SM_UP, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Where a picker opens: a pop-up under the box from the "sm" width up, a bottom sheet on a phone
 * (owner, 02/11/2026). Both end with Clear and OK; nothing changes until OK (Esc / tapping outside
 * keeps the old value).
 */
export function PickerSurface({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  onOk,
  onClear,
  okDisabled,
  align = "start",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The box that opens the picker (rendered asChild). */
  trigger: ReactNode;
  /** Shown at the top of the phone sheet; the pop-up's accessible name. */
  title: string;
  children: ReactNode;
  onOk: () => void;
  onClear?: () => void;
  okDisabled?: boolean;
  align?: "start" | "center" | "end";
}) {
  const t = useTranslations("datePicker");
  const wide = useMediaQuery(SM_UP);
  const footer = (
    <div className={cn("flex items-center justify-end gap-2 border-t border-border pt-3", !wide && "pb-[env(safe-area-inset-bottom)]")}>
      {onClear && (
        <Button variant="ghost" onClick={onClear} className={cn(!wide && "flex-1")}>
          <Eraser aria-hidden />
          {t("clear")}
        </Button>
      )}
      <Button onClick={onOk} disabled={okDisabled} className={cn(!wide && "flex-1")}>
        <Check aria-hidden />
        {t("ok")}
      </Button>
    </div>
  );

  if (wide) {
    return (
      <P.Root open={open} onOpenChange={onOpenChange}>
        <P.Trigger asChild>{trigger}</P.Trigger>
        <P.Portal>
          <P.Content
            role="dialog"
            aria-label={title}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className="z-50 flex max-h-[var(--radix-popover-content-available-height)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
          >
            {children}
            {footer}
          </P.Content>
        </P.Portal>
      </P.Root>
    );
  }

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <D.Content
          data-picker-sheet=""
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pt-3 pb-4 text-popover-foreground shadow-2xl outline-none"
        >
          <div aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" />
          <D.Title className="text-base font-semibold">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          <div className="flex flex-col items-center gap-3">{children}</div>
          {footer}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
