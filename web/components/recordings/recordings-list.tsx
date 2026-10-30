"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, MapPin, Mic, Phone, Play, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, type StatusKind } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { LoadMore } from "@/components/ui/load-more";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";
import { useMe } from "@/lib/use-me";

export type RecordingStatus = "on_phone" | "queued" | "uploading" | "synced" | "failed" | "archived";

export interface RecordingRow {
  id: string;
  kind: "call" | "visit" | "voice_note";
  status: RecordingStatus;
  recorded_at: string;
  duration_s: number;
  uploaded_s: number | null;
  trimmed: boolean;
  needs_review: boolean;
  sync_requested_at: string | null;
  file_id: string | null;
  error: string | null;
  staff_name: string;
  lead_id: string | null;
  lead_name: string | null;
  sl_no: number | null;
  phone_e164: string | null;
  outcome: string | null;
  notes: string | null;
}

export interface RecordingFilters {
  lead_id?: string;
  patient_id?: string;
  status?: RecordingStatus;
  kind?: RecordingRow["kind"];
}

const STATUS_KIND: Record<RecordingStatus, StatusKind> = {
  on_phone: "warning",
  queued: "warning",
  uploading: "warning",
  synced: "good",
  failed: "critical",
  archived: "serious",
};

const KIND_ICON: Record<RecordingRow["kind"], LucideIcon> = { call: Phone, visit: MapPin, voice_note: Mic };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Recordings, newest first: play the synced ones, ask the phone for the others. */
export function RecordingsList({ filters = {}, showLead = true }: { filters?: RecordingFilters; showLead?: boolean }) {
  const t = useTranslations("recordings");
  const me = useMe();
  const canRequest = me?.role === "sales_manager" || me?.role === "admin";
  const key = ["recordings_list", filters] as const;
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: RecordingRow[]; next_cursor: string | null }>("recordings_list", { p_filters: filters, p_cursor: pageParam, p_limit: 30 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  if (list.isPending) return <RowSkeletons rows={3} />;
  if (items.length === 0) return <p className="text-text-secondary">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {items.map((r) => (
          <RecordingItem key={r.id} r={r} showLead={showLead} canRequest={canRequest} queryKey={key} />
        ))}
      </ul>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
        {t("more")}
      </LoadMore>
    </div>
  );
}

function RecordingItem({ r, showLead, canRequest, queryKey }: { r: RecordingRow; showLead: boolean; canRequest: boolean; queryKey: readonly unknown[] }) {
  const t = useTranslations("recordings");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [src, setSrc] = useState<string | null>(null);
  const play = useMutation({
    mutationFn: async () => (await viewUrls([r.file_id!]))[r.file_id!] ?? null,
    onSuccess: (url) => (url ? setSrc(url) : failed(new Error("not_found"))),
    onError: failed,
  });
  const request = useMutation({
    mutationFn: () => rpc("request_recording_sync", { p_id: r.id }),
    onSuccess: () => {
      saved(t("requested"));
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: failed,
  });
  const waitingForPhone = r.status !== "synced" && r.status !== "archived";

  const KindIcon = KIND_ICON[r.kind];
  const title = showLead && r.lead_id ? `${r.lead_name ?? r.phone_e164 ?? ""}${r.sl_no ? ` #${r.sl_no}` : ""}` : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      {/* One row: what it is and who, then its state and the one action on the right. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-text-secondary">
            <KindIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <Link href={`/leads/${r.lead_id}`} className="self-start truncate font-medium text-link underline-offset-4 hover:underline">
                {title}
              </Link>
            ) : (
              <span className="font-medium">{t(`kind.${r.kind}`)}</span>
            )}
            <p className="flex flex-wrap items-center gap-x-1.5 text-[0.9rem] text-text-secondary">
              {title && <span>{t(`kind.${r.kind}`)}</span>}
              {title && <span aria-hidden>·</span>}
              <span className="tabular-nums">{mmss(r.duration_s)}</span>
              <span aria-hidden>·</span>
              <span>{r.staff_name}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatDateTime(new Date(r.recorded_at))}</span>
            </p>
            {r.notes && <p className="line-clamp-2 text-[0.9rem] whitespace-pre-wrap">{r.notes}</p>}
            {r.trimmed && r.uploaded_s != null && <p className="text-[0.9rem] text-text-secondary">{t("trimmed", { minutes: Math.round(r.uploaded_s / 60) })}</p>}
            {r.status === "failed" && r.error && <p className="text-[0.9rem] text-bad-text">{t("failedBecause", { error: r.error })}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-12 sm:shrink-0 sm:justify-end sm:pl-0">
          {r.needs_review && <StatusBadge kind="serious" label={t("checkMatch")} />}
          <div className="flex flex-col items-start gap-0.5 sm:items-end">
            <StatusBadge kind={STATUS_KIND[r.status]} label={t(`status.${r.status}`)} />
            {r.sync_requested_at && waitingForPhone && (
              <span className="text-[0.85rem] text-text-secondary">{t("askedAt", { at: formatDateTime(new Date(r.sync_requested_at)) })}</span>
            )}
          </div>
          {r.file_id && !src && (
            <Button variant="secondary" disabled={play.isPending} onClick={() => play.mutate()}>
              <Play aria-hidden />
              {t("play")}
            </Button>
          )}
          {canRequest && waitingForPhone && !r.sync_requested_at && (
            <Button variant="secondary" disabled={request.isPending} onClick={() => request.mutate()}>
              <CloudDownload aria-hidden />
              {t("requestSync")}
            </Button>
          )}
        </div>
      </div>
      {src && (
        <div className="sm:pl-12">
          <audio controls autoPlay src={src} className="w-full" aria-label={t("player")} />
        </div>
      )}
    </li>
  );
}
