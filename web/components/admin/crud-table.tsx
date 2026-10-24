"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { formatINR } from "@pearl/shared";
import { MoneyInput, GST_RATES_BP } from "@/components/forms/money-input";
import { LibraryCombobox, useDebounced, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { newId, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { crudSchema, type FieldDef } from "./crud-schema";

export type { FieldDef } from "./crud-schema";

export type Row = Record<string, unknown> & { id: string };

export interface ColumnDef {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
  className?: string;
}

export interface CrudConfig {
  table: string;
  /** PostgREST select, including joins used by lookup fields' labelPath. */
  select: string;
  searchColumn: string;
  order: { column: string; ascending?: boolean }[];
  /** Fixed equality filters, e.g. { kind: "payment_mode" }. Also written on insert. */
  where?: Record<string, string>;
  columns: ColumnDef[];
  fields: FieldDef[];
  /** Values for a new row. */
  defaults?: Record<string, unknown>;
  /** Show the Active / Inactive badge column (rows have an `active` column). */
  hasActive?: boolean;
  /** Extra buttons per row (e.g. "Schedule" for doctors). */
  rowActions?: (row: Row) => ReactNode;
  pageSize?: number;
}

const read = (row: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), row);

export const money = (key: string) => (row: Row) => (typeof row[key] === "number" ? formatINR(row[key] as number) : "—");
export const gstLabel = (bp: unknown) => (typeof bp === "number" ? `${bp / 100}%` : "—");

/** Admin master-data table: server search + offset paging (exact count), add / edit dialog. */
export function CrudTable({ config, title, addLabel }: { config: CrudConfig; title: string; addLabel: string }) {
  const t = useTranslations("common");
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const search = useDebounced(q.trim());
  const limit = Math.min(config.pageSize ?? 25, 100);
  const key = ["crud", config.table, config.where, search, offset];

  const list = useQuery({
    queryKey: key,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabaseBrowser().from(config.table).select(config.select, { count: "exact" });
      for (const [column, value] of Object.entries(config.where ?? {})) query = query.eq(column, value);
      if (search) query = query.ilike(config.searchColumn, `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      for (const o of config.order) query = query.order(o.column, { ascending: o.ascending ?? true });
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      unwrap({ data, error });
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  const colCount = config.columns.length + (config.hasActive ? 2 : 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder={t("searchIn", { what: title })}
            aria-label={t("searchIn", { what: title })}
            className="pl-11"
          />
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </div>

      <Table>
        <THead>
          <tr>
            {config.columns.map((c) => (
              <TH key={c.key} className={c.className}>
                {c.label}
              </TH>
            ))}
            {config.hasActive && <TH>{t("status")}</TH>}
            <TH className="text-right">
              <span className="sr-only">{t("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={colCount}>{t("loading")}</EmptyRow>}
          {list.isError && <EmptyRow colSpan={colCount}>{t("loadFailed")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={colCount}>{search ? t("noMatches") : t("empty")}</EmptyRow>}
          {list.data?.rows.map((row) => (
            <TR key={row.id}>
              {config.columns.map((c) => (
                <TD key={c.key} className={c.className}>
                  {c.render ? c.render(row) : String(read(row, c.key) ?? "—")}
                </TD>
              ))}
              {config.hasActive && (
                <TD>
                  {row.active ? (
                    <StatusBadge kind="good" label={t("active")} />
                  ) : (
                    <StatusBadge kind="serious" label={t("inactive")} />
                  )}
                </TD>
              )}
              <TD className="text-right whitespace-nowrap">
                {config.rowActions?.(row)}
                <Button variant="ghost" onClick={() => setEditing(row)}>
                  <Pencil aria-hidden />
                  {t("edit")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={limit} total={list.data.total} onOffset={setOffset} />}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null && (
          <CrudForm
            config={config}
            row={editing === "new" ? null : editing}
            title={editing === "new" ? addLabel : t("editWhat", { what: title })}
            onDone={() => {
              setEditing(null);
              void queryClient.invalidateQueries({ queryKey: ["crud", config.table] });
              void queryClient.invalidateQueries({ queryKey: ["library"] });
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function initialValues(config: CrudConfig, row: Row | null): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of config.fields) {
    if (f.type === "lookup") {
      const id = row?.[f.key] as string | null | undefined;
      values[f.key] = id ? ({ id, label: String(read(row!, f.labelPath) ?? ""), subtitle: null, on_the_fly: false, defaults: {} } as LibraryItem) : null;
    } else if (f.type === "int_list") {
      const list = (row?.[f.key] ?? config.defaults?.[f.key]) as number[] | undefined;
      values[f.key] = list ? list.join(", ") : "";
    } else {
      values[f.key] = row ? row[f.key] : (config.defaults?.[f.key] ?? (f.type === "boolean" ? false : f.type === "gst" ? 0 : null));
    }
  }
  if (config.hasActive) values.active = row ? row.active : true;
  return values;
}

function CrudForm({ config, row, title, onDone }: { config: CrudConfig; row: Row | null; title: string; onDone: () => void }) {
  const t = useTranslations("common");
  const { saved, failed } = useFeedback();
  const [values, setValues] = useState(() => initialValues(config, row));
  const schema = useMemo(() => crudSchema(config), [config]);
  const form = useZodForm(schema);
  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    form.clear(key);
  };

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const db = getSupabaseBrowser().from(config.table);
      if (row) unwrap(await db.update(payload).eq("id", row.id).select("id").single());
      else unwrap(await db.insert({ id: newId(), ...config.where, ...payload }).select("id").single());
    },
    onSuccess: () => {
      saved();
      onDone();
    },
    onError: failed,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = form.validate(values);
    if (payload) save.mutate(payload);
  }

  return (
    <DialogContent
      title={title}
      wide={config.fields.length > 6}
      footer={
        <Button type="submit" form="crud-form" disabled={save.isPending}>
          <Save aria-hidden />
          {save.isPending ? t("saving") : t("save")}
        </Button>
      }
    >
      <form id="crud-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {config.fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" || f.type === "boolean" ? "sm:col-span-2" : undefined}>
            {f.type === "boolean" ? (
              <Checkbox label={f.label} hint={f.hint} checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
            ) : (
              <Field label={f.label} hint={f.hint} error={form.error(f.key)}>
                {(a) => <FieldControl field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} a11y={a} />}
              </Field>
            )}
          </div>
        ))}
        {config.hasActive && (
          <Checkbox
            className="sm:col-span-2"
            label={t("activeLabel")}
            hint={t("activeHint")}
            checked={Boolean(values.active)}
            onChange={(e) => set("active", e.target.checked)}
          />
        )}
      </form>
    </DialogContent>
  );
}

function FieldControl({
  field: f,
  value,
  onChange,
  a11y,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };
}) {
  const t = useTranslations("common");
  switch (f.type) {
    case "textarea":
      return <Textarea {...a11y} value={String(value ?? "")} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <Input
          {...a11y}
          type="number"
          inputMode="numeric"
          min={f.min}
          max={f.max}
          step={f.step ?? 1}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "money":
      return <MoneyInput {...a11y} value={(value as number | null) ?? null} onChange={onChange} />;
    case "gst":
      return (
        <Select {...a11y} value={String(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))}>
          {GST_RATES_BP.map((bp) => (
            <option key={bp} value={bp}>
              {bp / 100}%
            </option>
          ))}
        </Select>
      );
    case "select":
      return (
        <Select {...a11y} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}>
          {!f.required && <option value="">{t("none")}</option>}
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "lookup":
      return (
        <LibraryCombobox
          id={a11y.id}
          invalid={a11y["aria-invalid"]}
          kind={f.kind}
          value={(value as LibraryItem | null) ?? null}
          onChange={onChange}
        />
      );
    case "int_list":
      return <Input {...a11y} inputMode="numeric" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input {...a11y} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} />;
    case "boolean":
      return null;
    default:
      return (
        <Input
          {...a11y}
          type={f.type}
          maxLength={"maxLength" in f ? f.maxLength : undefined}
          inputMode={f.type === "tel" ? "tel" : f.type === "email" ? "email" : undefined}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
