import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "../src/csv";
import {
  mapLeadColumns, mapLeadRow, mapPatientColumns, mapPatientRow, mapStockColumns, mapStockRow, parseDate, parseExpiry, parseLeadStage,
} from "../src/import";

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

describe("lead import mapping", () => {
  const header = ["Sl No", "Date", "Name", "Mobile No", "Treatment", "Assigned to", "Source", "Amount Quoted", "Amount Finalised", "Status", "Due Date", "Comments"];
  const cols = mapLeadColumns(header);
  it("finds the sales sheet's columns", () => {
    expect(cols).toMatchObject({ lead_date: 1, name: 2, phone: 3, treatment: 4, assigned: 5, source: 6, amount_quoted: 7,
                                 amount_finalised: 8, stage: 9, next_followup: 10, comments1: 11, alt_phone: null });
  });
  it("maps a row to the import payload", () => {
    const cells = ["1", "05/10/2026", "Asha  Rao", "098450-12345", "Rhinoplasty", "sales1", "Instagram", "₹1,20,000", "95000.50", "Booked", "07/10/2026", "call evening"];
    expect(mapLeadRow(cells, cols)).toEqual({
      row: {
        name: "Asha Rao", phone: "+919845012345", treatment: "Rhinoplasty", assigned: "sales1", source: "Instagram",
        comments1: "call evening", lead_date: "2026-10-05", next_followup_at: "2026-10-07T10:00:00+05:30",
        amount_quoted_paise: 12000000, amount_finalised_paise: 9500050, stage: "consultation_booked",
      },
      problems: [],
    });
  });
  it("reports what it can't read", () => {
    const cells = ["2", "31/02/2026", "", "12345", "", "", "", "lots", "", "maybe", "", ""];
    expect(mapLeadRow(cells, cols).problems).toEqual(["name", "phone", "lead_date", "amount_quoted", "stage"]);
  });
  it("understands the usual stage words", () => {
    expect(["New", "RNR", "Not interested", "Surgery fixed", "Won", "spam"].map(parseLeadStage))
      .toEqual(["new", "not_reachable", "lost", "surgery_scheduled", "converted", "junk"]);
  });
});
