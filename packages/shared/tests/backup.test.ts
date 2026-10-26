import { describe, expect, it } from "vitest";
import { backupPath, exportPath, extensionFor, PURGEABLE_PURPOSES, safeSegment } from "../src/backup";

describe("backup file names (Windows and Mac safe)", () => {
  it("removes characters Windows or Mac refuse", () => {
    expect(safeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe("a b c d e f g h i j");
    expect(safeSegment("tab\there\nnewline")).toBe("tab here newline");
  });

  it("never ends with a dot or space, and is never empty", () => {
    expect(safeSegment("report. . ")).toBe("report");
    expect(safeSegment("   ")).toBe("_");
    expect(safeSegment("...")).toBe("_");
  });

  it("steers clear of Windows device names", () => {
    expect(safeSegment("CON")).toBe("_CON");
    expect(safeSegment("nul.txt")).toBe("_nul.txt");
    expect(safeSegment("com1")).toBe("_com1");
    expect(safeSegment("Console")).toBe("Console");
  });

  it("keeps Indian names readable and cuts long ones", () => {
    expect(safeSegment("ರಾಜೇಶ್ ಕುಮಾರ್")).toBe("ರಾಜೇಶ್ ಕುಮಾರ್");
    expect(safeSegment("x".repeat(200)).length).toBe(60);
  });

  it("files go to purpose/month/date_label_id.ext in IST", () => {
    const path = backupPath({
      id: "0123abcd-0000-4000-a000-000000000001",
      purpose: "call_recording",
      mime: "audio/mp4",
      // 20:00 UTC on 31 Jan is 01:30 IST on 1 Feb.
      created_at: "2026-01-31T20:00:00Z",
      label: "Asha Rao: follow-up?",
    });
    expect(path).toEqual(["call_recording", "2026-02", "2026-02-01_Asha Rao follow-up_0123abcd.m4a"]);
  });

  it("the same file always gets the same path (a resumed backup overwrites, never duplicates)", () => {
    const f = { id: "ffffeeee-0000-4000-a000-000000000002", purpose: "prescription", mime: "application/pdf", created_at: "2026-10-01T05:00:00Z" };
    expect(backupPath(f)).toEqual(backupPath({ ...f }));
    expect(backupPath(f).at(-1)).toBe("2026-10-01_ffffeeee.pdf");
    expect(backupPath({ ...f, label: "" }).at(-1)).toBe("2026-10-01_ffffeeee.pdf");
  });

  it("knows the stored types; anything else is .bin", () => {
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("AUDIO/MP4")).toBe("m4a");
    expect(extensionFor("application/x-unknown")).toBe("bin");
  });

  it("database exports are one file per table", () => {
    expect(exportPath("2026-10-26 14:05", "patients")).toEqual(["database", "2026-10-26 14 05", "patients.jsonl"]);
  });

  it("only heavy media may be purged, never clinical records", () => {
    expect(PURGEABLE_PURPOSES).not.toContain("prescription");
    expect(PURGEABLE_PURPOSES).not.toContain("document");
    expect(PURGEABLE_PURPOSES).toContain("visit_recording");
  });
});
