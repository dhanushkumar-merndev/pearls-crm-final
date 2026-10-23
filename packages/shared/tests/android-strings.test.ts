import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { androidEscape, buildAndroidErrorsKotlin, buildAndroidErrorsXml, icuToPlain } from "../src/android-strings";
import { buildKotlin } from "../src/design/generate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const androidUi = resolve(root, "android/core/ui/src/main");
const read = (path: string) => readFileSync(resolve(androidUi, path), "utf8");
const messages = JSON.parse(readFileSync(resolve(root, "web/messages/en.json"), "utf8"));

describe("Android files generated from shared sources (run `pnpm tokens` after editing)", () => {
  it("PearlColors.kt matches tokens.json", () => {
    expect(read("java/com/pearl/crm/core/ui/theme/PearlColors.kt")).toBe(buildKotlin());
  });

  it("errors.xml matches web/messages/en.json", () => {
    expect(read("res/values/errors.xml")).toBe(buildAndroidErrorsXml(messages));
  });

  it("ErrorStrings.kt lists every error code", () => {
    expect(read("java/com/pearl/crm/core/ui/errors/ErrorStrings.kt")).toBe(buildAndroidErrorsKotlin());
  });
});

describe("Android string conversion", () => {
  it("removes ICU quoting the way next-intl reads it", () => {
    expect(icuToPlain("Some '{{placeholders}}' are left")).toBe("Some {{placeholders}} are left");
    expect(icuToPlain("doesn't")).toBe("doesn't");
    expect(icuToPlain("it''s")).toBe("it's");
    expect(() => icuToPlain("Hello {name}")).toThrow(/ICU argument/);
  });

  it("escapes what Android resource files treat specially", () => {
    expect(androidEscape(`Don't "quote" <b> & 50\\50`)).toBe(`Don\\'t \\"quote\\" &lt;b&gt; &amp; 50\\\\50`);
    expect(androidEscape("@home")).toBe("\\@home");
    expect(buildAndroidErrorsXml({ errors: Object.fromEntries([...Object.keys(messages.errors)].map((k) => [k, "50% off"])) })).toContain(
      'formatted="false">50% off<',
    );
  });
});
