/**
 * Finds the page in a photo (edge detection for "straighten"). Small and dependency-free
 * instead of OpenCV (~8 MB): on a 360-px copy, the photo is split into paper and
 * background by brightness (Otsu's threshold, trying "paper is lighter" and "paper is
 * darker"), the biggest region is kept with its holes (the writing) filled in, and its
 * four outermost corners become the page outline. The outline is used only if it really
 * looks like a page; otherwise null, and the photo is kept as it is.
 * Staff can always move the corners by hand.
 */
import { boxBlur, fitSide, isConvex, quadArea, toGrey, type Pixels, type Point, type Quad } from "./pixels";

const WORK_SIDE = 360;

export function otsu(grey: ArrayLike<number>): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[Math.round(grey[i]!)]!++;
  const total = grey.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!;
  let wB = 0, sumB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Biggest 4-connected region of mask = 1; returns its pixels as 1 in a new mask. */
function largestRegion(mask: Uint8Array, w: number, h: number): { region: Uint8Array; size: number } {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestLabel = 0, bestSize = 0, next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top]!;
      size++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of neighbours) {
        if (n >= 0 && n < mask.length && mask[n] && !label[n]) {
          label[n] = next;
          stack[top++] = n;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  const region = new Uint8Array(w * h);
  for (let i = 0; i < region.length; i++) region[i] = label[i] === bestLabel && bestLabel > 0 ? 1 : 0;
  return { region, size: bestSize };
}

/** The region plus every hole inside it (whatever the image border can't reach). */
function fillHoles(region: Uint8Array, w: number, h: number): { filled: Uint8Array; size: number } {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (i: number) => {
    if (!region[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top) {
    const i = stack[--top]!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i - w >= 0) push(i - w);
    if (i + w < w * h) push(i + w);
  }
  const filled = new Uint8Array(w * h);
  let size = 0;
  for (let i = 0; i < filled.length; i++) {
    if (outside[i]) continue;
    filled[i] = 1;
    size++;
  }
  return { filled, size };
}

function cornersOf(region: Uint8Array, w: number, h: number): Quad {
  let tl = { s: Infinity, p: { x: 0, y: 0 } }, br = { s: -Infinity, p: { x: 0, y: 0 } };
  let tr = { s: -Infinity, p: { x: 0, y: 0 } }, bl = { s: -Infinity, p: { x: 0, y: 0 } };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      if (x + y < tl.s) tl = { s: x + y, p: { x, y } };
      if (x + y > br.s) br = { s: x + y, p: { x: x + 1, y: y + 1 } };
      if (x - y > tr.s) tr = { s: x - y, p: { x: x + 1, y } };
      if (y - x > bl.s) bl = { s: y - x, p: { x, y: y + 1 } };
    }
  }
  return [tl.p, tr.p, br.p, bl.p];
}

interface Candidate {
  quad: Quad;
  score: number;
}

function insideConvex(q: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function candidate(mask: Uint8Array, grey: Float32Array, w: number, h: number): Candidate | null {
  const { region, size } = largestRegion(mask, w, h);
  if (size < w * h * 0.12) return null;
  const { filled } = fillHoles(region, w, h);
  const quad = cornersOf(filled, w, h);
  const area = quadArea(quad);
  if (!isConvex(quad) || area < w * h * 0.15) return null;
  // The whole frame is "paper" (flatbed scan, or a close-up): nothing to crop.
  if (area > w * h * 0.95) return null;
  // A page fills its outline exactly (overlap ≥ 90 %), and stands out from what is
  // around it. A blob, a shadow, a cluttered desk or plain noise does not.
  let both = 0, either = 0, inSum = 0, inN = 0, outSum = 0, outN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const q = insideConvex(quad, x + 0.5, y + 0.5);
      if (q && filled[i]) both++;
      if (q || filled[i]) either++;
      if (q) {
        inSum += grey[i]!;
        inN++;
      } else {
        outSum += grey[i]!;
        outN++;
      }
    }
  }
  const overlap = both / Math.max(1, either);
  const contrast = outN ? Math.abs(inSum / inN - outSum / outN) : 0;
  if (overlap < 0.9 || contrast < 40) return null;
  return { quad, score: overlap * Math.min(1, area / (w * h * 0.4)) };
}

export function detectDocument(src: Pixels): Quad | null {
  const small = fitSide(src, WORK_SIDE);
  const { width: w, height: h } = small;
  const grey = boxBlur(toGrey(small), w, h, 2);
  const t = otsu(grey);
  const light = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < grey.length; i++) {
    light[i] = grey[i]! > t ? 1 : 0;
    dark[i] = 1 - light[i]!;
  }
  const best = [candidate(light, grey, w, h), candidate(dark, grey, w, h)]
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const fx = src.width / w;
  const fy = src.height / h;
  return best.quad.map((p: Point) => ({ x: p.x * fx, y: p.y * fy })) as Quad;
}

/** The whole photo as an outline (for "Use whole photo" and as the editor's start). */
export function fullFrame(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}
