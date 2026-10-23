import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVectorSql, SQL_TEST_PATH } from "../scripts/vector-sql";

describe("golden vectors", () => {
  it("the SQL test is generated from the same file (run `pnpm vectors` after editing gst.json)", () => {
    expect(readFileSync(SQL_TEST_PATH, "utf8")).toBe(buildVectorSql());
  });
});
