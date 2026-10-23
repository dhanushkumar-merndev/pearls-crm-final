/**
 * The scanner's pages, from any source (camera, upload, scanner folder, phone), and how
 * they become ONE saved document: a single image, or a multi-page PDF, plus a thumbnail.
 */
import { sha256Hex } from "@/lib/upload";
import { bestImageMime, compressImage, decodeImage, detectInBackground, encodeImage, processInBackground } from "./browser";
import { SCAN } from "./config";
import { assemblePdf, inspectPdf, type PdfPart } from "./pdf";
import { fitSide, type Quad } from "./pixels";
import { ScanError, type PageSettings } from "./process";
import { sniffBlob, type SniffedType } from "./sniff";

export type PageOrigin = "camera" | "upload" | "folder" | "phone";

interface PageBase {
  id: string;
  origin: PageOrigin;
  name: string;
  source: Blob;
  /** SHA-256 of the file exactly as it came in (for the duplicate warning). */
  sourceSha: string;
  /** The page file a phone uploaded (kept as is when nothing was changed). */
  remoteFileId?: string;
  duplicateOf?: string | null;
}
export interface ImagePage extends PageBase {
  kind: "image";
  type: SniffedType;
  srcWidth: number;
  srcHeight: number;
  detected: Quad | null;
  settings: PageSettings;
  edited: boolean;
  /** Cleaned page as a high-quality JPEG (preview, and the input of the final compression). */
  master: Blob;
  preview: string;
  outWidth: number;
  outHeight: number;
}
export interface PdfPage extends PageBase {
  kind: "pdf";
  pages: number | null;
  encrypted: boolean;
}
export type ScanPage = ImagePage | PdfPage;

/** Pages counted as the document's page count (a PDF counts its own pages). */
export function pageTotal(pages: ScanPage[]): number {
  return pages.reduce((n, p) => n + (p.kind === "pdf" ? (p.pages ?? 1) : 1), 0);
}

async function render(page: Omit<ImagePage, "master" | "preview" | "outWidth" | "outHeight">, decoded?: Awaited<ReturnType<typeof decodeImage>>) {
  const src = decoded ?? (await decodeImage(page.source, SCAN.decodeSide, page.type));
  const out = await processInBackground(src, page.settings);
  const master = await encodeImage(out, "image/jpeg", 0.92);
  return { ...page, master, preview: URL.createObjectURL(master), outWidth: out.width, outHeight: out.height };
}

/** A new page from a file or photo: type checked by content, page found, cleaned up. */
export async function preparePage(file: Blob, origin: PageOrigin, name: string, remoteFileId?: string): Promise<ScanPage> {
  const type = await sniffBlob(file);
  if (!type) throw new ScanError("file_type_not_allowed");
  const base = { id: crypto.randomUUID(), origin, name, source: file, sourceSha: await sha256Hex(file), remoteFileId, duplicateOf: null };
  if (type === "application/pdf") {
    if (file.size > SCAN.docCapBytes) throw new ScanError("file_too_large");
    return { ...base, kind: "pdf", ...(await inspectPdf(new Uint8Array(await file.arrayBuffer()))) };
  }
  const decoded = await decodeImage(file, SCAN.decodeSide, type);
  // Phone pages were already straightened and cleaned on the phone.
  const detected = origin === "phone" ? null : await detectInBackground(decoded);
  return render(
    {
      ...base,
      kind: "image",
      type,
      srcWidth: decoded.width,
      srcHeight: decoded.height,
      detected,
      settings: { quad: detected, rotation: 0, mode: origin === "phone" ? "colour" : "document" },
      edited: false,
    },
    decoded,
  );
}

/** Same page with new settings (turned, corners moved, document mode on/off). */
export async function updatePage(page: ImagePage, settings: PageSettings): Promise<ImagePage> {
  const next = await render({ ...page, settings, edited: true });
  URL.revokeObjectURL(page.preview);
  return next;
}

export function releasePage(page: ScanPage) {
  if (page.kind === "image") URL.revokeObjectURL(page.preview);
}

export interface BuiltDocument {
  /** null when a single unchanged phone page is kept as it is (reuseFileId). */
  file: Blob | null;
  reuseFileId: string | null;
  mime: string;
  pageCount: number;
  thumb: Blob | null;
  sourceSha256: string[];
  /** Phone page files that are not part of the saved document any more. */
  discardFileIds: string[];
}

async function thumbnail(page: ImagePage): Promise<Blob | null> {
  try {
    const small = fitSide(await decodeImage(page.master, SCAN.thumbSide * 2, "image/jpeg"), SCAN.thumbSide);
    return (await compressImage(small, SCAN.thumbCapBytes, await bestImageMime(), 120)).out;
  } catch {
    return null; // a document without a preview picture is still a document
  }
}

/** Turns the pages into the one file that is uploaded (all in the browser, works offline). */
export async function buildDocument(pages: ScanPage[], phonePageIds: string[]): Promise<BuiltDocument> {
  if (pages.length === 0) throw new ScanError("file_unreadable");
  if (pages.length > SCAN.maxPages) throw new ScanError("too_many_pages");
  const firstImage = pages.find((p): p is ImagePage => p.kind === "image");
  const thumb = firstImage ? await thumbnail(firstImage) : null;
  const sourceSha256 = [...new Set(pages.map((p) => p.sourceSha))];
  const used = new Set<string>();
  let file: Blob | null = null;
  let reuseFileId: string | null = null;
  let mime: string;

  const only = pages.length === 1 ? pages[0]! : null;
  if (only?.kind === "pdf") {
    file = only.source;
    mime = "application/pdf";
  } else if (only?.kind === "image") {
    if (only.remoteFileId && !only.edited) {
      reuseFileId = only.remoteFileId;
      used.add(only.remoteFileId);
      mime = only.type;
    } else {
      const best = await bestImageMime();
      const img = await decodeImage(only.master, SCAN.pageSide, "image/jpeg");
      file = (await compressImage(img, Math.min(SCAN.pageTargetBytes, SCAN.docCapBytes), best)).out;
      mime = best;
    }
  } else {
    if (pages.some((p) => p.kind === "pdf" && (p.encrypted || p.pages === null))) throw new ScanError("file_unreadable");
    const pdfBytes = pages.reduce((n, p) => n + (p.kind === "pdf" ? p.source.size : 0), 0);
    const images = pages.filter((p) => p.kind === "image").length;
    const budget = Math.min(SCAN.pageTargetBytes, Math.floor((SCAN.docCapBytes - SCAN.pdfOverheadBytes - pdfBytes) / Math.max(1, images)));
    if (budget < 60 * 1024) throw new ScanError("file_too_large");
    const parts: PdfPart[] = [];
    for (const p of pages) {
      if (p.kind === "pdf") {
        parts.push({ kind: "pdf", bytes: new Uint8Array(await p.source.arrayBuffer()) });
        continue;
      }
      const img = await decodeImage(p.master, SCAN.pageSide, "image/jpeg");
      const fitted = await compressImage(img, budget, "image/jpeg");
      parts.push({ kind: "jpeg", bytes: new Uint8Array(await fitted.out.arrayBuffer()), width: fitted.width, height: fitted.height });
    }
    const pdf = await assemblePdf(parts);
    if (pdf.length > SCAN.docCapBytes) throw new ScanError("file_too_large");
    file = new Blob([pdf as BlobPart], { type: "application/pdf" });
    mime = "application/pdf";
  }
  return {
    file,
    reuseFileId,
    mime,
    pageCount: Math.min(200, pageTotal(pages)), // documents.page_count allows 1–200
    thumb,
    sourceSha256,
    discardFileIds: phonePageIds.filter((id) => !used.has(id)),
  };
}
