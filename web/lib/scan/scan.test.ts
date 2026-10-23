import * as jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SCAN } from "./config";
import { detectDocument } from "./detect";
import { fitToCap, type Encoder } from "./fit";
import { assemblePdf, inspectPdf } from "./pdf";
import { createPixels, documentMode, isConvex, rotate, toGrey, warp, type Pixels, type Quad } from "./pixels";
import { processPage } from "./process";
import { sniffBlob, sniffBytes } from "./sniff";

// ---------------------------------------------------------------------------------------
// Sample images, drawn in code (no real documents in the repo).
// ---------------------------------------------------------------------------------------
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function inside(q: Quad, x: number, y: number): boolean {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    if (s === 0) s = Math.sign(c);
    else if (Math.sign(c) !== s) return false;
  }
  return true;
}

/** A phone photo of a prescription on a wooden desk: tilted page, writing, a shadow, sensor noise. */
function deskPhoto(width: number, height: number, page: Quad, seed = 1): Pixels {
  const img = createPixels(width, height);
  const r = rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = (y * width + x) * 4;
      const noise = (r() - 0.5) * 24;
      let v: [number, number, number];
      if (inside(page, x, y)) {
        const shade = 235 - (60 * x) / width; // light falls off to the right
        const line = Math.floor(y / 40) % 3 === 0 && ((x * 7 + y * 3) % 23 < 9) ? 150 : 0; // handwriting-ish strokes
        v = [shade - line, shade - line, shade - line + 4];
      } else {
        const grain = 20 * Math.sin(x / 13 + Math.sin(y / 37) * 3);
        v = [110 + grain, 72 + grain / 2, 40];
      }
      img.data[j] = v[0] + noise;
      img.data[j + 1] = v[1] + noise;
      img.data[j + 2] = v[2] + noise;
      img.data[j + 3] = 255;
    }
  }
  return img;
}

/** The worst case for compression: pure colour noise. */
function noise(width: number, height: number): Pixels {
  const img = createPixels(width, height);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : r() * 255;
  return img;
}

const PAGE: Quad = [
  { x: 380, y: 210 },
  { x: 1500, y: 300 },
  { x: 1580, y: 1680 },
  { x: 300, y: 1590 },
];

const jpegEncoder: Encoder<Uint8Array> = async (img, quality) => {
  const out = jpeg.encode({ data: img.data, width: img.width, height: img.height }, Math.round(quality * 100)).data;
  return { out: new Uint8Array(out), size: out.length };
};

// ---------------------------------------------------------------------------------------

describe("real file type by content (magic bytes), not by name", () => {
  const bytes = (...parts: (number[] | string)[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(new Array(16).fill(0)));

  it("detects every type the scanner accepts", () => {
    expect(sniffBytes(bytes([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(sniffBytes(bytes([0x89], "PNG\r\n\x1a\n"))).toBe("image/png");
    expect(sniffBytes(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffBytes(bytes("%PDF-1.4"))).toBe("application/pdf");
    expect(sniffBytes(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("image/heic");
    expect(sniffBytes(bytes([0, 0, 0, 0x18], "ftypmif1"))).toBe("image/heic");
    expect(sniffBytes(bytes("II", [42, 0]))).toBe("image/tiff");
  });

  it("ignores the file name and the browser's guess", async () => {
    const pdfNamedJpg = new File([bytes("%PDF-1.7")], "prescription.jpg", { type: "image/jpeg" });
    expect(await sniffBlob(pdfNamedJpg)).toBe("application/pdf");
    const htmlNamedJpg = new File([bytes("<!doctype html><script>")], "scan.jpg", { type: "image/jpeg" });
    expect(await sniffBlob(htmlNamedJpg)).toBeNull();
    // An MP4 video is "ftyp" too, but not an image.
    expect(sniffBytes(bytes([0, 0, 0, 0x18], "ftypisom"))).toBeNull();
    expect(sniffBytes(new Uint8Array(4))).toBeNull();
  });
});

describe("edge detection and straightening", () => {
  const photo = deskPhoto(1920, 1920, PAGE);

  it("finds the four corners of a tilted page", () => {
    const found = detectDocument(photo);
    expect(found).not.toBeNull();
    expect(isConvex(found!)).toBe(true);
    for (let i = 0; i < 4; i++) {
      // within 2.5 % of the photo size
      expect(Math.abs(found![i]!.x - PAGE[i]!.x)).toBeLessThan(48);
      expect(Math.abs(found![i]!.y - PAGE[i]!.y)).toBeLessThan(48);
    }
  });

  it("keeps a photo with no clear page as it is", () => {
    expect(detectDocument(noise(800, 600))).toBeNull();
    // A flatbed scan: the page is the whole image.
    const scan = createPixels(600, 800);
    scan.data.fill(245);
    expect(detectDocument(scan)).toBeNull();
  });

  it("straightens the page into a rectangle of the page's shape", () => {
    const W = 560, H = 690;
    const grey = toGrey(warp(photo, PAGE, W, H));
    // Every edge of the output is paper now (light), not desk (dark ≈ 80).
    const band = (x0: number, x1: number, y0: number, y1: number) => {
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += grey[y * W + x]!;
      return sum / ((x1 - x0) * (y1 - y0));
    };
    expect(band(0, W, 2, 20)).toBeGreaterThan(150);
    expect(band(0, W, H - 20, H - 2)).toBeGreaterThan(150);
    expect(band(2, 20, 0, H)).toBeGreaterThan(150);
    expect(band(W - 20, W - 2, 0, H)).toBeGreaterThan(150);
  });

  it("turns pages a quarter at a time", () => {
    const img = createPixels(3, 2);
    img.data.set([255, 0, 0, 255], 0); // red top-left
    const once = rotate(img, 1);
    expect([once.width, once.height]).toEqual([2, 3]);
    expect(Array.from(once.data.subarray(4, 8))).toEqual([255, 0, 0, 255]); // now top-right
    expect(rotate(rotate(img, 1), 3).data).toEqual(img.data);
  });
});

describe("document mode", () => {
  it("makes the paper white and the writing dark, even in a shadow", () => {
    const page = warp(deskPhoto(1920, 1920, PAGE), PAGE, 560, 690);
    const clean = toGrey(documentMode(page));
    const before = toGrey(page);
    // A plain paper pixel in the shadowed (right) part of the page…
    let paper = -1;
    for (let i = before.length - 1; i > 0; i--) {
      if (i % 560 > 480 && before[i]! > 120) {
        paper = i;
        break;
      }
    }
    expect(before[paper]).toBeLessThan(215);
    expect(clean[paper]).toBeGreaterThanOrEqual(240);
    // …and the strokes stay dark.
    let darkest = 255;
    for (const v of clean) darkest = Math.min(darkest, v);
    expect(darkest).toBeLessThan(60);
  });
});

describe("compression to the size cap on sample images", () => {
  const samples: [string, Pixels][] = [
    ["desk photo, colour", processPage(deskPhoto(2400, 2400, PAGE.map((p) => ({ x: p.x * 1.25, y: p.y * 1.25 })) as Quad), { quad: null, rotation: 0, mode: "colour" }, SCAN.pageSide)],
    ["desk photo, straightened, document mode", processPage(deskPhoto(2400, 2400, PAGE.map((p) => ({ x: p.x * 1.25, y: p.y * 1.25 })) as Quad), { quad: PAGE.map((p) => ({ x: p.x * 1.25, y: p.y * 1.25 })) as Quad, rotation: 1, mode: "document" }, SCAN.pageSide)],
    ["worst case: colour noise 2000 px", noise(2000, 1500)],
  ];

  for (const [name, img] of samples) {
    it(`${name} → at most ${SCAN.pageTargetBytes / 1024} KB per page`, async () => {
      const fitted = await fitToCap(img, jpegEncoder, SCAN.pageTargetBytes, SCAN.minPageSide);
      expect(fitted.size).toBeLessThanOrEqual(SCAN.pageTargetBytes);
      expect(fitted.out.length).toBe(fitted.size);
      expect(sniffBytes(fitted.out)).toBe("image/jpeg");
      expect(Math.max(fitted.width, fitted.height)).toBeGreaterThanOrEqual(SCAN.minPageSide);
    });
  }

  it("thumbnails fit their 90 KB cap", async () => {
    const fitted = await fitToCap(noise(SCAN.thumbSide, 240), jpegEncoder, SCAN.thumbCapBytes, 120);
    expect(fitted.size).toBeLessThanOrEqual(SCAN.thumbCapBytes);
  });

  it("refuses rather than going below a readable size", async () => {
    await expect(fitToCap(noise(1200, 900), jpegEncoder, 2_000, SCAN.minPageSide)).rejects.toThrow("file_too_large");
  });
});

describe("multi-page PDF", () => {
  it("joins pages and uploaded PDFs in order, under the document cap", async () => {
    const page = processPage(deskPhoto(1200, 1200, PAGE.map((p) => ({ x: p.x * 0.6, y: p.y * 0.6 })) as Quad), { quad: null, rotation: 0, mode: "document" }, 1600);
    const jpg = await fitToCap(page, jpegEncoder, 300 * 1024, SCAN.minPageSide);
    const uploaded = await PDFDocument.create();
    uploaded.addPage();
    uploaded.addPage();
    const parts = [
      { kind: "jpeg" as const, bytes: jpg.out, width: jpg.width, height: jpg.height },
      { kind: "pdf" as const, bytes: await uploaded.save() },
      { kind: "jpeg" as const, bytes: jpg.out, width: jpg.width, height: jpg.height },
    ];
    const pdf = await assemblePdf(parts);
    expect(sniffBytes(pdf)).toBe("application/pdf");
    expect(pdf.length).toBeLessThanOrEqual(SCAN.docCapBytes);
    expect(await inspectPdf(pdf)).toEqual({ pages: 4, encrypted: false });
  });

  it("an unreadable PDF is not merged", async () => {
    expect(await inspectPdf(new TextEncoder().encode("%PDF-1.4 not really"))).toEqual({ pages: null, encrypted: true });
  });
});
