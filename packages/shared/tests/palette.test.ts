import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCss } from "../src/design/generate";
import { contrastRatio, oklch, validatePalette } from "../src/design/palette";
import { tokens } from "../src/design/tokens";

const { dark, light } = tokens.color;

describe("chart palette (PLAN.md B6)", () => {
  it("dark series pass every check on the dark chart surface, including 3:1 contrast", () => {
    const report = validatePalette(tokens.chart.dark.series, {
      mode: "dark",
      surface: tokens.chart.dark.surface,
      requireContrast: true,
    });
    expect(report.failures).toEqual([]);
  });

  it("light series pass every hard check (low-contrast slots need labels/table view)", () => {
    const report = validatePalette(tokens.chart.light.series, {
      mode: "light",
      surface: tokens.chart.light.surface,
    });
    expect(report.failures).toEqual([]);
  });

  it("chart cards must sit on the page colour, not the raised grey", () => {
    expect(tokens.chart.dark.surface).toBe(dark.page);
    expect(tokens.chart.light.surface).toBe(light.page);
  });

  it.each(["dark", "light"] as const)("%s sequential ramp gets darker step by step", (mode) => {
    const steps = tokens.chart[mode].sequential.map((hex) => oklch(hex).l);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
  });

  it("status colours stay visible on the dark page (≥ 3:1)", () => {
    for (const hex of Object.values(tokens.status)) {
      expect(contrastRatio(hex, dark.page)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("text contrast (WCAG AA ≥ 4.5:1)", () => {
  for (const [mode, c] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    const surfaces = { page: c.page, sidebar: c.sidebar, raised: c.raised, hover: c.hover };
    for (const [surfaceName, surface] of Object.entries(surfaces)) {
      for (const textName of ["text", "textSecondary", "textMuted"] as const) {
        it(`${mode}: ${textName} on ${surfaceName}`, () => {
          expect(contrastRatio(c[textName], surface)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${mode}: highlighted menu rows stay readable (text + secondary text)`, () => {
      expect(contrastRatio(c.text, c.raisedHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.textSecondary, c.raisedHover)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: menu highlight is visibly different from the menu itself`, () => {
      expect(c.raisedHover).not.toBe(c.raised);
    });
    it(`${mode}: button text on primary button`, () => {
      expect(contrastRatio(c.primaryText, c.primary)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: text on danger button`, () => {
      expect(contrastRatio(c.dangerText, c.danger)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: links on page`, () => {
      expect(contrastRatio(c.link, c.page)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: good/bad change text (KPI arrows) readable on page`, () => {
      expect(contrastRatio(c.goodText, c.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.badText, c.page)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: focus ring visible on page (≥ 3:1)`, () => {
      expect(contrastRatio(c.focus, c.page)).toBeGreaterThanOrEqual(3);
    });
    it(`${mode}: chart axis labels readable`, () => {
      expect(contrastRatio(tokens.chart[mode].label, tokens.chart[mode].surface)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("generated CSS", () => {
  it("web/app/tokens.css is up to date (run `pnpm tokens` after editing tokens.json)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const committed = readFileSync(resolve(here, "../../../web/app/tokens.css"), "utf8");
    expect(committed).toBe(buildCss());
  });
});
