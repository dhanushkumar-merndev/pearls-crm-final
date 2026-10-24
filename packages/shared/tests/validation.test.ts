import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  intList,
  isIsoDate,
  issuesByPath,
  optionalDate,
  optionalEmail,
  optionalInt,
  optionalPhone,
  optionalPincode,
  optionalText,
  requiredChoice,
  requiredDateTime,
  requiredDecimal,
  requiredInt,
  requiredItem,
  requiredPaise,
  requiredPhone,
  requiredRupees,
  requiredText,
  wordList,
} from "../src/validation";

const msg = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0]!.message;
};

describe("text", () => {
  it("required text is trimmed; empty or spaces only is refused", () => {
    expect(requiredText(5).parse("  Asha ")).toBe("Asha");
    expect(msg(requiredText(5), "   ")).toBe("required");
    expect(msg(requiredText(5), null)).toBe("required");
    expect(msg(requiredText(5), "toolong")).toBe("tooLong");
  });
  it("optional text: empty becomes null, too long is refused", () => {
    expect(optionalText(10).parse("  ")).toBeNull();
    expect(optionalText(10).parse(" ok ")).toBe("ok");
    expect(optionalText(10).parse(undefined)).toBeNull();
    expect(msg(optionalText(2), "abc")).toBe("tooLong");
  });
});

describe("phones, email, pincode", () => {
  it("phones become E.164; nonsense is refused with 'phone'", () => {
    expect(requiredPhone().parse("098450-12345")).toBe("+919845012345");
    expect(msg(requiredPhone(), "")).toBe("required");
    expect(msg(requiredPhone(), "12345")).toBe("phone");
    expect(optionalPhone().parse("")).toBeNull();
    expect(msg(optionalPhone(), "abc")).toBe("phone");
  });
  it("email and pincode are optional but must look right when given", () => {
    expect(optionalEmail().parse("")).toBeNull();
    expect(optionalEmail().parse(" a@b.in ")).toBe("a@b.in");
    expect(msg(optionalEmail(), "a@b")).toBe("email");
    expect(optionalPincode().parse("560001")).toBe("560001");
    expect(msg(optionalPincode(), "060001")).toBe("pincode");
  });
});

describe("numbers and money", () => {
  it("whole numbers within a range, from text or number", () => {
    expect(requiredInt(1, 10).parse("3")).toBe(3);
    expect(requiredInt(1, 10).parse(4)).toBe(4);
    expect(msg(requiredInt(1, 10), "")).toBe("required");
    expect(msg(requiredInt(1, 10), "abc")).toBe("number");
    expect(msg(requiredInt(1, 10), "2.5")).toBe("wholeNumber");
    expect(msg(requiredInt(1, 10), "0")).toBe("min");
    expect(msg(requiredInt(1, 10), "11")).toBe("max");
    expect(optionalInt(0, 5).parse("")).toBeNull();
  });
  it("min/max issues carry the limit for the message", () => {
    const r = requiredInt(1, 10).safeParse("11");
    expect(r.success).toBe(false);
    expect((r.error!.issues[0] as unknown as { maximum: number }).maximum).toBe(10);
  });
  it("decimals limited to the given places", () => {
    expect(requiredDecimal(0.001, 100000).parse("2.5")).toBe(2.5);
    expect(msg(requiredDecimal(0.001, 100000), "2.5555")).toBe("decimals");
    expect(msg(requiredDecimal(0.001, 100000), "0")).toBe("min");
  });
  it("paise from a money field; rupees typed as text", () => {
    expect(requiredPaise().parse(150000)).toBe(150000);
    expect(msg(requiredPaise(), null)).toBe("required");
    expect(msg(requiredPaise(1), 0)).toBe("amountPositive");
    expect(requiredRupees().parse("1,500.50")).toBe(150050);
    expect(msg(requiredRupees(), "12.345")).toBe("amount");
    expect(msg(requiredRupees(1), "0")).toBe("amountPositive");
  });
});

describe("dates and choices", () => {
  it("only real dates pass", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(optionalDate().parse("")).toBeNull();
    expect(msg(optionalDate(), "2026-13-01")).toBe("date");
    expect(requiredDateTime().parse("2026-10-24T10:30")).toBe("2026-10-24T10:30");
    expect(msg(requiredDateTime(), "2026-10-24")).toBe("dateTime");
  });
  it("a dropdown left on 'Choose…' or an empty picker asks to choose", () => {
    expect(msg(requiredChoice(["a", "b"] as const), "")).toBe("choose");
    expect(msg(requiredChoice(["a", "b"] as const), "c")).toBe("choose");
    expect(requiredChoice(["a", "b"] as const).parse("b")).toBe("b");
    expect(msg(requiredItem(), null)).toBe("choose");
    expect(requiredItem().parse({ id: "x", label: "X" })).toBe("x");
  });
  it("lists", () => {
    expect(intList().parse("0, 14 30")).toEqual([0, 14, 30]);
    expect(msg(intList(), "0, -1")).toBe("intList");
    expect(wordList().parse("Dust, , Penicillin")).toEqual(["Dust", "Penicillin"]);
    expect(msg(wordList(3), "Dust")).toBe("wordList");
  });
});

describe("issuesByPath", () => {
  it("keeps the first message per field, nested rows by index", () => {
    const schema = z.object({ name: requiredText(), items: z.array(z.object({ qty: requiredInt(1, 9) })) });
    const r = schema.safeParse({ name: "", items: [{ qty: 1 }, { qty: 0 }] });
    const map = issuesByPath(r.error!);
    expect([...map.keys()]).toEqual(["name", "items.1.qty"]);
  });
});
