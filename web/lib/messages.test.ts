import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../messages/en.json" with { type: "json" };

/** Every .tsx/.ts file under the given folders (not tests, not node_modules). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const has = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages) !== undefined;

describe("screen text", () => {
  it("every literal t(\"…\") key used in the code exists in messages/en.json", () => {
    const root = join(__dirname, "..");
    const missing: string[] = [];
    for (const file of [...files(join(root, "app")), ...files(join(root, "components")), ...files(join(root, "lib"))]) {
      const src = readFileSync(file, "utf8");
      // const t = useTranslations("ns") / await getTranslations("ns") / useTranslations()
      // A file may bind the same name to different namespaces in different components: a key
      // passes when any namespace bound to that name has it.
      const byName = new Map<string, string[]>();
      for (const [, name, ns = ""] of src.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:"([^"]*)")?\)/g)) {
        byName.set(name!, [...(byName.get(name!) ?? []), ns]);
      }
      for (const [name, namespaces] of byName) {
        for (const call of src.matchAll(new RegExp(`\\b${name}\\("([^"]+)"`, "g"))) {
          const key = call[1]!;
          if (!namespaces.some((ns) => has(ns ? `${ns}.${key}` : key))) missing.push(`${relative(root, file)}: ${namespaces.join("|")}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
