/**
 * Computable colour checks for chart palettes and text colours.
 * Method: OKLab distance ×100 between neighbouring series, with colour-blind
 * vision simulated by the Machado, Oliveira & Fernandes (2009) severity-1.0
 * matrices, plus WCAG contrast. Thresholds follow the dataviz method used to pick
 * the palette in PLAN.md B6.
 */
export type Mode = "dark" | "light";

const BAND: Record<Mode, [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };
export const CHROMA_FLOOR = 0.1;
export const CVD_FLOOR = 6.0;
export const CVD_TARGET = 8.0;
export const NORMAL_FLOOR = 15.0;

type Vec3 = [number, number, number];
type Matrix = [Vec3, Vec3, Vec3];

const MACHADO: Record<"protan" | "deutan" | "tritan", Matrix> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function parseHex(hex: string): Vec3 {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not_a_hex_colour:${hex}`);
  const h = match[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec3;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (hex: string): Vec3 => parseHex(hex).map(toLinear) as Vec3;

export function relativeLuminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function oklabFromLinear([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(hex: string, kind: keyof typeof MACHADO): Vec3 {
  const [r, g, b] = linear(hex);
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return MACHADO[kind].map(([x, y, z]) => clamp(x * r + y * g + z * b)) as Vec3;
}

export function oklch(hex: string): { l: number; c: number } {
  const [l, a, b] = oklabFromLinear(linear(hex));
  return { l, c: Math.hypot(a, b) };
}

/** OKLab distance ×100; `kind` simulates colour-blind vision. */
export function deltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const la = oklabFromLinear(kind ? simulate(a, kind) : linear(a));
  const lb = oklabFromLinear(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export interface PaletteReport {
  pass: boolean;
  failures: string[];
  warnings: string[];
  worstCvd: number;
  worstNormal: number;
  minContrast: number;
}

/**
 * Checks a categorical palette (adjacent pairs, as used by bars, stacks and lines).
 * `requireContrast` turns the sub-3:1 contrast warning into a failure.
 */
export function validatePalette(
  palette: string[],
  options: { mode: Mode; surface: string; requireContrast?: boolean },
): PaletteReport {
  const { mode, surface, requireContrast = false } = options;
  const failures: string[] = [];
  const warnings: string[] = [];
  const [lo, hi] = BAND[mode];

  for (const hex of palette) {
    const { l, c } = oklch(hex);
    if (l < lo || l > hi) failures.push(`lightness ${hex} L=${l.toFixed(3)} outside ${lo}-${hi}`);
    if (c < CHROMA_FLOOR) failures.push(`chroma ${hex} C=${c.toFixed(3)} below ${CHROMA_FLOOR}`);
  }

  let worstCvd = Infinity;
  let worstNormal = Infinity;
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i]!;
    const b = palette[i + 1]!;
    const cvd = Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));
    const normal = deltaE(a, b);
    worstCvd = Math.min(worstCvd, cvd);
    worstNormal = Math.min(worstNormal, normal);
    if (cvd < CVD_FLOOR) failures.push(`cvd ${a}/${b} ΔE ${cvd.toFixed(1)} < ${CVD_FLOOR}`);
    else if (cvd < CVD_TARGET) warnings.push(`cvd ${a}/${b} ΔE ${cvd.toFixed(1)} needs labels`);
    if (normal < NORMAL_FLOOR) failures.push(`normal ${a}/${b} ΔE ${normal.toFixed(1)} < 15`);
  }

  let minContrast = Infinity;
  for (const hex of palette) {
    const ratio = contrastRatio(hex, surface);
    minContrast = Math.min(minContrast, ratio);
    if (ratio < 3) {
      const msg = `contrast ${hex} on ${surface} = ${ratio.toFixed(2)} < 3`;
      (requireContrast ? failures : warnings).push(msg);
    }
  }

  return { pass: failures.length === 0, failures, warnings, worstCvd, worstNormal, minContrast };
}
