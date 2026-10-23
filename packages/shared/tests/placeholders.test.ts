import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/placeholders.json" with { type: "json" };
import { leftoverPlaceholders, renderPlaceholders } from "../src/placeholders";

describe("discharge placeholders (golden vectors, same as SQL)", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const out = renderPlaceholders(c.text, c.vars as Record<string, string>);
      expect(out).toBe(c.expect);
      expect([...leftoverPlaceholders(out)].sort()).toEqual([...c.leftover].sort());
    });
  }
});
