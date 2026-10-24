import { describe, expect, it } from "vitest";
import { crudSchema, type FieldDef } from "./crud-schema";

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, maxLength: 10 },
  { key: "hsn", label: "HSN", type: "text", format: "hsn_sac" },
  { key: "gstin", label: "GSTIN", type: "text", format: "gstin" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "sessions", label: "Sessions", type: "number", min: 1, max: 100, required: true },
  { key: "reorder", label: "Reorder", type: "number", min: 0, step: 0.001 },
  { key: "price", label: "Price", type: "money", required: true },
  { key: "gap", label: "Gap days", type: "int_list" },
  { key: "category", label: "Category", type: "select", required: true, options: [{ value: "a", label: "A" }] },
  { key: "day", label: "Day", type: "date" },
];
const schema = crudSchema({ fields, hasActive: true });
const good = {
  name: " Botox ", hsn: "", gstin: "", phone: "", email: "", sessions: "3", reorder: "", price: 150000, gap: "0, 14",
  category: "a", day: "", active: true,
};
const issues = (patch: Record<string, unknown>) => {
  const r = schema.safeParse({ ...good, ...patch });
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("admin table forms", () => {
  it("a good row becomes the table payload (trimmed, nulls, numbers)", () => {
    expect(schema.parse(good)).toEqual({
      name: "Botox", hsn: null, gstin: null, phone: null, email: null, sessions: 3, reorder: null, price: 150000,
      gap: [0, 14], category: "a", day: null, active: true,
    });
  });
  it("catches what the database would refuse, with a message per field", () => {
    expect(issues({ name: "  ", sessions: "0", price: null, category: "" })).toEqual({
      name: "required", sessions: "min", price: "required", category: "choose",
    });
    expect(issues({ hsn: "12ab", gstin: "29abc", phone: "123", email: "x@y" })).toEqual({
      hsn: "hsn", gstin: "gstin", phone: "phone", email: "email",
    });
    expect(issues({ reorder: "1.23456", gap: "0, -3", day: "2026-02-31", name: "a very long name" })).toEqual({
      reorder: "decimals", gap: "intList", day: "date", name: "tooLong",
    });
  });
  it("GSTIN is upper-cased and spaces are dropped before the check", () => {
    expect(schema.parse({ ...good, gstin: "29abcde1234f1z5", hsn: "3004 90" })).toMatchObject({ gstin: "29ABCDE1234F1Z5", hsn: "300490" });
  });
});
