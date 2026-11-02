"use client";

import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

/** One page of a WhatsApp chat as the wa_thread / wa_number_thread RPCs return it: newest first. */
export interface ThreadPage<M extends ThreadMessage = ThreadMessage> {
  items: M[];
  next_cursor: string | null;
}
export interface ThreadMessage {
  id: string;
  created_at: string;
}

const newerFirst = (a: ThreadMessage, b: ThreadMessage) =>
  a.created_at === b.created_at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.created_at < b.created_at ? 1 : -1;

/**
 * Folds a fresh newest page into the pages already loaded, so a new message or a delivery tick
 * costs one request however far back the user has scrolled. Messages already shown are replaced
 * by their fresh copy (new status). If the fresh page doesn't reach anything loaded (more new
 * messages came in than one page holds), only the fresh page is kept: no hole in the middle.
 */
export function mergeNewest<P extends ThreadPage>(old: InfiniteData<P, string | null> | undefined, fresh: P): InfiniteData<P, string | null> {
  const only = { pages: [fresh], pageParams: [null] };
  if (!old || old.pages.length === 0) return only;
  const freshIds = new Set(fresh.items.map((m) => m.id));
  const loaded = old.pages.flatMap((p) => p.items);
  const overlaps = fresh.next_cursor === null || loaded.some((m) => freshIds.has(m.id));
  if (!overlaps) return only;

  const [first, ...rest] = old.pages as [P, ...P[]];
  const kept = first.items.filter((m) => !freshIds.has(m.id));
  const items = [...fresh.items, ...kept].sort(newerFirst);
  // The next page starts after page 1's oldest message: keep its cursor while that message is
  // still the oldest here, else the fresh page's own cursor is the right one.
  const oldest = items.at(-1);
  const next_cursor = oldest && kept.some((m) => m.id === oldest.id) ? first.next_cursor : fresh.next_cursor;
  const pages = [
    { ...fresh, items, next_cursor },
    ...rest.map((p) => ({ ...p, items: p.items.filter((m) => !freshIds.has(m.id)) })),
  ] as P[];
  return { pages, pageParams: old.pageParams };
}

/** How often the open chat checks for news when no live event came (safety net only). */
const SAFETY_MS = 120_000;

/**
 * A WhatsApp chat: the newest page first, older pages on demand (keyset, server side), and
 * `refreshNewest` that reloads only the newest page (live events, after sending, every 2 min).
 */
export function useChatThread<P extends ThreadPage>(key: readonly unknown[], fetchPage: (cursor: string | null) => Promise<P>) {
  const queryClient = useQueryClient();
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  const keyJson = JSON.stringify(key);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.next_cursor,
  });

  const busy = useRef(false);
  const again = useRef(false);
  const refreshNewest = useCallback(async () => {
    // One at a time; a call while one is running runs once more after it (news in between).
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    const queryKey = JSON.parse(keyJson) as unknown[];
    try {
      do {
        again.current = false;
        // Loading an older page right now: wait for it, else its result would drop this merge.
        for (let i = 0; i < 20 && queryClient.isFetching({ queryKey }) > 0; i++) await new Promise((r) => setTimeout(r, 150));
        const fresh = await fetchRef.current(null);
        queryClient.setQueryData<InfiniteData<P, string | null>>(queryKey, (old) => mergeNewest(old, fresh));
      } while (again.current);
    } catch {
      // A failed refresh is not shown: the next event or the 2-minute check tries again.
    } finally {
      busy.current = false;
    }
  }, [keyJson, queryClient]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshNewest();
    }, SAFETY_MS);
    return () => clearInterval(id);
  }, [refreshNewest]);

  return { thread: query, refreshNewest };
}
