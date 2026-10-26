/**
 * Excel in and out (PLAN.md E3 row 14). The libraries load only when someone exports or imports.
 * Export: a header row in bold, numbers as real numbers (so totals work in Excel).
 * Import: the first sheet as text cells, the same shape the CSV reader gives.
 */
export type ExcelCell = string | number | null | undefined;

export async function downloadExcel(fileName: string, header: string[], rows: ExcelCell[][], widths?: number[]): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = header.map((value) => ({ value, fontWeight: "bold" as const }));
  const body = rows.map((r) => r.map((v) => (typeof v === "number" ? { type: Number, value: v } : { value: v ?? "" })));
  await writeXlsxFile([head, ...body], {
    columns: header.map((h, i) => ({ width: widths?.[i] ?? Math.min(40, Math.max(12, h.length + 2)) })),
  }).toFile(fileName);
}

/** One spreadsheet cell as the text a CSV would have held. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Excel dates have no time zone: read the calendar day as written.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Whole numbers such as 9845012345 must not turn into 9.845012345e9.
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

export async function readExcelRows(file: File): Promise<string[][]> {
  const { readSheet } = await import("read-excel-file/browser");
  const data = await readSheet(file);
  return data.map((row) => row.map(cellText)).filter((row) => row.some((c) => c !== ""));
}

export const isXlsx = (name: string) => /\.(xlsx|xlsm)$/i.test(name);
