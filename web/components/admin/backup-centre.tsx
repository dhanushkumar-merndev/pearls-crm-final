"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleX, DatabaseBackup, FolderOpen, HardDriveDownload, ScanSearch, Square, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { BACKUP_PURPOSES, formatDateTime, istDateString, PURGEABLE_PURPOSES } from "@pearl/shared";
import { formatBytes, StorageMeter, type StorageUsage } from "@/components/admin/storage-meter";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, PageHeader } from "@/components/ui/form";
import { FieldError, Input } from "@/components/ui/input";
import { Page, useAdminBack } from "@/components/ui/page";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { copyFiles, exportDatabase, recheckFolder, type BackupServer, type Folder, type Progress } from "@/lib/backup";
import { callFunction, rpc } from "@/lib/rpc";
import { backupSchema, purgeSchema } from "@/lib/schemas/ops";
import { viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface BatchCard {
  id: string;
  kind: "files" | "database";
  scope: { purposes?: string[]; before?: string | null; stamp?: string };
  status: "running" | "done" | "abandoned";
  total_items: number;
  total_bytes: number;
  done_items: number;
  done_bytes: number;
  failed_items: number;
  started_at: string;
  finished_at: string | null;
  by: string | null;
}
interface Overview {
  running: BatchCard | null;
  batches: BatchCard[];
  last_files_at: string | null;
  last_export_at: string | null;
  not_backed_up: { purpose: string; files: number; bytes: number }[];
  storage: StorageUsage;
}
interface PurgeRow {
  purpose: string;
  ready_files: number;
  ready_bytes: number;
  blocked_files: number;
  blocked_bytes: number;
}
type NamedFolder = Folder & { name: string };

const server: BackupServer = {
  // 20 at a time: each page's download links last 5 minutes.
  page: (b, after) => rpc("backup_items_page", { p_batch_id: b, p_after: after, p_limit: 20 }),
  urls: viewUrls,
  download: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download_${res.status}`);
    return res.blob();
  },
  markVerified: (b, items) => rpc("backup_mark_verified", { p_batch_id: b, p_items: items }),
  failed: (b, id, error) => rpc("backup_item_failed", { p_batch_id: b, p_item_id: id, p_error: error }),
};

/** Chrome and Edge on a computer can write into a folder; other browsers can't. */
function folderPicker(): ((o: { mode: "readwrite"; id: string }) => Promise<NamedFolder>) | null {
  const w = window as unknown as { showDirectoryPicker?: (o: { mode: "readwrite"; id: string }) => Promise<NamedFolder> };
  return typeof w.showDirectoryPicker === "function" ? w.showDirectoryPicker.bind(window) : null;
}

/** "2026-10-26 14-05" in IST: a folder name that sorts by time and is safe on Windows and Mac. */
function stampNow(): string {
  const ist = new Date(Date.now() + 330 * 60_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 13)}-${ist.slice(14, 16)}`;
}

/** Backup centre (PLAN.md E3 row 14): copy files to a folder, check the copies, export the database, free up space. */
export function BackupCentre() {
  const adminBack = useAdminBack();
  const t = useTranslations("backup");
  const p = useTranslations("backup.purpose");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["backup_overview"], queryFn: () => rpc<Overview>("backup_overview") });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["backup_overview"] });
  const [folder, setFolder] = useState<NamedFolder | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && folderPicker() !== null;

  async function chooseFolder(): Promise<NamedFolder | null> {
    const pick = folderPicker();
    if (!pick) return null;
    try {
      const handle = await pick({ mode: "readwrite", id: "clinic-backup" });
      setFolder(handle);
      setFolderError(null);
      return handle;
    } catch (e) {
      // Cancelled: nothing to say.
      if (!(e instanceof DOMException && e.name === "AbortError")) setFolderError(t("folderFailed"));
      return null;
    }
  }
  async function needFolder(): Promise<NamedFolder | null> {
    return folder ?? (await chooseFolder());
  }

  // ---- 2. Copy files -------------------------------------------------------
  const [purposes, setPurposes] = useState<string[]>([...BACKUP_PURPOSES]);
  const [before, setBefore] = useState("");
  const backupChecks = useZodForm(backupSchema);
  const [progress, setProgress] = useState<(Progress & { total: number; bytesTotal: number }) | null>(null);
  const stop = useRef<AbortController | null>(null);
  const running = overview.data?.running ?? null;

  const backup = useMutation({
    mutationFn: async () => {
      const clean = backupChecks.validate({ purposes, before });
      if (!clean) return null;
      const root = await needFolder();
      if (!root) return null;
      const batch = await rpc<BatchCard>("backup_plan", { p_purposes: clean.purposes, p_before: clean.before });
      refresh();
      if (batch.status !== "running") return { done: 0, bytes: 0, failed: 0 };
      stop.current = new AbortController();
      const base = { done: batch.done_items, bytes: Number(batch.done_bytes), failed: 0 };
      setProgress({ ...base, total: batch.total_items, bytesTotal: Number(batch.total_bytes) });
      const out = await copyFiles(root, batch.id, server, (x) => setProgress({
        done: base.done + x.done, bytes: base.bytes + x.bytes, failed: x.failed, total: batch.total_items, bytesTotal: Number(batch.total_bytes),
      }), stop.current.signal);
      return out;
    },
    onSuccess: (out) => {
      if (out) saved(out.failed ? t("copiedSome", { n: out.done, failed: out.failed }) : t("copied", { n: out.done }));
      refresh();
    },
    onError: (e) => {
      failed(e);
      refresh();
    },
    onSettled: () => {
      stop.current = null;
    },
  });
  const abandon = useMutation({
    mutationFn: (id: string) => rpc("backup_abandon", { p_batch_id: id }),
    onSuccess: refresh,
    onError: failed,
  });

  // ---- 3. Check the copies -------------------------------------------------
  const [checkedN, setCheckedN] = useState<number | null>(null);
  const recheck = useMutation({
    mutationFn: async (batchId: string) => {
      const root = await needFolder();
      if (!root) return null;
      setCheckedN(0);
      return recheckFolder(root, batchId, {
        page: (b, after) => rpc("backup_verified_page", { p_batch_id: b, p_after: after, p_limit: 100 }),
        recheck: (b, items) => rpc("backup_recheck", { p_batch_id: b, p_items: items }),
      }, setCheckedN);
    },
    onSuccess: (out) => {
      if (out) saved(out.bad ? t("checkBad", { ok: out.ok, bad: out.bad }) : t("checkGood", { n: out.ok }));
      refresh();
    },
    onError: failed,
  });

  // ---- Database export -----------------------------------------------------
  const [exportStep, setExportStep] = useState<{ table: string; n: number; of: number } | null>(null);
  const exportDb = useMutation({
    mutationFn: async () => {
      const root = await needFolder();
      if (!root) return null;
      return exportDatabase(root, stampNow(), {
        tables: () => rpc("export_tables"),
        page: (table, after) => rpc("export_table_page", { p_table: table, p_after: after, p_limit: 1000 }),
        record: (stamp, tables) => rpc("export_record", { p_stamp: stamp, p_tables: tables }),
      }, (table, n, of) => setExportStep({ table, n, of }));
    },
    onSuccess: (out) => {
      if (out) saved(t("exported", { n: out.length }));
      refresh();
    },
    onError: failed,
    onSettled: () => setExportStep(null),
  });

  // ---- Purge ---------------------------------------------------------------
  const [purgeKinds, setPurgeKinds] = useState<string[]>(["call_recording", "visit_recording"]);
  const [purgeBefore, setPurgeBefore] = useState(() => istDateString(new Date(Date.now() - 90 * 86_400_000)));
  const purgeChecks = useZodForm(purgeSchema);
  const [preview, setPreview] = useState<PurgeRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [purged, setPurged] = useState<number | null>(null);
  const previewMut = useMutation({
    mutationFn: async () => {
      const clean = purgeChecks.validate({ purposes: purgeKinds, before: purgeBefore });
      if (!clean) return null;
      return rpc<PurgeRow[]>("purge_preview", { p_purposes: clean.purposes, p_before: clean.before });
    },
    onSuccess: (rows) => rows && setPreview(rows),
    onError: failed,
  });
  const ready = (preview ?? []).reduce((n, r) => n + Number(r.ready_files), 0);
  const purge = useMutation({
    mutationFn: async () => {
      const clean = purgeChecks.validate({ purposes: purgeKinds, before: purgeBefore });
      if (!clean) return 0;
      let n = 0;
      setPurged(0);
      for (;;) {
        const ids = await rpc<string[]>("purge_candidates", { p_purposes: clean.purposes, p_before: clean.before, p_limit: 100 });
        if (!ids.length) break;
        const res = await callFunction<{ removed: string[] }>("files-sign", { op: "purge", file_ids: ids });
        n += ids.length;
        setPurged(n);
        if (res.removed.length === 0) break;
      }
      return n;
    },
    onSuccess: (n) => {
      saved(t("purged", { n }));
      setConfirming(false);
      setPreview(null);
      refresh();
    },
    onError: failed,
  });

  const o = overview.data;
  const toggle = (list: string[], set: (v: string[]) => void, v: string, on: boolean) => set(on ? [...list, v] : list.filter((x) => x !== v));
  const lastDone = o?.batches.find((b) => b.kind === "files" && b.done_items > 0);

  return (
    <Page>
      <PageHeader back={adminBack} title={t("title")} description={t("description")} />
      {!supported && (
        <p role="alert" className="rounded-xl border border-border p-4 text-bad-text">
          {t("unsupported")}
        </p>
      )}

      {o && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <CardTitle>{t("storageTitle")}</CardTitle>
            <StorageMeter usage={o.storage} />
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>{t("statusTitle")}</CardTitle>
            <p>{o.last_files_at ? t("lastFiles", { when: formatDateTime(new Date(o.last_files_at)) }) : t("noFiles")}</p>
            <p>{o.last_export_at ? t("lastExport", { when: formatDateTime(new Date(o.last_export_at)) }) : t("noExport")}</p>
            <h3 className="font-semibold">{t("notBackedUp")}</h3>
            {o.not_backed_up.length === 0 ? (
              <p className="text-text-secondary">{t("allBackedUp")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {o.not_backed_up.map((r) => (
                  <li key={r.purpose} className="flex justify-between gap-3">
                    <span>{p(r.purpose)}</span>
                    <span className="tabular-nums text-text-secondary">{t("filesAndSize", { n: r.files, size: formatBytes(r.bytes) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step1")}</CardTitle>
        <CardDescription>{t("step1Hint")}</CardDescription>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!supported} onClick={() => void chooseFolder()}>
            <FolderOpen aria-hidden />
            {folder ? t("changeFolder") : t("chooseFolder")}
          </Button>
          {folder && <span role="status">{t("folderChosen", { name: folder.name })}</span>}
        </div>
        {folderError && <FieldError>{folderError}</FieldError>}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step2")}</CardTitle>
        <CardDescription>{t("step2Hint")}</CardDescription>
        {running ? (
          <p role="status">{t("resumeHint", { done: running.done_items, total: running.total_items })}</p>
        ) : (
          <>
            <fieldset aria-describedby={backupChecks.error("purposes") ? "backup-purposes-error" : undefined}>
              <legend className="mb-1 font-medium">{t("kinds")}</legend>
              <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
                {BACKUP_PURPOSES.map((k) => (
                  <Checkbox key={k} label={p(k)} checked={purposes.includes(k)}
                    onChange={(e) => (toggle(purposes, setPurposes, k, e.target.checked), backupChecks.clear("purposes"))} />
                ))}
              </div>
              {backupChecks.error("purposes") && <FieldError id="backup-purposes-error">{backupChecks.error("purposes")}</FieldError>}
            </fieldset>
            <Field label={t("before")} hint={t("beforeHint")} error={backupChecks.error("before")} className="max-w-xs">
              {(a) => <Input {...a} type="date" value={before} onChange={(e) => (setBefore(e.target.value), backupChecks.clear("before"))} />}
            </Field>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!supported || backup.isPending} onClick={() => backup.mutate()}>
            <HardDriveDownload aria-hidden />
            {running ? t("resume") : t("start")}
          </Button>
          {backup.isPending && (
            <Button variant="secondary" onClick={() => stop.current?.abort()}>
              <Square aria-hidden />
              {t("stop")}
            </Button>
          )}
          {running && !backup.isPending && (
            <Button variant="ghost" disabled={abandon.isPending} onClick={() => abandon.mutate(running.id)}>
              <CircleX aria-hidden />
              {t("abandon")}
            </Button>
          )}
        </div>
        {progress && backup.isPending && (
          <div className="flex flex-col gap-1" role="status">
            <div
              role="progressbar"
              aria-label={t("progressLabel")}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-3 overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full bg-status-good" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
            </div>
            <p className="tabular-nums">
              {t("progress", { done: progress.done, total: progress.total, size: formatBytes(progress.bytes), of: formatBytes(progress.bytesTotal) })}
              {progress.failed > 0 && ` · ${t("failedN", { n: progress.failed })}`}
            </p>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step3")}</CardTitle>
        <CardDescription>{t("step3Hint")}</CardDescription>
        <Button variant="secondary" className="self-start" disabled={!supported || !lastDone || recheck.isPending}
          onClick={() => lastDone && recheck.mutate(lastDone.id)}>
          <ScanSearch aria-hidden />
          {recheck.isPending ? t("checking", { n: checkedN ?? 0 }) : t("check")}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("exportTitle")}</CardTitle>
        <CardDescription>{t("exportHint")}</CardDescription>
        <Button variant="secondary" className="self-start" disabled={!supported || exportDb.isPending} onClick={() => exportDb.mutate()}>
          <DatabaseBackup aria-hidden />
          {t("export")}
        </Button>
        {exportStep && <p role="status">{t("exporting", { table: exportStep.table, n: exportStep.n + 1, of: exportStep.of })}</p>}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("purgeTitle")}</CardTitle>
        <CardDescription>{t("purgeHint")}</CardDescription>
        <fieldset aria-describedby={purgeChecks.error("purposes") ? "purge-purposes-error" : undefined}>
          <legend className="mb-1 font-medium">{t("kinds")}</legend>
          <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
            {PURGEABLE_PURPOSES.map((k) => (
              <Checkbox key={k} label={p(k)} checked={purgeKinds.includes(k)}
                onChange={(e) => (toggle(purgeKinds, setPurgeKinds, k, e.target.checked), purgeChecks.clear("purposes"), setPreview(null))} />
            ))}
          </div>
          {purgeChecks.error("purposes") && <FieldError id="purge-purposes-error">{purgeChecks.error("purposes")}</FieldError>}
        </fieldset>
        <Field label={t("purgeBefore")} error={purgeChecks.error("before")} className="max-w-xs">
          {(a) => (
            <Input {...a} type="date" value={purgeBefore} onChange={(e) => (setPurgeBefore(e.target.value), purgeChecks.clear("before"), setPreview(null))} />
          )}
        </Field>
        <Button variant="secondary" className="self-start" disabled={previewMut.isPending} onClick={() => previewMut.mutate()}>
          <ScanSearch aria-hidden />
          {t("preview")}
        </Button>
        {preview && (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>{t("kind")}</TH>
                  <TH className="text-right">{t("ready")}</TH>
                  <TH className="text-right">{t("blocked")}</TH>
                </tr>
              </THead>
              <tbody>
                {preview.length === 0 && <EmptyRow colSpan={3}>{t("nothingToPurge")}</EmptyRow>}
                {preview.map((r) => (
                  <TR key={r.purpose}>
                    <TD>{p(r.purpose)}</TD>
                    <TD className="text-right tabular-nums">{t("filesAndSize", { n: r.ready_files, size: formatBytes(r.ready_bytes) })}</TD>
                    <TD className="text-right tabular-nums">{t("filesAndSize", { n: r.blocked_files, size: formatBytes(r.blocked_bytes) })}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {preview.some((r) => Number(r.blocked_files) > 0) && <p className="text-text-secondary">{t("blockedHint")}</p>}
            <Button variant="danger" className="self-start" disabled={ready === 0} onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              {t("purge", { n: ready })}
            </Button>
          </>
        )}
      </Card>

      {o && o.batches.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("history")}</h2>
          <Table>
            <THead>
              <tr>
                <TH>{t("when")}</TH>
                <TH>{t("what")}</TH>
                <TH>{t("state")}</TH>
                <TH className="text-right">{t("files")}</TH>
                <TH>{t("by")}</TH>
              </tr>
            </THead>
            <tbody>
              {o.batches.map((b) => (
                <TR key={b.id}>
                  <TD>{formatDateTime(new Date(b.started_at))}</TD>
                  <TD>{b.kind === "database" ? t("kindDatabase") : (b.scope.purposes ?? []).map((k) => p(k)).join(", ")}</TD>
                  <TD>{t(`status.${b.status}`)}{b.failed_items > 0 ? ` · ${t("failedN", { n: b.failed_items })}` : ""}</TD>
                  <TD className="text-right tabular-nums">
                    {b.kind === "database" ? b.total_items : `${b.done_items} / ${b.total_items}`} · {formatBytes(b.kind === "database" ? b.total_bytes : b.done_bytes)}
                  </TD>
                  <TD>{b.by ?? "—"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <Dialog open={confirming} onOpenChange={(v) => !purge.isPending && setConfirming(v)}>
        {confirming && (
          <DialogContent
            title={t("confirmTitle", { n: ready })}
            description={t("confirmHint")}
            footer={
              <Button variant="danger" disabled={purge.isPending} onClick={() => purge.mutate()}>
                <Trash2 aria-hidden />
                {purge.isPending ? t("purging", { n: purged ?? 0 }) : t("purge", { n: ready })}
              </Button>
            }
          >
            <p>{t("confirmBody")}</p>
          </DialogContent>
        )}
      </Dialog>
    </Page>
  );
}
