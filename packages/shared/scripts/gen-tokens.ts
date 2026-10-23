/**
 * Generates platform colour files from src/design/tokens.json:
 *   web/app/tokens.css                        CSS variables (shadcn names + chart/status)
 *   packages/shared/generated/PearlColors.kt  Compose colours (copied into Android in Phase 11)
 * Run: pnpm tokens
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss, buildKotlin } from "../src/design/generate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const CSS_PATH = resolve(root, "web/app/tokens.css");
export const KOTLIN_PATH = resolve(root, "packages/shared/generated/PearlColors.kt");

for (const [path, content] of [
  [CSS_PATH, buildCss()],
  [KOTLIN_PATH, buildKotlin()],
] as const) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${path.replace(root + "/", "")}`);
}
