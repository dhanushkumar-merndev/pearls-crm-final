"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Sheet = D.Root;

/** A panel that slides in from the right over the page (details of a row), full width on a phone. */
export function SheetContent({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof D.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons beside the close button. */
  actions?: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-overlay" />
      <D.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl outline-none sm:w-[min(48rem,92vw)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <D.Title className="text-lg font-semibold break-words">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[0.95rem] text-text-secondary">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          {actions}
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label={t("close")}>
              <X aria-hidden />
            </Button>
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
