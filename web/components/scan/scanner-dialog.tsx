"use client";

import {
  ArrowLeft, ArrowRight, Camera, CircleAlert, Contrast, Crop, FileText, FileUp, FolderInput, LoaderCircle, RotateCw, Save,
  Smartphone, Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { istDateString } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { callFunction, rpc } from "@/lib/rpc";
import { warmUp } from "@/lib/scan/browser";
import { SCAN } from "@/lib/scan/config";
import { loadPdfLib } from "@/lib/scan/pdf";
import { buildDocument, pageTotal, preparePage, releasePage, updatePage, type ImagePage, type PageOrigin, type ScanPage } from "@/lib/scan/pages";
import type { PageSettings } from "@/lib/scan/process";
import { enqueue } from "@/lib/upload-queue";
import { documentSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { cn } from "@/lib/utils";
import { CameraPanel } from "./camera-panel";
import { FolderPanel } from "./folder-panel";
import { PageEditor } from "./page-editor";
import { PhonePanel, type PhoneSession } from "./phone-panel";

type Source = "camera" | "upload" | "phone" | "folder";
const SOURCES: { key: Source; icon: typeof Camera }[] = [
  { key: "camera", icon: Camera },
  { key: "upload", icon: FileUp },
  { key: "phone", icon: Smartphone },
  { key: "folder", icon: FolderInput },
];

/**
 * The scanner (PLAN.md E3 phase 8): pages from the camera, files (photos, PDFs, HEIC
 * where the browser can open it), a phone (QR) or the scanner's folder. Each photo is
 * straightened, cleaned up ("document mode") and compressed in the browser; several
 * pages become one PDF. Saving puts the document in the upload queue, so it is kept
 * even without internet and uploads by itself later.
 */
export function ScannerDialog({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const t = useTranslations("scan");
  const { saved, failed, errorMessage } = useFeedback();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  // Phone and folder keep working in the background once opened (pages keep arriving).
  const [opened, setOpened] = useState<Set<Source>>(() => new Set());
  const [editing, setEditing] = useState<ImagePage | null>(null);
  const [kind, setKind] = useState<LibraryItem | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => istDateString(new Date()));
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<PhoneSession | null>(null);
  const [received] = useState(() => new Set<string>()); // stable: phone page files already taken
  const upload = useRef<HTMLInputElement>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pagesRef = useRef(pages);
  const sessionRef = useRef(session);
  const savedRef = useRef(false);
  useEffect(() => {
    pagesRef.current = pages;
    sessionRef.current = session;
  }, [pages, session]);

  // Load what saving needs now, so a scan can still be saved if the internet drops.
  useEffect(() => {
    void loadPdfLib().catch(() => {});
    warmUp();
  }, []);

  // Closing without saving: the phone link stops working and its pages are deleted.
  useEffect(
    () => () => {
      for (const p of pagesRef.current) releasePage(p);
      if (savedRef.current) return;
      const s = sessionRef.current;
      if (s) void rpc("close_phone_scan", { p_session_id: s.sessionId }).catch(() => {});
      if (received.size) void callFunction("files-sign", { op: "discard", file_ids: [...received] }).catch(() => {});
    },
    [received],
  );

  /** Pages are prepared one after another (memory: a photo is big while it is decoded). */
  const addFiles = useCallback(
    (files: Blob[], origin: PageOrigin, remoteFileId?: string) => {
      for (const file of files) {
        setBusy((n) => n + 1);
        chain.current = chain.current.then(async () => {
          try {
            if (pagesRef.current.length >= SCAN.maxPages) throw new Error("too_many_pages");
            const name = file instanceof File ? file.name : "";
            const page = await preparePage(file, origin, name, remoteFileId);
            // Same file already saved for this patient? Warn now (best effort; checked again on save).
            if (origin === "upload" || origin === "folder") {
              const dup = await rpc<{ title: string } | null>("find_duplicate_document", {
                p_patient_id: patientId,
                p_sha256: [page.sourceSha],
              }).catch(() => null);
              page.duplicateOf = dup?.title ?? null;
            }
            setPages((list) => {
              const next = [...list, page];
              pagesRef.current = next;
              return next;
            });
            setDuplicate(null);
          } catch (e) {
            const name = file instanceof File && file.name ? `${file.name}: ` : "";
            toast.error(`${name}${errorMessage(e)}`);
          } finally {
            setBusy((n) => n - 1);
          }
        });
      }
    },
    [errorMessage, patientId],
  );

  const onPhonePage = useCallback(
    (photo: Blob, fileId: string) => {
      if (received.has(fileId)) return;
      received.add(fileId);
      addFiles([photo], "phone", fileId);
    },
    [addFiles, received],
  );

  const change = async (page: ImagePage, settings: PageSettings) => {
    setBusy((n) => n + 1);
    try {
      const next = await updatePage(page, settings);
      setPages((list) => list.map((p) => (p.id === page.id ? next : p)));
    } catch (e) {
      failed(e);
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const move = (i: number, by: number) =>
    setPages((list) => {
      const next = [...list];
      const [p] = next.splice(i, 1);
      next.splice(i + by, 0, p!);
      return next;
    });
  const remove = (page: ScanPage) => {
    releasePage(page);
    setDuplicate(null);
    setPages((list) => list.filter((p) => p.id !== page.id));
  };

  const checks = useZodForm(documentSchema);
  const save = async (force: boolean) => {
    const doc = checks.validate({ title, date });
    if (!doc) return;
    setSaving(true);
    try {
      let checkLater = !force;
      if (!force && navigator.onLine) {
        try {
          const dup = await rpc<{ title: string } | null>("find_duplicate_document", {
            p_patient_id: patientId,
            p_sha256: [...new Set(pages.map((p) => p.sourceSha))],
          });
          if (dup) {
            setDuplicate(dup.title);
            return;
          }
          checkLater = false;
        } catch {
          // no connection after all: the upload queue checks before uploading
        }
      }
      const built = await buildDocument(pages, [...received]);
      await enqueue({
        patientId,
        title: doc.title || kind?.label || t("defaultTitle"),
        kindId: kind?.id ?? null,
        docDate: doc.date,
        pageCount: built.pageCount,
        file: built.file,
        reuseFileId: built.reuseFileId,
        thumb: built.thumb,
        sourceSha256: built.sourceSha256,
        discardFileIds: built.discardFileIds,
        scanSessionId: session?.sessionId ?? null,
        checkDuplicate: checkLater,
      });
      savedRef.current = true;
      if (session) void rpc("close_phone_scan", { p_session_id: session.sessionId }).catch(() => {});
      saved(navigator.onLine ? t("savedUploading") : t("savedOffline"));
      onDone();
    } catch (e) {
      failed(e);
    } finally {
      setSaving(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    addFiles([...e.dataTransfer.files], "upload");
  };

  const total = pageTotal(pages);
  return (
    <DialogContent
      wide
      className="max-w-5xl"
      title={t("title")}
      description={t("description")}
      // Pages are only in this window until saved: a stray click or Esc must not lose them.
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => pages.length > 0 && e.preventDefault()}
      footer={
        <Button disabled={pages.length === 0 || busy > 0 || saving} onClick={() => void save(duplicate !== null)}>
          {saving ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {saving ? t("saving") : duplicate ? t("saveAnyway") : t("save", { n: total })}
        </Button>
      }
    >
      <div className="flex flex-col gap-5" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div role="group" aria-label={t("sources")} className="flex flex-wrap gap-2">
          {SOURCES.map(({ key, icon: Icon }) => (
            <Button
              key={key}
              variant={source === key ? "secondary" : "ghost"}
              aria-pressed={source === key}
              className={cn(source === key && "ring-2 ring-ring")}
              onClick={() => {
                if (key === "upload") upload.current?.click();
                setSource(key);
                setOpened((o) => (o.has(key) ? o : new Set(o).add(key)));
              }}
            >
              <Icon aria-hidden />
              {t(`source.${key}`)}
            </Button>
          ))}
          <input
            ref={upload}
            type="file"
            multiple
            // A hint for the file picker only: the real type is checked from the file's content.
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("chooseFiles")}
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])], "upload");
              e.target.value = "";
            }}
          />
        </div>

        {source === "camera" && <CameraPanel onCapture={(photo) => addFiles([photo], "camera")} />}
        {source === "upload" && (
          <p className="text-text-secondary">{t("uploadHint", { mb: SCAN.docCapBytes / 1024 / 1024 })}</p>
        )}
        {opened.has("phone") && (
          <div hidden={source !== "phone"}>
            <PhonePanel patientId={patientId} session={session} onSession={setSession} received={received} onPage={onPhonePage} />
          </div>
        )}
        {opened.has("folder") && (
          <div hidden={source !== "folder"}>
            <FolderPanel onFile={(file) => addFiles([file], "folder")} />
          </div>
        )}

        <section aria-labelledby="scan-pages-title" className="flex flex-col gap-3">
          <h3 id="scan-pages-title" className="font-semibold">
            {t("pagesTitle", { n: total })}
          </h3>
          {pages.length === 0 && busy === 0 && <p className="text-text-secondary">{t("noPages")}</p>}
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pages.map((page, i) => (
              <PageCard
                key={page.id}
                page={page}
                index={i}
                count={pages.length}
                onMove={(by) => move(i, by)}
                onRemove={() => remove(page)}
                onRotate={() => page.kind === "image" && void change(page, { ...page.settings, rotation: (page.settings.rotation + 1) % 4 })}
                onMode={() =>
                  page.kind === "image" && void change(page, { ...page.settings, mode: page.settings.mode === "document" ? "colour" : "document" })
                }
                onAdjust={() => page.kind === "image" && setEditing(page)}
              />
            ))}
            {busy > 0 && (
              <li className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-text-secondary">
                <LoaderCircle aria-hidden className="size-6 animate-spin" />
                {t("preparing")}
              </li>
            )}
          </ol>
        </section>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("kind")}>{(a) => <LibraryCombobox {...a} kind="document_kind" allowCreate value={kind} onChange={setKind} />}</Field>
          <Field label={t("docTitle")} error={checks.error("title")}>
            {(a) => (
              <Input {...a} maxLength={200} value={title} placeholder={kind?.label ?? t("defaultTitle")} onChange={(e) => (setTitle(e.target.value), checks.clear("title"))} />
            )}
          </Field>
          <Field label={t("docDate")} error={checks.error("date")}>
            {(a) => <Input {...a} type="date" value={date} onChange={(e) => (setDate(e.target.value), checks.clear("date"))} />}
          </Field>
        </div>

        {duplicate && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-border bg-secondary p-3">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-status-warning" />
            {t("duplicate", { title: duplicate })}
          </p>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <PageEditor
            page={editing}
            onApply={(settings) => {
              const page = editing;
              setEditing(null);
              void change(page, settings);
            }}
          />
        )}
      </Dialog>
    </DialogContent>
  );
}

function PageCard({
  page, index, count, onMove, onRemove, onRotate, onMode, onAdjust,
}: {
  page: ScanPage;
  index: number;
  count: number;
  onMove: (by: number) => void;
  onRemove: () => void;
  onRotate: () => void;
  onMode: () => void;
  onAdjust: () => void;
}) {
  const t = useTranslations("scan");
  const n = index + 1;
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2">
      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl bg-muted">
        {page.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob URL)
          <img src={page.preview} alt={t("pageAlt", { n })} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-1 p-2 text-center">
            <FileText aria-hidden className="size-10 text-text-secondary" />
            <span className="text-[0.9rem] break-all">{page.name || t("pdf")}</span>
            <span className="text-[0.9rem] text-text-secondary">
              {page.pages === null ? t("pdfLocked") : t("pdfPages", { n: page.pages })}
            </span>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 rounded-full bg-background/85 px-2 text-[0.9rem] font-semibold tabular-nums">{n}</span>
      </div>
      {page.duplicateOf && <StatusBadge kind="warning" label={t("pageDuplicate", { title: page.duplicateOf })} />}
      {page.origin === "phone" && <span className="text-[0.9rem] text-text-secondary">{t("fromPhone")}</span>}
      <div className="flex flex-wrap gap-1">
        {page.kind === "image" && (
          <>
            <IconButton label={t("adjust", { n })} onClick={onAdjust} icon={<Crop aria-hidden />} />
            <IconButton label={t("rotate", { n })} onClick={onRotate} icon={<RotateCw aria-hidden />} />
            <IconButton
              label={page.settings.mode === "document" ? t("modeColour", { n }) : t("modeDocument", { n })}
              pressed={page.settings.mode === "document"}
              onClick={onMode}
              icon={<Contrast aria-hidden />}
            />
          </>
        )}
        <IconButton label={t("moveEarlier", { n })} onClick={() => onMove(-1)} disabled={index === 0} icon={<ArrowLeft aria-hidden />} />
        <IconButton label={t("moveLater", { n })} onClick={() => onMove(1)} disabled={index === count - 1} icon={<ArrowRight aria-hidden />} />
        <IconButton label={t("removePage", { n })} onClick={onRemove} icon={<Trash2 aria-hidden />} />
      </div>
    </li>
  );
}

/** Small page actions: icon buttons with their words in the tooltip and for screen readers. */
function IconButton({ label, icon, onClick, disabled, pressed }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  );
}
