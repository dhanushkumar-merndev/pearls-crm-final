/**
 * Compression to a size cap: try good quality first and step it down; if the smallest
 * quality is still too big, shrink the page (by the ratio the last try suggests) and
 * try again — but never below a readable size. The encoder is passed in: the browser
 * uses a canvas (WebP or JPEG), the tests a plain JPEG encoder.
 */
import { scaleTo, type Pixels } from "./pixels";
import { ScanError } from "./process";

export type Encoder<T> = (img: Pixels, quality: number) => Promise<{ out: T; size: number }>;

export interface Fitted<T> {
  out: T;
  size: number;
  width: number;
  height: number;
  quality: number;
}

const QUALITIES = [0.82, 0.7, 0.58, 0.46];

export async function fitToCap<T>(
  img: Pixels,
  encode: Encoder<T>,
  capBytes: number,
  minSide: number,
): Promise<Fitted<T>> {
  let current = img;
  for (let round = 0; round < 8; round++) {
    let last = Infinity;
    for (const quality of QUALITIES) {
      const { out, size } = await encode(current, quality);
      if (size <= capBytes) return { out, size, width: current.width, height: current.height, quality };
      last = size;
      // Far too big: skip the remaining qualities and shrink straight away.
      if (size > capBytes * 2.5) break;
    }
    const long = Math.max(current.width, current.height);
    if (long <= minSide) break;
    // Bytes grow roughly with the pixel count; shrink a bit more than the estimate.
    const f = Math.min(0.85, Math.max(0.5, Math.sqrt(capBytes / last) * 0.95));
    const next = Math.max(minSide, Math.round(long * f));
    const g = next / long;
    current = scaleTo(current, current.width * g, current.height * g);
  }
  throw new ScanError("file_too_large");
}
