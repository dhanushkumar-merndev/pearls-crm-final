/**
 * Multi-page PDF assembly with pdf-lib (MIT, pinned, loaded only when needed).
 * Image pages are embedded as JPEG on an A4-wide page with their own aspect ratio;
 * uploaded PDFs are copied in page by page.
 */
type PdfLib = typeof import("pdf-lib");

export type PdfPart =
  | { kind: "jpeg"; bytes: Uint8Array; width: number; height: number }
  | { kind: "pdf"; bytes: Uint8Array };

const A4_WIDTH_PT = 595.28;

let lib: Promise<PdfLib> | null = null;
/** Starts loading pdf-lib (call when the scanner opens, so saving works offline). */
export function loadPdfLib(): Promise<PdfLib> {
  lib ??= import("pdf-lib");
  return lib;
}

export async function assemblePdf(parts: PdfPart[]): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer("Pearl CRM");
  doc.setCreator("Pearl CRM");
  for (const part of parts) {
    if (part.kind === "jpeg") {
      const image = await doc.embedJpg(part.bytes);
      const height = (A4_WIDTH_PT * part.height) / part.width;
      doc.addPage([A4_WIDTH_PT, height]).drawImage(image, { x: 0, y: 0, width: A4_WIDTH_PT, height });
    } else {
      const src = await PDFDocument.load(part.bytes);
      for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
    }
  }
  return doc.save({ useObjectStreams: true });
}

/** Pages in an uploaded PDF, and whether it is password-protected (then it can't be merged). */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pages: number | null; encrypted: boolean }> {
  const { PDFDocument } = await loadPdfLib();
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pages: doc.getPageCount(), encrypted: doc.isEncrypted };
  } catch {
    return { pages: null, encrypted: true };
  }
}
