"use client";

import { Download, FileDown, FileSearch, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  IMPORT_TEMPLATES,
  importTemplateCsv,
  mapLeadColumns,
  mapLeadRow,
  mapPatientColumns,
  mapPatientRow,
  mapStockColumns,
  mapStockRow,
  parseCsv,
  toCsv,
  type ImportKind,
  type MappedRow,
} from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, PageHeader } from "@/components/ui/form";
import { FieldError, Input } from "@/components/ui/input";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

export type { ImportKind };

/** Rows per RPC call (the server's limit), the largest file and row count accepted. */
const BATCH = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;

const KINDS: Record<ImportKind, {
  mapColumns: (header: string[]) => Record<string, number | null>;
  mapRow: (cells: string[], cols: Record<string, number | null>) => MappedRow;
  rpc: string;
  /** Translation prefix under `import`: "" for patients (the original keys), "stock." / "leads.". */
  prefix: string;
}> = {
  patients: { mapColumns: mapPatientColumns, mapRow: mapPatientRow, rpc: "import_patients", prefix: "" },
  stock: { mapColumns: mapStockColumns, mapRow: mapStockRow, rpc: "import_opening_stock", prefix: "stock." },
  leads: { mapColumns: mapLeadColumns, mapRow: mapLeadRow, rpc: "import_leads", prefix: "leads." },
};

interface Row {
  /** Row number in the sheet (the header is row 1). */
  line: number;
  cells: string[];
  payload: Record<string, unknown>;
}
interface Problem {
  line: number;
  field: string | null;
  /** "why.<reason>" for problems found in the browser, or a server code (errors.<code>). */
  key: string;
  server: boolean;
}

/**
 * Import from a spreadsheet (CSV): download the template → choose the file → every cell is
 * checked in the browser → "Check the file" runs the same import on the server without
 * saving → import. Rows with problems can be left out; the problem list downloads as CSV.
 */
export function ImportScreen({ kind = "patients" }: { kind?: ImportKind }) {
  const t = useTranslations("import");
  const errs = useTranslations("errors");
  const k = KINDS[kind];
  const tk = (key: string, values?: Record<string, string | number>) => t(`${k.prefix}${key}`, values);
  const { saved, failed } = useFeedback();
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<string, number | null> | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [checked, setChecked] = useState(false);
  const [skipBad, setSkipBad] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; left: number } | null>(null);

  const colLabel = (field: string | null) => {
    if (!field) return "—";
    const key = `${k.prefix}col.${field}`;
    return t.has(key) ? t(key) : field === "row" ? t("rowWhole") : field;
  };
  const message = (p: Problem) => {
    if (!p.server) return t(p.key);
    if (p.key === "duplicate") return tk("duplicateRow");
    return errs.has(p.key) ? errs(p.key) : errs("invalid_input");
  };

  const required = IMPORT_TEMPLATES[kind].required;
  const missingRequired = columns ? required.filter((f) => columns[f] === null || columns[f] === undefined) : [];
  const missingOptional = columns
    ? Object.entries(columns).filter(([f, i]) => i === null && !required.includes(f)).map(([f]) => colLabel(f))
    : [];
  const badLines = new Set(problems.map((p) => p.line));
  const goodRows = rows.filter((r) => !badLines.has(r.line));

  function downloadTemplate() {
    download(importTemplateCsv(kind), `${kind}-template.csv`);
  }

  function reset() {
    setFileError(null);
    setColumns(null);
    setHeader([]);
    setRows([]);
    setProblems([]);
    setChecked(false);
    setResult(null);
  }

  async function read(file: File) {
    reset();
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    // Checked in the browser first: wrong type, too big, empty or missing columns never reach the server.
    if (/\.(xlsx|xls|xlsm|ods)$/.test(lower)) return setFileError(t("excelFile"));
    if (!lower.endsWith(".csv") && file.type !== "text/csv") return setFileError(t("notCsv"));
    if (file.size > MAX_BYTES) return setFileError(t("fileTooBig"));
    let cells: string[][];
    try {
      cells = parseCsv(await file.text());
    } catch {
      return setFileError(t("unreadable"));
    }
    const [head, ...body] = cells;
    if (!head || body.length === 0) return setFileError(t("emptyFile"));
    if (body.length > MAX_ROWS) return setFileError(t("tooManyRows", { max: MAX_ROWS.toLocaleString("en-IN") }));
    const cols = k.mapColumns(head);
    setHeader(head);
    setColumns(cols);
    const mapped = body.map((cellsOfRow, i) => ({ line: i + 2, cells: cellsOfRow, ...k.mapRow(cellsOfRow, cols) }));
    setRows(mapped.map(({ line, cells: c, row }) => ({ line, cells: c, payload: row })));
    setProblems(
      mapped.flatMap((m) => m.problems.map((field) => ({ line: m.line, field, key: `why.${m.reasons[field] ?? "invalid"}`, server: false }))),
    );
  }

  /** Sends rows in batches; server problems come back numbered within the batch. */
  async function send(list: Row[], dryRun: boolean): Promise<{ ok: number; found: Problem[] }> {
    const found: Problem[] = [];
    let ok = 0;
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const res = await rpc<{ ok: number; errors: { row: number; field: string | null; message: string }[] }>(k.rpc, {
        p_rows: batch.map((r) => r.payload),
        p_dry_run: dryRun,
      });
      ok += res.ok;
      for (const e of res.errors) {
        const row = batch[e.row - 1];
        if (row) found.push({ line: row.line, field: e.field, key: e.message, server: true });
      }
      setProgress({ done: Math.min(i + BATCH, list.length), total: list.length });
    }
    return { ok, found };
  }

  async function check() {
    try {
      const local = problems.filter((p) => !p.server);
      const localBad = new Set(local.map((p) => p.line));
      // Rows already wrong in the browser aren't sent; the server checks the rest exactly as it would import them.
      const { found } = await send(rows.filter((r) => !localBad.has(r.line)), true);
      setProblems([...local, ...found].sort((a, b) => a.line - b.line));
      setChecked(true);
    } catch (e) {
      failed(e);
    } finally {
      setProgress(null);
    }
  }

  async function runImport() {
    try {
      const { ok, found } = await send(goodRows, false);
      setProblems((prev) => [...prev, ...found].sort((a, b) => a.line - b.line));
      setResult({ imported: ok, left: rows.length - ok });
      saved(tk("done", { n: ok }));
    } catch (e) {
      failed(e);
    } finally {
      setProgress(null);
    }
  }

  function downloadReport() {
    const byLine = new Map(rows.map((r) => [r.line, r.cells]));
    const csv = toCsv([
      [t("row"), t("field"), t("problem"), ...header],
      ...problems.map((p) => [p.line, colLabel(p.field), message(p), ...(byLine.get(p.line) ?? [])]),
    ]);
    download(csv, `${kind}-problems.csv`);
  }

  const canImport =
    checked && result === null && progress === null && missingRequired.length === 0 && goodRows.length > 0 && (problems.length === 0 || skipBad);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={tk("title")} description={tk("description")} />

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step0")}</CardTitle>
        <CardDescription>{t("templateHint")}</CardDescription>
        <p className="text-[0.95rem] text-text-secondary">
          {t("requiredColumns", { list: required.map((f) => colLabel(f)).join(", ") })}
        </p>
        <Button variant="secondary" className="self-start" onClick={downloadTemplate}>
          <FileDown aria-hidden />
          {t("downloadTemplate")}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step1")}</CardTitle>
        <CardDescription>{tk("step1Hint")}</CardDescription>
        <Field label={t("file")} className="max-w-md" error={fileError ?? undefined}>
          {(a) => (
            <Input
              {...a}
              type="file"
              accept=".csv,text/csv"
              className="py-2.5"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void read(file);
                e.target.value = "";
              }}
            />
          )}
        </Field>
        {fileName && !fileError && columns && (
          <div className="flex flex-col gap-1" role="status">
            <p>
              {fileName}: {t("found", { n: rows.length })}
            </p>
            {missingRequired.length > 0 && (
              <FieldError>{t("missingRequired", { list: missingRequired.map((f) => colLabel(f)).join(", ") })}</FieldError>
            )}
            {missingOptional.length > 0 && <p className="text-text-secondary">{t("missingColumns", { list: missingOptional.join(", ") })}</p>}
            {problems.length > 0 && <p className="text-bad-text">{t("rowsWithProblems", { n: badLines.size })}</p>}
          </div>
        )}
      </Card>

      {rows.length > 0 && missingRequired.length === 0 && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("step2")}</CardTitle>
          <CardDescription>{t("step2Hint")}</CardDescription>
          {badLines.size > 0 && (
            <Checkbox
              label={t("skipBad", { n: badLines.size })}
              hint={t("skipBadHint", { n: goodRows.length })}
              checked={skipBad}
              onChange={(e) => setSkipBad(e.target.checked)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={progress !== null || result !== null} onClick={() => void check()}>
              <FileSearch aria-hidden />
              {t("check")}
            </Button>
            <Button disabled={!canImport} onClick={() => void runImport()}>
              <Upload aria-hidden />
              {tk("import", { n: problems.length === 0 ? rows.length : goodRows.length })}
            </Button>
            {problems.length > 0 && (
              <Button variant="ghost" onClick={downloadReport}>
                <Download aria-hidden />
                {t("downloadReport")}
              </Button>
            )}
          </div>
          {progress && <p role="status">{t("progress", progress)}</p>}
          {result && (
            <p role="status">
              {result.left > 0 ? t("importedLeft", { n: result.imported, m: result.left }) : tk("done", { n: result.imported })} {tk("seriesHint")}
            </p>
          )}
          {checked && problems.length === 0 && result === null && <p className="text-good-text">{t("allGood")}</p>}
          {checked && problems.length > 0 && !skipBad && result === null && <p className="text-text-secondary">{t("fixOrSkip")}</p>}
        </Card>
      )}

      {problems.length > 0 && (
        <>
          {problems.length > 200 && <p className="text-text-secondary">{t("first200", { n: problems.length })}</p>}
          <Table>
            <THead>
              <tr>
                <TH>{t("row")}</TH>
                <TH>{t("field")}</TH>
                <TH>{t("problem")}</TH>
              </tr>
            </THead>
            <tbody>
              {problems.length === 0 && <EmptyRow colSpan={3}>—</EmptyRow>}
              {problems.slice(0, 200).map((p, i) => (
                <TR key={i}>
                  <TD className="tabular-nums">{p.line}</TD>
                  <TD>{colLabel(p.field)}</TD>
                  <TD>{message(p)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}

/** Saves text as a file (UTF-8 with a BOM so Excel reads ₹ and Indian names correctly). */
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
