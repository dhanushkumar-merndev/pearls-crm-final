import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGeoSql, buildPlaceholderSql, buildVectorSql, GEO_SQL_TEST_PATH, PLACEHOLDER_SQL_TEST_PATH, SQL_TEST_PATH } from "../scripts/vector-sql";

describe("golden vectors", () => {
  it("the SQL test is generated from the same file (run `pnpm vectors` after editing gst.json)", () => {
    expect(readFileSync(SQL_TEST_PATH, "utf8")).toBe(buildVectorSql());
  });
  it("the placeholder SQL test is generated from placeholders.json (run `pnpm vectors`)", () => {
    expect(readFileSync(PLACEHOLDER_SQL_TEST_PATH, "utf8")).toBe(buildPlaceholderSql());
  });
  it("the geo SQL test is generated from geo.json (run `pnpm vectors`)", () => {
    expect(readFileSync(GEO_SQL_TEST_PATH, "utf8")).toBe(buildGeoSql());
  });
});
