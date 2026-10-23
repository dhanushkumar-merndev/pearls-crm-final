/**
 * The real type of a file from its first bytes ("magic bytes"), never from its name or
 * the type the browser guessed from the extension. The server checks the same way
 * again after upload (supabase/functions/_shared/sniff.ts).
 */
export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/gif"
  | "image/bmp"
  | "image/tiff"
  | "application/pdf";

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

// HEIF family brands (iPhone photos are "heic"; "mif1"/"msf1" are generic HEIF).
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export function sniffBytes(b: Uint8Array): SniffedType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(b, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(b, 8, 12))) return "image/heic";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 2) === "BM") return "image/bmp";
  if ((ascii(b, 0, 2) === "II" && b[2] === 42 && b[3] === 0) || (ascii(b, 0, 2) === "MM" && b[2] === 0 && b[3] === 42)) {
    return "image/tiff";
  }
  return null;
}

export async function sniffBlob(blob: Blob): Promise<SniffedType | null> {
  return sniffBytes(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
}
