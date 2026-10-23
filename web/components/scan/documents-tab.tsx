"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CloudOff, ExternalLink, FileText, FileUp, RotateCcw, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { formatDate, formatTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { callFunction, rpc } from "@/lib/rpc";
import { viewUrls } from "@/lib/upload";
import { deleteJob, releaseJob, type UploadJob } from "@/lib/upload-queue";
import { useFeedback } from "@/lib/use-feedback";
import { ScannerDialog } from "./scanner-dialog";
import { useQueuedJobs } from "./upload-queue-runner";

interface DocItem {
  id: string;
  title: string;
  doc_date: string;
  file_id: string;
  thumbnail_file_id: string | null;
  page_count: number | null;
  kind: string | null;
  mime: string;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** The patient's Documents tab: scans still uploading from this computer, then the saved documents. */
export function DocumentsTab({ patientId }: { patientId: string }) {
  const t = useTranslations("scan");
  const p = useTranslations("patientFile");
  const c = useTranslations("common");
  const { failed } = useFeedback();
  const [scanning, setScanning] = useState(false);
  const queued = useQueuedJobs(patientId);
  const docs = useInfiniteQuery({
    queryKey: ["documents", patientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ items: DocItem[]; next_cursor: string | null }>("patient_documents", { p_patient_id: patientId, p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const rows = docs.data?.pages.flatMap((x) => x.items) ?? [];
  const thumbIds = rows.map((d) => d.thumbnail_file_id).filter((id): id is string => Boolean(id));
  // View links last 5 minutes: one call per page of documents, refreshed before they run out.
  const thumbs = useQuery({
    queryKey: ["document_thumbs", thumbIds],
    queryFn: () => viewUrls(thumbIds),
    enabled: thumbIds.length > 0,
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
  });
  const open = async (fileId: string) => {
    try {
      const urls = await viewUrls([fileId]);
      if (urls[fileId]) window.open(urls[fileId], "_blank", "noopener");
    } catch (e) {
      failed(e);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button onClick={() => setScanning(true)}>
          <FileUp aria-hidden />
          {p("addDocument")}
        </Button>
      </div>

      {queued.length > 0 && (
        <section aria-label={t("queueTitle")} className="flex flex-col gap-2">
          {queued.map((job) => (
            <QueuedRow key={job.id} job={job} />
          ))}
        </section>
      )}

      <Table>
        <THead>
          <tr>
            <TH>
              <span className="sr-only">{t("preview")}</span>
            </TH>
            <TH>{p("docTitle")}</TH>
            <TH>{p("docKind")}</TH>
            <TH>{p("docDate")}</TH>
            <TH>{t("pagesColumn")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {docs.isPending && <EmptyRow colSpan={6}>{c("loading")}</EmptyRow>}
          {docs.isError && <EmptyRow colSpan={6}>{c("loadFailed")}</EmptyRow>}
          {docs.isSuccess && rows.length === 0 && <EmptyRow colSpan={6}>{p("noDocuments")}</EmptyRow>}
          {rows.map((d) => {
            const thumb = d.thumbnail_file_id ? thumbs.data?.[d.thumbnail_file_id] : undefined;
            return (
              <TR key={d.id}>
                <TD className="w-20">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private thumbnail
                    <img src={thumb} alt="" className="h-16 w-12 rounded-md border border-border object-cover" />
                  ) : (
                    <FileText aria-hidden className="size-8 text-text-secondary" />
                  )}
                </TD>
                <TD className="font-medium">{d.title}</TD>
                <TD>{d.kind ?? "—"}</TD>
                <TD className="whitespace-nowrap">{formatDate(new Date(d.doc_date))}</TD>
                <TD className="tabular-nums">{d.page_count ?? 1}</TD>
                <TD className="text-right">
                  <Button variant="ghost" onClick={() => void open(d.file_id)}>
                    <ExternalLink aria-hidden />
                    {p("open")}
                  </Button>
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      {docs.hasNextPage && (
        <Button variant="secondary" className="self-start" onClick={() => void docs.fetchNextPage()}>
          {c("loadMore")}
        </Button>
      )}

      <Dialog open={scanning} onOpenChange={setScanning}>
        {scanning && <ScannerDialog patientId={patientId} onDone={() => setScanning(false)} />}
      </Dialog>
    </div>
  );
}

function QueuedRow({ job }: { job: UploadJob }) {
  const t = useTranslations("scan");
  const e = useTranslations("errors");
  const online = useOnline();
  const remove = async () => {
    await deleteJob(job.id);
    // Files already uploaded for it are not needed any more.
    const leftovers = [job.reuseFileId ? null : job.fileId, job.thumbId].filter((id): id is string => Boolean(id));
    if (leftovers.length) void callFunction("files-sign", { op: "discard", file_ids: leftovers }).catch(() => {});
  };
  let badge;
  if (job.state === "duplicate") badge = <StatusBadge kind="warning" label={t("queueDuplicate", { title: job.duplicateOf?.title ?? "" })} />;
  else if (job.state === "failed") badge = <StatusBadge kind="critical" label={t("queueFailed", { reason: e(job.error ?? "unknown") })} />;
  else if (!online) badge = <StatusBadge kind="warning" label={t("queueOffline")} />;
  else if (job.state === "uploading" || job.attempts === 0) badge = <StatusBadge kind="good" label={t("queueUploading")} />;
  else badge = <StatusBadge kind="warning" label={t("queueRetry", { time: formatTime(new Date(job.nextAttemptAt)) })} />;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3">
      {online ? <Upload aria-hidden className="size-6 text-text-secondary" /> : <CloudOff aria-hidden className="size-6 text-status-warning" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{job.title}</p>
        <p className="text-[0.9rem] text-text-secondary">
          {t("queueDetails", { n: job.pageCount, date: formatDate(new Date(job.docDate)) })}
        </p>
      </div>
      {badge}
      {(job.state === "duplicate" || job.state === "failed") && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void releaseJob(job.id, { skipDuplicateCheck: job.state === "duplicate" })}>
            <RotateCcw aria-hidden />
            {job.state === "duplicate" ? t("saveAnyway") : t("tryAgain")}
          </Button>
          <Button variant="ghost" onClick={() => void remove()}>
            <Trash2 aria-hidden />
            {t("removeQueued")}
          </Button>
        </div>
      )}
    </div>
  );
}
