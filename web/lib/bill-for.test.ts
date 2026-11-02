import { describe, expect, it } from "vitest";
import { billTargetLinks, billTargetSchema } from "./schemas/billing";
import { billForLabel } from "./bill-for";

// The real words come from messages/en.json; here a stand-in shows which key and values were used.
const t = (key: string, v?: Record<string, string | number>) => `${key}(${Object.values(v ?? {}).join(",")})`;
const ID = "31313131-6666-4000-a000-000000000001";

describe("what a bill is for", () => {
  it("names the treatment and session, then the doctor", () => {
    expect(billForLabel({ treatment: "Laser", session_seq: 3, visit_date: "2026-11-20", doctor: "Dr Priya" }, t)).toBe(
      "session(Laser,3) · Dr Priya",
    );
  });
  it("a whole treatment, a plain visit, an IP stay", () => {
    expect(billForLabel({ treatment: "Rhinoplasty", ip_number: "IP-12" }, t)).toBe("Rhinoplasty · stay(IP-12)");
    expect(billForLabel({ visit_date: "2026-11-02", doctor: "Dr Ravi" }, t)).toBe("visit(02/11/2026) · Dr Ravi");
  });
  it("nothing in particular reads as nothing (a doctor alone is not a 'for')", () => {
    expect(billForLabel({}, t)).toBeNull();
    expect(billForLabel(undefined, t)).toBeNull();
    expect(billForLabel({ doctor: "Dr Ravi" }, t)).toBeNull();
  });
});

describe("New bill: what is it for?", () => {
  it("a choice is needed", () => {
    expect(billTargetSchema.safeParse({ target: "" }).success).toBe(false);
    expect(billTargetSchema.safeParse({ target: "visit:abc" }).success).toBe(false);
    expect(billTargetSchema.safeParse({ target: "none" }).success).toBe(true);
  });
  it("each choice becomes the matching link", () => {
    expect(billTargetLinks("none")).toEqual({});
    expect(billTargetLinks(`appointment:${ID}`)).toEqual({ appointment_id: ID });
    expect(billTargetLinks(`session:${ID}`)).toEqual({ session_id: ID });
    expect(billTargetLinks(`admission:${ID}`)).toEqual({ admission_id: ID });
  });
});
