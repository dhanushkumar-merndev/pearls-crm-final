/**
 * One page from photo to clean page: straighten (if an outline is set), turn, and
 * "document mode". Pure: the same code runs in the Web Worker and in tests.
 */
import { documentMode, fitSide, quadOutputSize, rotate, warp, type Pixels, type Quad } from "./pixels";

export type PageMode = "document" | "colour";

export interface PageSettings {
  /** Page outline in the decoded photo, or null to keep the whole photo. */
  quad: Quad | null;
  /** Quarter turns clockwise. */
  rotation: number;
  mode: PageMode;
}

export function processPage(src: Pixels, s: PageSettings, maxSide: number): Pixels {
  let img: Pixels;
  if (s.quad) {
    const size = quadOutputSize(s.quad, maxSide);
    img = warp(src, s.quad, size.width, size.height);
  } else {
    img = fitSide(src, maxSide);
  }
  if (s.rotation % 4) img = rotate(img, s.rotation);
  if (s.mode === "document") img = documentMode(img);
  return img;
}

/** A thrown scanning problem carries one of the app's error codes (errors.<code>). */
export class ScanError extends Error {
  constructor(code: "file_too_large" | "file_type_not_allowed" | "heic_not_supported" | "file_unreadable" | "too_many_pages") {
    super(code);
    this.name = "ScanError";
  }
}
