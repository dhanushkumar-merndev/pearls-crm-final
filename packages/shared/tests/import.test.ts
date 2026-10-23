import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "../src/csv";
import { mapPatientColumns, mapPatientRow, mapStockColumns, mapStockRow, parseDate, parseExpiry } from "../src/import";

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

describe("opening stock mapping", () => {
  it("reads strip expiries in the usual shapes as the first of the month", () => {
    expect(parseExpiry("03/27")).toBe("2027-03-01");
    expect(parseExpiry("3/2027")).toBe("2027-03-01");
    expect(parseExpiry("03-2027")).toBe("2027-03-01");
    expect(parseExpiry("Mar-27")).toBe("2027-03-01");
    expect(parseExpiry("March 2027")).toBe("2027-03-01");
    expect(parseExpiry("31/03/2027")).toBe("2027-03-01");
    expect(parseExpiry("2027-03-31")).toBe("2027-03-01");
    expect(parseExpiry("13/27")).toBeNull();
    expect(parseExpiry("soon")).toBeNull();
  });

  const header = ["Item Name", "Batch No", "Exp", "Qty", "MRP", "GST %", "HSN Code", "Purchase Rate", "Rack"];
  const cols = mapStockColumns(header);
  it("finds columns by common names", () => {
    expect(cols).toMatchObject({ name: 0, batch_no: 1, expiry_date: 2, qty: 3, mrp: 4, gst: 5, hsn: 6, purchase_price: 7, rack: 8 });
    expect(cols.strength).toBeNull();
  });
  it("converts rupees to paise and GST % to basis points", () => {
    const { row, problems } = mapStockRow(["Cetirizine 10", "b12", "Mar-27", "120", "₹35.50", "12%", "3004 9099", "21.2", "A3"], cols);
    expect(problems).toEqual([]);
    expect(row).toEqual({
      name: "Cetirizine 10", batch_no: "b12", expiry_date: "2027-03-01", qty: 120, mrp_paise: 3550,
      gst_rate_bp: 1200, hsn: "30049099", purchase_price_paise: 2120, rack: "A3",
    });
  });
  it("lists every bad cell before anything is sent", () => {
    const { problems } = mapStockRow(["", "", "later", "0", "abc", "55", "12", "", ""], cols);
    expect(problems).toEqual(["name", "hsn", "gst", "mrp", "batch_no", "expiry_date", "qty"]);
  });
});
