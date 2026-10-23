import { assertEquals } from "@std/assert";
import { normalizePhone } from "./phone.ts";

// The same cases as packages/shared/tests/phone.test.ts.
Deno.test("Indian numbers however they are typed", () => {
  for (const input of ["+91 98450 12345", "098450-12345", "9845012345", "91 9845012345", "0091 9845012345", "(+91) 98450-12345"]) {
    assertEquals(normalizePhone(input), { e164: "+919845012345", last10: "9845012345", isIndianMobile: true }, input);
  }
});

Deno.test("landlines and international numbers", () => {
  assertEquals(normalizePhone("011 2345 6789"), { e164: "+911123456789", last10: "1123456789", isIndianMobile: false });
  assertEquals(normalizePhone("080 4123 4567")?.e164, "+918041234567");
  assertEquals(normalizePhone("+1 415 555 0100")?.e164, "+14155550100");
});

Deno.test("not a phone number", () => {
  for (const input of ["", "12345", "0000000000", "98450123456789", "abc"]) {
    assertEquals(normalizePhone(input), null, JSON.stringify(input));
  }
});
