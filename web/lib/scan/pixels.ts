/**
 * Plain-array image maths for scanning: no canvas, no DOM, so it runs in a Web Worker,
 * on the main thread or in Node tests alike. Images are RGBA, 8 bits per channel.
 */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface Point {
  x: number;
  y: number;
}
/** Corners of a page in the photo: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export function createPixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Luma (Rec. 601) per pixel. */
export function toGrey(src: Pixels): Uint8Array {
  const out = new Uint8Array(src.width * src.height);
  const d = src.data;
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (d[j]! * 299 + d[j + 1]! * 587 + d[j + 2]! * 114 + 500) / 1000;
  return out;
}

/** Shrinks by averaging every source pixel that falls into each output pixel (no aliasing). */
export function scaleTo(src: Pixels, width: number, height: number): Pixels {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === src.width && height === src.height) return src;
  if (width > src.width || height > src.height) return bilinear(src, width, height);
  const out = createPixels(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const s = src.data;
  const o = out.data;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        let k = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, k += 4) {
          r += s[k]!;
          g += s[k + 1]!;
          b += s[k + 2]!;
          a += s[k + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const j = (y * width + x) * 4;
      o[j] = r / n;
      o[j + 1] = g / n;
      o[j + 2] = b / n;
      o[j + 3] = a / n;
    }
  }
  return out;
}

function bilinear(src: Pixels, width: number, height: number): Pixels {
  const out = createPixels(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, out.data, (y * width + x) * 4);
  }
  return out;
}

/** Longest side at most maxSide, aspect kept. */
export function fitSide(src: Pixels, maxSide: number): Pixels {
  const long = Math.max(src.width, src.height);
  if (long <= maxSide) return src;
  const f = maxSide / long;
  return scaleTo(src, src.width * f, src.height * f);
}

/** Bilinear sample at (x, y) into out[j..j+3]; outside the image the edge pixel is used. */
function sample(src: Pixels, x: number, y: number, out: Uint8ClampedArray, j: number) {
  const w = src.width;
  const h = src.height;
  x = Math.min(Math.max(x, 0), w - 1);
  y = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = src.data;
  const a = (y0 * w + x0) * 4;
  const b = (y0 * w + x1) * 4;
  const c = (y1 * w + x0) * 4;
  const e = (y1 * w + x1) * 4;
  for (let ch = 0; ch < 4; ch++) {
    const top = d[a + ch]! + (d[b + ch]! - d[a + ch]!) * fx;
    const bottom = d[c + ch]! + (d[e + ch]! - d[c + ch]!) * fx;
    out[j + ch] = top + (bottom - top) * fy;
  }
}

/** Quarter turns clockwise (1 = 90°). */
export function rotate(src: Pixels, quarterTurns: number): Pixels {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return src;
  const { width: w, height: h } = src;
  const out = createPixels(turns === 2 ? w : h, turns === 2 ? h : w);
  const s32 = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h);
  const o32 = new Uint32Array(out.data.buffer);
  const ow = out.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = s32[y * w + x]!;
      if (turns === 1) o32[x * ow + (h - 1 - y)] = v;
      else if (turns === 2) o32[(h - 1 - y) * ow + (w - 1 - x)] = v;
      else o32[(w - 1 - x) * ow + y] = v;
    }
  }
  return out;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The straightened page's size: its longest edges, shrunk to maxSide. */
export function quadOutputSize(q: Quad, maxSide: number): { width: number; height: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const f = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)) };
}

export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** True when the four corners go round in one direction with no crossing. */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Perspective straightening: maps the output rectangle onto the page's four corners in
 * the photo (projective square-to-quad mapping, Heckbert 1989) and samples bilinearly.
 */
export function warp(src: Pixels, q: Quad, width: number, height: number): Pixels {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
  const out = createPixels(width, height);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const z = g * u + h * v + 1;
      sample(src, (a * u + b * v + c) / z - 0.5, (d * u + e * v + f) / z - 0.5, out.data, (y * width + x) * 4);
    }
  }
  return out;
}

/** Mean of every r×r box around each pixel (summed-area table: same cost for any r). */
export function boxBlur(grey: Uint8Array | Float32Array, width: number, height: number, r: number): Float32Array {
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x]!;
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
      const sum = sat[y1 * (width + 1) + x1]! - sat[y0 * (width + 1) + x1]! - sat[y1 * (width + 1) + x0]! + sat[y0 * (width + 1) + x0]!;
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * "Document mode": greyscale with the paper made white and the ink dark. The paper's
 * brightness is estimated at low resolution (brightest pixel per block, which ignores
 * thin ink strokes, then blurred), each pixel is divided by it — this removes shadows
 * and uneven light — and the result is contrast-stretched.
 */
export function documentMode(src: Pixels): Pixels {
  const { width: w, height: h } = src;
  const grey = toGrey(src);
  const block = Math.max(4, Math.round(Math.max(w, h) / 120));
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
  const maxes = new Float32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < w; x++) {
      const k = by * bw + Math.floor(x / block);
      const v = grey[y * w + x]!;
      if (v > maxes[k]!) maxes[k] = v;
    }
  }
  const bg = boxBlur(maxes, bw, bh, 2);
  const out = createPixels(w, h);
  const norm = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) / block - 0.5, 0), bh - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, bh - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) / block - 0.5, 0), bw - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, bw - 1), tx = fx - x0;
      const top = bg[y0 * bw + x0]! + (bg[y0 * bw + x1]! - bg[y0 * bw + x0]!) * tx;
      const bottom = bg[y1 * bw + x0]! + (bg[y1 * bw + x1]! - bg[y1 * bw + x0]!) * tx;
      const paper = Math.max(top + (bottom - top) * ty, 24);
      const v = Math.min(255, (grey[y * w + x]! / paper) * 255);
      norm[y * w + x] = v;
      hist[v | 0]!++;
    }
  }
  // Darkest 1 % → black; anything within ~8 % of the paper → white.
  let lo = 0;
  for (let acc = 0, target = w * h * 0.01; lo < 255 && acc + hist[lo]! < target; lo++) acc += hist[lo]!;
  const hi = 235;
  const span = Math.max(1, hi - Math.min(lo, hi - 1));
  for (let i = 0, j = 0; i < norm.length; i++, j += 4) {
    const t = Math.min(1, Math.max(0, (norm[i]! - lo) / span));
    const v = 255 * Math.pow(t, 1.4); // a little darker mid-tones: faint pencil stays readable
    out.data[j] = out.data[j + 1] = out.data[j + 2] = v;
    out.data[j + 3] = 255;
  }
  return out;
}
