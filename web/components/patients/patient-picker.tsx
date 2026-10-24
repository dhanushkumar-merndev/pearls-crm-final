"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { ChevronsUpDown, LoaderCircle, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { useId, useState } from "react";
import { useDebounced } from "@/components/library-combobox";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

export interface PatientHit {
  id: string;
  title: string;
  uhid: string;
  subtitle: string;
  /** global_search also returns leads; the picker keeps patients only. */
  type?: string;
}

/** Find a patient by name, phone or UHID (server search, 10 results). */
export function PatientPicker({
  value,
  onChange,
  excludeId,
  id,
  placeholder,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  value: PatientHit | null;
  onChange: (p: PatientHit | null) => void;
  excludeId?: string;
  id?: string;
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const t = useTranslations("picker");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const listId = useId();
  const search = useDebounced(q.trim(), 300);
  const hits = useQuery({
    queryKey: ["global_search", search],
    enabled: open && search.length >= 2,
    queryFn: () => rpc<PatientHit[]>("global_search", { p_q: search }),
  });
  const items = (hits.data ?? []).filter((h) => h.id !== excludeId && (h.type ?? "patient") === "patient");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-input bg-background px-4 text-left text-base aria-invalid:border-status-critical"
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {value ? `${value.title} · ${value.uhid}` : (placeholder ?? t("findPatient"))}
          </span>
          <ChevronsUpDown aria-hidden className="size-5 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[max(var(--radix-popover-trigger-width),22rem)] rounded-2xl border border-border bg-popover shadow-xl">
          <Command shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="size-5 text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} placeholder={t("patientSearch")} className="min-h-12 flex-1 bg-transparent outline-none" />
              {hits.isFetching && <LoaderCircle aria-hidden className="size-5 animate-spin text-muted-foreground" />}
            </div>
            <Command.List id={listId} className="max-h-80 overflow-y-auto p-1.5">
              {search.length < 2 && <div className="px-3 py-4 text-text-secondary">{t("typeTwo")}</div>}
              {search.length >= 2 && !hits.isFetching && items.length === 0 && <div className="px-3 py-4 text-text-secondary">{t("nothing")}</div>}
              {items.map((h) => (
                <Command.Item
                  key={h.id}
                  value={h.id}
                  onSelect={() => {
                    onChange(h);
                    setOpen(false);
                  }}
                  className="flex min-h-11 cursor-pointer flex-col justify-center rounded-xl px-3 py-1.5 data-[selected=true]:bg-popover-accent"
                >
                  <span>{h.title}</span>
                  <span className="text-[0.85rem] text-text-secondary">{h.subtitle}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
