"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, LoaderCircle, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { cn } from "@/lib/utils";

export type LibraryKind =
  | "service"
  | "treatment_template"
  | "room_type"
  | "pharmacy_item"
  | "supplier"
  | "doctor"
  | "lead_source"
  | "lost_reason"
  | "referral_name"
  | "bill_category"
  | "payment_mode"
  | "relation"
  | "document_kind"
  | "quick_reply"
  | "break_type";

export interface LibraryItem {
  id: string;
  label: string;
  subtitle: string | null;
  on_the_fly: boolean;
  defaults: Record<string, unknown>;
}

interface Page {
  items: LibraryItem[];
  next_cursor: string | null;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The one picker for every library (PLAN.md "LibraryCombobox"): opens with the 10 most
 * used, searches on the server as you type, "Load 10 more", and — where allowed —
 * "Add '<what you typed>'", which creates the item flagged for the admin's review.
 */
export function LibraryCombobox({
  kind,
  value,
  onChange,
  placeholder,
  allowCreate = false,
  createDefaults,
  disabled,
  id,
  invalid,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
}: {
  kind: LibraryKind;
  value: LibraryItem | null;
  onChange: (item: LibraryItem | null) => void;
  placeholder?: string;
  allowCreate?: boolean;
  /** Extra fields for an item added on the fly (e.g. a price). */
  createDefaults?: Record<string, unknown>;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  className?: string;
  /** From Field's render props, so `{...a}` marks the picker when its field has an error. */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const t = useTranslations("picker");
  const { failed } = useFeedback();
  const queryClient = useQueryClient();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(q.trim());

  const query = useInfiniteQuery({
    queryKey: ["library", kind, debounced],
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      void signal; // supabase-js has no abort; stale pages are simply ignored by the key
      return rpc<Page>("library_search", { p_kind: kind, p_q: debounced, p_cursor: pageParam, p_limit: 10 });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const exact = items.some((i) => i.label.toLowerCase() === q.trim().toLowerCase());
  const showCreate = allowCreate && q.trim().length > 0 && !exact && !query.isFetching;

  // Keyed so a form can wait for it (the bill editor holds Save / Finalize until the item is picked).
  const createItem = useMutation({
    mutationKey: ["library_create", kind],
    mutationFn: (label: string) =>
      rpc<LibraryItem>("library_create", { p_kind: kind, p_payload: { label, ...createDefaults }, p_client_id: newId() }),
  });

  async function create() {
    setCreating(true);
    try {
      const item = await createItem.mutateAsync(q.trim());
      // Pick it at once; the list refreshes behind (a save pressed meanwhile must see the item).
      onChange(item);
      void queryClient.invalidateQueries({ queryKey: ["library", kind] });
      setOpen(false);
      setQ("");
    } catch (e) {
      failed(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || ariaInvalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "flex min-h-10 w-full items-center gap-2 rounded-xl border border-input bg-background px-3.5 text-left text-base",
            "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-critical",
            className,
          )}
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {value ? value.label : (placeholder ?? t("choose"))}
          </span>
          <ChevronsUpDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[max(var(--radix-popover-trigger-width),20rem)] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="size-5 text-muted-foreground" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={t("search")}
                className="min-h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              {query.isFetching && <LoaderCircle aria-hidden className="size-5 animate-spin text-muted-foreground" />}
            </div>
            <Command.List id={listId} className="max-h-80 overflow-y-auto p-1.5">
              {!query.isFetching && items.length === 0 && !showCreate && (
                <Command.Empty className="px-3 py-5 text-center text-text-secondary">{t("nothing")}</Command.Empty>
              )}
              {value && (
                <Command.Item
                  value="__clear"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 text-text-secondary data-[selected=true]:bg-popover-accent"
                >
                  {t("clear")}
                </Command.Item>
              )}
              {items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 data-[selected=true]:bg-popover-accent"
                >
                  <Check aria-hidden className={cn("size-5 shrink-0", value?.id === item.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.subtitle && <span className="truncate text-[0.9rem] text-text-secondary">{item.subtitle}</span>}
                  </span>
                  {item.on_the_fly && (
                    <span className="rounded-full border border-border px-2 text-[0.9rem] text-text-secondary">{t("new")}</span>
                  )}
                </Command.Item>
              ))}
              {query.hasNextPage && (
                <Command.Item
                  value="__more"
                  onSelect={() => void query.fetchNextPage()}
                  className="flex min-h-10 cursor-pointer items-center justify-center rounded-xl px-3 text-link data-[selected=true]:bg-popover-accent"
                >
                  {query.isFetchingNextPage ? t("loading") : t("more")}
                </Command.Item>
              )}
              {showCreate && (
                <Command.Item
                  value="__create"
                  disabled={creating}
                  onSelect={() => void create()}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 data-[selected=true]:bg-popover-accent"
                >
                  <Plus aria-hidden className="size-5 shrink-0" />
                  {t("add", { name: q.trim() })}
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
