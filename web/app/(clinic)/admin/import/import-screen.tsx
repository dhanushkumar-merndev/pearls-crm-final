"use client";

import { FileSearch, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { mapPatientColumns, mapPatientRow, mapStockColumns, mapStockRow, parseCsv, type MappedRow } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

const BATCH = 500;
interface Problem {
  row: number;
  field: string | null;
  message: string;
}

export type ImportKind = "patients" | "stock";

const KINDS: Record<ImportKind, {
  mapColumns: (header: string[]) => Record<string, number | null>;
  mapRow: (cells: string[], cols: Record<string, number | null>) => MappedRow;
  rpc: string;
  /** Translation prefix: "" for patients (the original keys), "stock." for opening stock. */
  prefix: string;
}> = {
  patients: { mapColumns: mapPatientColumns, mapRow: mapPatientRow, rpc: "import_patients", prefix: "" },
  stock: { mapColumns: mapStockColumns, mapRow: mapStockRow, rpc: "import_opening_stock", prefix: "stock." },
};

/** DocPulse (or any sheet) → patients or opening stock. Check first (nothing saved), then import in batches of 500. */
export function ImportScreen({ kind = "patients" }: { kind?: ImportKind }) {
  const t = useTranslations("import");
  const errs = useTranslations("errors");
  const k = KINDS[kind];
  const tk = (key: string, values?: Record<string, string | number>) => t(`${k.prefix}${key}`, values);
  const { saved, failed } = useFeedback();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [columns, setColumns] = useState<Record<string, number | null> | null>(null);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const missing = columns ? Object.entries(columns).filter(([, i]) => i === null).map(([f]) => tk(`col.${f}`)) : [];

  async function read(file: File) {
    setChecked(false);
    setImported(null);
    const cells = parseCsv(await file.text());
    const [header, ...body] = cells;
    if (!header) return setRows([]);
    const cols = k.mapColumns(header);
    setColumns(cols);
    const mapped = body.map((r) => k.mapRow(r, cols));
    setRows(mapped.map((m) => m.row));
    setProblems(mapped.flatMap((m, i) => m.problems.map((field) => ({ row: i + 2, field, message: t("badCell") }))));
  }

  async function run(dryRun: boolean) {
    const found: Problem[] = [];
    let ok = 0;
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const res = await rpc<{ ok: number; errors: Problem[] }>(k.rpc, { p_rows: batch, p_dry_run: dryRun });
        ok += res.ok;
        found.push(...res.errors.map((e) => ({ ...e, row: e.row + i + 1 })));
        setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
      }
      if (dryRun) {
        setProblems(found);
        setChecked(true);
      } else {
        setImported(ok);
        setProblems(found);
        saved(tk("done", { n: ok }));
      }
    } catch (e) {
      failed(e);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={tk("title")} description={tk("description")} />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("step1")}</CardTitle>
        <CardDescription>{tk("step1Hint")}</CardDescription>
        <Field label={t("file")} className="max-w-md">
          {(a) => <Input {...a} type="file" accept=".csv,text/csv" className="py-2.5" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />}
        </Field>
        {columns && (
          <p className="text-text-secondary">
            {t("found", { n: rows.length })} {missing.length > 0 && t("missingColumns", { list: missing.join(", ") })}
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("step2")}</CardTitle>
          <CardDescription>{t("step2Hint")}</CardDescription>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={progress !== null} onClick={() => void run(true)}>
              <FileSearch aria-hidden />
              {t("check")}
            </Button>
            <Button disabled={!checked || problems.length > 0 || progress !== null || imported !== null} onClick={() => void run(false)}>
              <Upload aria-hidden />
              {tk("import", { n: rows.length })}
            </Button>
          </div>
          {progress && (
            <p role="status">
              {t("progress", progress)}
            </p>
          )}
          {imported !== null && <p role="status">{tk("done", { n: imported })} {tk("seriesHint")}</p>}
          {checked && problems.length === 0 && imported === null && <p className="text-good-text">{t("allGood")}</p>}
        </Card>
      )}

      {problems.length > 0 && (
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
                <TD className="tabular-nums">{p.row}</TD>
                <TD>{p.field ? tk(`col.${p.field}`) : "—"}</TD>
                <TD>{p.message === "duplicate" ? tk("duplicateRow") : errs.has(p.message) ? errs(p.message) : p.message}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
