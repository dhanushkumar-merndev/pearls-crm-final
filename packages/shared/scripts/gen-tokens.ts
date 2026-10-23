/**
 * Generates platform files from the shared sources:
 *   web/app/tokens.css                                  CSS variables (shadcn names + chart/status) ← tokens.json
 *   android/core/ui/…/core/ui/theme/PearlColors.kt      Compose colours ← tokens.json
 *   android/core/ui/src/main/res/values/errors.xml      error messages ← web/messages/en.json "errors"
 *   android/core/ui/…/core/ui/errors/ErrorStrings.kt    error code → message map ← errors.ts
 * Run: pnpm tokens
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAndroidErrorsKotlin, buildAndroidErrorsXml } from "../src/android-strings";
import { buildCss, buildKotlin } from "../src/design/generate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const androidUi = resolve(root, "android/core/ui/src/main");

export const CSS_PATH = resolve(root, "web/app/tokens.css");
export const KOTLIN_PATH = resolve(androidUi, "java/com/pearl/crm/core/ui/theme/PearlColors.kt");
export const ERRORS_XML_PATH = resolve(androidUi, "res/values/errors.xml");
export const ERRORS_KOTLIN_PATH = resolve(androidUi, "java/com/pearl/crm/core/ui/errors/ErrorStrings.kt");

const messages = JSON.parse(readFileSync(resolve(root, "web/messages/en.json"), "utf8"));

for (const [path, content] of [
  [CSS_PATH, buildCss()],
  [KOTLIN_PATH, buildKotlin()],
  [ERRORS_XML_PATH, buildAndroidErrorsXml(messages)],
  [ERRORS_KOTLIN_PATH, buildAndroidErrorsKotlin()],
] as const) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${path.replace(root + "/", "")}`);
}
