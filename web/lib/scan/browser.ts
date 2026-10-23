/**
 * Browser side of scanning: decode a photo into pixels, encode pixels back to WebP or
 * JPEG with a canvas, and run the heavy pixel work in a Web Worker (main thread if the
 * browser can't start one). HEIC (iPhone photos) opens only where the browser itself
 * can decode it (Safari); elsewhere the person is asked to send a JPEG instead.
 */
import { SCAN } from "./config";
import { detectDocument } from "./detect";
import { fitToCap, type Encoder, type Fitted } from "./fit";
import type { Pixels, Quad } from "./pixels";
import { processPage, ScanError, type PageSettings } from "./process";
import { sniffBlob, type SniffedType } from "./sniff";

export type ImageMime = "image/webp" | "image/jpeg";

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Decodes an image file (checked by content) into pixels, longest side ≤ maxSide. */
export async function decodeImage(blob: Blob, maxSide: number = SCAN.decodeSide, type?: SniffedType | null): Promise<Pixels> {
  const kind = type === undefined ? await sniffBlob(blob) : type;
  if (!kind || kind === "application/pdf") throw new ScanError("file_type_not_allowed");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new ScanError(kind === "image/heic" ? "heic_not_supported" : "file_unreadable");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = canvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const data = ctx.getImageData(0, 0, c.width, c.height);
  return { width: data.width, height: data.height, data: data.data };
}

function toBlob(c: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, mime, quality));
}

let webp: boolean | null = null;
/** Safari can't encode WebP (it hands back PNG); then JPEG is used. */
export async function canEncodeWebp(): Promise<boolean> {
  if (webp === null) webp = (await toBlob(canvas(2, 2), "image/webp", 0.8))?.type === "image/webp";
  return webp;
}

export async function encodeImage(img: Pixels, mime: ImageMime, quality: number): Promise<Blob> {
  const c = canvas(img.width, img.height);
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const blob = await toBlob(c, mime, quality);
  if (!blob || blob.type !== mime) throw new ScanError("file_unreadable");
  return blob;
}

export function canvasEncoder(mime: ImageMime): Encoder<Blob> {
  return async (img, quality) => {
    const out = await encodeImage(img, mime, quality);
    return { out, size: out.size };
  };
}

/** Best format this browser can make: WebP (smaller) or JPEG. */
export async function bestImageMime(): Promise<ImageMime> {
  return (await canEncodeWebp()) ? "image/webp" : "image/jpeg";
}

export async function compressImage(img: Pixels, capBytes: number, mime: ImageMime, minSide: number = SCAN.minPageSide): Promise<Fitted<Blob>> {
  return fitToCap(img, canvasEncoder(mime), capBytes, minSide);
}

// ---------------------------------------------------------------------------------------
// Worker (with a main-thread fallback)
// ---------------------------------------------------------------------------------------
type Job = { op: "detect"; pixels: Pixels } | { op: "process"; pixels: Pixels; settings: PageSettings; maxSide: number };

let worker: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (e.data.error) w?.reject(new Error(e.data.error));
      else w?.resolve(e.data.result);
    };
    worker.onerror = () => {
      // The worker could not start (old browser, blocked): fall back for good.
      for (const w of waiting.values()) w.reject(new Error("worker_failed"));
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function runInline(job: Job): unknown {
  return job.op === "detect" ? detectDocument(job.pixels) : processPage(job.pixels, job.settings, job.maxSide);
}

async function run<T>(job: Job): Promise<T> {
  const w = getWorker();
  if (!w) return runInline(job) as T;
  // The pixels are copied to the worker (the caller keeps its own).
  const copy = { ...job, pixels: { ...job.pixels, data: new Uint8ClampedArray(job.pixels.data) } };
  try {
    return await new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, job: copy }, [copy.pixels.data.buffer]);
    });
  } catch {
    return runInline(job) as T;
  }
}

/** Starts the worker and the WebP check early (the scanner opens → saving later works offline). */
export function warmUp() {
  getWorker();
  void canEncodeWebp();
}

export const detectInBackground = (pixels: Pixels) => run<Quad | null>({ op: "detect", pixels });
export const processInBackground = (pixels: Pixels, settings: PageSettings, maxSide: number = SCAN.pageSide) =>
  run<Pixels>({ op: "process", pixels, settings, maxSide });
