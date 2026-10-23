import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/phone";

describe("normalizePhone", () => {
  it.each([
    ["+91 98450 12345", "+919845012345"],
    ["098450-12345", "+919845012345"],
    ["9845012345", "+919845012345"],
    ["91 9845012345", "+919845012345"],
    ["0091 9845012345", "+919845012345"],
    ["(+91) 98450-12345", "+919845012345"],
  ])("%s → %s", (input, e164) => {
    const result = normalizePhone(input);
    expect(result?.e164).toBe(e164);
    expect(result?.last10).toBe("9845012345");
    expect(result?.isIndianMobile).toBe(true);
  });

  it("accepts landlines but marks them as not mobile", () => {
    expect(normalizePhone("011 2345 6789")).toEqual({
      e164: "+911123456789",
      last10: "1123456789",
      isIndianMobile: false,
    });
  });

  it("normalises a Bengaluru landline (looks like a mobile by digits alone)", () => {
    const result = normalizePhone("080 4123 4567");
    expect(result?.e164).toBe("+918041234567");
    expect(result?.isIndianMobile).toBe(true);
  });

  it("keeps international numbers", () => {
    expect(normalizePhone("+1 415 555 0100")?.e164).toBe("+14155550100");
  });

  it.each(["", "12345", "0000000000", "98450123456789", "abc"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
