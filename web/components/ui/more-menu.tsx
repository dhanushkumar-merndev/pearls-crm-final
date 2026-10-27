"use client";

import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu";

/**
 * "More ▾": the less-used actions of a screen, so the screen shows one primary action and one
 * or two others. Items are DropdownMenuItem (with icon + text). Renders nothing without items.
 */
export function MoreMenu({ children, label }: { children: ReactNode; label?: string }) {
  const t = useTranslations("common");
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Ellipsis aria-hidden />
          {label ?? t("more")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
