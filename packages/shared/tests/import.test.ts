import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "../src/csv";
import { mapPatientColumns, mapPatientRow, parseDate } from "../src/import";

describe("CSV", () => {
  it("handles quotes, commas, line breaks, CRLF and Excel's BOM", () => {
    const text = '﻿Name,Address\r\n"Rao, Priya","1st Floor\n100 Feet Rd"\r\n"Say ""hi""",x\r\n\r\n';
    expect(parseCsv(text)).toEqual([["Name", "Address"], ["Rao, Priya", "1st Floor\n100 Feet Rd"], ['Say "hi"', "x"]]);
  });
  it("round-trips and neutralises formulas", () => {
    expect(parseCsv(toCsv([["a,b", 'q"'], [1, null]]))).toEqual([["a,b", 'q"'], ["1", ""]]);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
});

describe("patient import mapping", () => {
  const header = ["Patient Name", "Mobile No.", "Sex", "DOB", "UHID", "Pin Code"];
  const cols = mapPatientColumns(header);
  it("finds columns by common names", () => {
    expect(cols.full_name).toBe(0);
    expect(cols.phone_e164).toBe(1);
    expect(cols.uhid).toBe(4);
    expect(cols.email).toBeNull();
  });
  it("normalizes a good row", () => {
    expect(mapPatientRow(["  Meera  Nair ", "098450 12345", "F", "31/03/1990", "PAC2139", "560001"], cols)).toEqual({
      row: { full_name: "Meera Nair", phone_e164: "+919845012345", gender: "female", dob: "1990-03-31", uhid: "PAC2139", pincode: "560001" },
      problems: [],
    });
  });
  it("reports bad cells instead of guessing", () => {
    expect(mapPatientRow(["", "123", "M", "31/02/1990", "", "012345"], cols).problems).toEqual(["full_name", "phone_e164", "dob", "pincode"]);
  });
  it("parses Indian and ISO dates, rejects impossible ones", () => {
    expect(parseDate("1-4-2026")).toBe("2026-04-01");
    expect(parseDate("2026-04-01")).toBe("2026-04-01");
    expect(parseDate("31/04/2026")).toBeNull();
    expect(parseDate("04/31/2026")).toBeNull();
  });
});
