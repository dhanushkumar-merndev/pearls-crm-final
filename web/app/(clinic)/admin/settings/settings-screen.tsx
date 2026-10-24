"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { financialYear, readSettings, SETTINGS_SCHEMAS, type SettingsSection } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, PageHeader, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asAppError, rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { numberSeriesSchema } from "@/lib/schemas/admin";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

type FieldKind = "int" | "bool" | "time" | "weekdays" | "percent_bp" | "int_list" | { options: string[] };
const SECTIONS: { section: SettingsSection; fields: Record<string, FieldKind> }[] = [
  {
    section: "appointments",
    fields: {
      slot_minutes: "int",
      capacity_per_slot: "int",
      day_start: "time",
      day_end: "time",
      working_days: "weekdays",
      confirm_hours_before: "int",
      reminder_hours_before: "int",
      walk_in_queue: "bool",
    },
  },
  {
    section: "billing",
    fields: {
      tax_inclusive: "bool",
      round_to_rupee: "bool",
      receptionist_max_discount_bp: "percent_bp",
      ip_number_mode: { options: ["separate", "uhid"] },
    },
  },
  { section: "pharmacy", fields: { near_expiry_days: "int_list", negative_stock: { options: ["block", "warn"] }, prices_include_gst: "bool" } },
  { section: "security", fields: { idle_logout_minutes: "int" } },
  { section: "sales", fields: { round_robin: "bool", targets_enabled: "bool", reception_can_play_recordings: "bool" } },
  { section: "notifications", fields: { daily_summary_enabled: "bool", daily_summary_time: "time" } },
];

export function SettingsScreen() {
  const t = useTranslations("settings");
  const stored = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("app_settings").select("section, value, version")) as {
        section: string;
        value: unknown;
        version: number;
      }[],
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {stored.data &&
        SECTIONS.map(({ section, fields }) => {
          const row = stored.data.find((r) => r.section === section);
          return <SectionForm key={section} section={section} fields={fields} value={row?.value} version={row?.version ?? 0} />;
        })}
      <NumberSeries />
    </div>
  );
}

function SectionForm({
  section,
  fields,
  value,
  version,
}: {
  section: SettingsSection;
  fields: Record<string, FieldKind>;
  value: unknown;
  version: number;
}) {
  const t = useTranslations("settings");
  const c = useTranslations("common");
  const days = useTranslations("doctorHours.weekday");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const v = { ...readSettings(section, value) } as Record<string, unknown>;
    // Lists are edited as text ("90, 60, 30") and read back on save.
    for (const [k, kind] of Object.entries(fields)) if (kind === "int_list") v[k] = ((v[k] as number[]) ?? []).join(", ");
    return v;
  });
  const checks = useZodForm(SETTINGS_SCHEMAS[section]);
  const set = (k: string, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    checks.clear(k);
  };
  // A number box left empty is NaN (so it's reported), never a silent default.
  const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

  const save = useMutation({
    mutationFn: (clean: unknown) => rpc<number>("update_settings", { p_section: section, p_value: clean, p_version: version }),
    onSuccess: () => {
      saved();
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    },
    onError: failed,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const value: Record<string, unknown> = { ...form };
    for (const [k, kind] of Object.entries(fields)) {
      if (kind === "int_list") value[k] = String(form[k] ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
    }
    const clean = checks.validate(value);
    if (clean) save.mutate(clean);
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <CardTitle>{t(`${section}.title`)}</CardTitle>
          <CardDescription>{t(`${section}.description`)}</CardDescription>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(fields).map(([key, kind]) => {
            const label = t(`${section}.${key}`);
            const err = checks.error(key) ?? checks.error(`${key}.0`);
            if (kind === "bool")
              return <Checkbox key={key} label={label} checked={Boolean(form[key])} onChange={(e) => set(key, e.target.checked)} className="sm:col-span-2" />;
            if (kind === "weekdays")
              return (
                <fieldset key={key} className="sm:col-span-2">
                  <legend className="mb-1 font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-x-4">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const list = (form[key] as number[]) ?? [];
                      return (
                        <Checkbox
                          key={d}
                          label={days(String(d))}
                          checked={list.includes(d)}
                          onChange={(e) => set(key, e.target.checked ? [...list, d].sort() : list.filter((x) => x !== d))}
                        />
                      );
                    })}
                  </div>
                  {err && (
                    <p role="alert" className="text-[0.95rem] text-bad-text">
                      {err}
                    </p>
                  )}
                </fieldset>
              );
            return (
              <Field key={key} label={label} error={err}>
                {(a) =>
                  typeof kind === "object" ? (
                    <Select {...a} value={String(form[key])} onChange={(e) => set(key, e.target.value)}>
                      {kind.options.map((o) => (
                        <option key={o} value={o}>
                          {t(`${section}.${key}_${o}`)}
                        </option>
                      ))}
                    </Select>
                  ) : kind === "time" ? (
                    <Input {...a} type="time" value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)} />
                  ) : kind === "int_list" ? (
                    <Input {...a} inputMode="numeric" value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)} />
                  ) : kind === "percent_bp" ? (
                    <Input
                      {...a}
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={Number.isNaN(Number(form[key])) ? "" : Number(form[key] ?? 0) / 100}
                      onChange={(e) => set(key, Math.round(toNumber(e.target.value) * 100))}
                    />
                  ) : (
                    <Input
                      {...a}
                      type="number"
                      inputMode="numeric"
                      value={Number.isNaN(form[key]) ? "" : String(form[key] ?? "")}
                      onChange={(e) => set(key, toNumber(e.target.value))}
                    />
                  )
                }
              </Field>
            );
          })}
        </div>
        <Button type="submit" disabled={save.isPending} className="self-start">
          <Save aria-hidden />
          {save.isPending ? c("saving") : c("save")}
        </Button>
      </form>
    </Card>
  );
}

interface Series {
  series_key: string;
  fy: string;
  prefix: string;
  format: string;
  padding: number;
  next_value: number;
  last_used: number;
}
const SERIES_KEYS = ["uhid", "ip_number", "procedure_receipt", "pharmacy_invoice", "final_bill"] as const;

function NumberSeries() {
  const t = useTranslations("settings.series");
  const c = useTranslations("common");
  const fy = financialYear(new Date()).label;
  const [editing, setEditing] = useState<{ seriesKey: string; fy: string; row?: Series } | null>(null);
  const list = useQuery({
    queryKey: ["number_series", fy],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser()
          .from("number_series")
          .select("series_key, fy, prefix, format, padding, next_value, last_used")
          .in("fy", ["ALL", fy]),
      ) as Series[],
  });
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description", { fy })}</CardDescription>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>{t("which")}</TH>
            <TH>{t("next")}</TH>
            <TH>{t("lastUsed")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
          {list.data &&
            SERIES_KEYS.map((key) => {
              const seriesFy = key === "uhid" ? "ALL" : fy;
              const row = list.data.find((r) => r.series_key === key && r.fy === seriesFy);
              return (
                <TR key={key}>
                  <TD>{t(`key.${key}`)}</TD>
                  <TD className="tabular-nums">{row ? preview(row, row.next_value) : t("notSet")}</TD>
                  <TD className="tabular-nums">{row && row.last_used > 0 ? preview(row, row.last_used) : "—"}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" onClick={() => setEditing({ seriesKey: key, fy: seriesFy, row })}>
                      <Pencil aria-hidden />
                      {c("edit")}
                    </Button>
                  </TD>
                </TR>
              );
            })}
        </tbody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <SeriesDialog {...editing} onDone={() => (setEditing(null), void list.refetch())} />}
      </Dialog>
    </Card>
  );
}

/** Same formatting as private.format_number in SQL. */
export function preview(s: Pick<Series, "format" | "prefix" | "fy" | "padding">, n: number): string {
  const num = String(n).padStart(s.padding, "0");
  return s.format
    .replaceAll("{prefix}", s.prefix)
    .replaceAll("{fyfull}", s.fy)
    .replaceAll("{fy}", s.fy === "ALL" ? "" : s.fy.slice(-5))
    .replaceAll("{n}", num);
}

function SeriesDialog({ seriesKey, fy, row, onDone }: { seriesKey: string; fy: string; row?: Series; onDone: () => void }) {
  const t = useTranslations("settings.series");
  const c = useTranslations("common");
  const { saved, failed } = useFeedback();
  const [form, setForm] = useState({
    prefix: row?.prefix ?? "",
    format: row?.format ?? (seriesKey === "uhid" ? "{prefix}{n}" : "{prefix}/{fy}/{n}"),
    next_value: String(row?.next_value ?? 1),
    padding: String(row?.padding ?? 0),
  });
  const [schema] = useState(() => numberSeriesSchema((row?.last_used ?? 0) + 1));
  const checks = useZodForm(schema);
  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    checks.clear(key);
  };
  const save = useMutation({
    mutationFn: (d: { prefix: string; format: string; next_value: number; padding: number }) =>
      rpc("set_number_series", {
        p_key: seriesKey,
        p_fy: fy,
        p_prefix: d.prefix,
        p_format: d.format,
        p_next_value: d.next_value,
        p_padding: d.padding,
      }),
    onSuccess: () => {
      saved();
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "series_below_used") return checks.setError("next_value", "errors.series_below_used");
      failed(e);
    },
  });
  const nextShown = Number(form.next_value) || 0;
  const paddingShown = Math.min(Math.max(Number(form.padding) || 0, 0), 10);
  return (
    <DialogContent
      title={t(`key.${seriesKey}`)}
      description={t("dialogHint")}
      footer={
        <Button type="submit" form="series-form" disabled={save.isPending}>
          <Save aria-hidden />
          {c("save")}
        </Button>
      }
    >
      <form
        id="series-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const d = checks.validate(form);
          if (d) save.mutate(d);
        }}
      >
        <Field label={t("prefix")} error={checks.error("prefix")}>
          {(a) => <Input {...a} maxLength={20} value={form.prefix} onChange={(e) => set("prefix", e.target.value)} />}
        </Field>
        <Field label={t("format")} hint={t("formatHint")} error={checks.error("format")}>
          {(a) => <Input {...a} maxLength={60} value={form.format} onChange={(e) => set("format", e.target.value)} />}
        </Field>
        <Field label={t("nextNumber")} hint={row ? t("nextHint", { used: row.last_used }) : undefined} error={checks.error("next_value")}>
          {(a) => <Input {...a} type="number" min={(row?.last_used ?? 0) + 1} value={form.next_value} onChange={(e) => set("next_value", e.target.value)} />}
        </Field>
        <Field label={t("padding")} hint={t("paddingHint")} error={checks.error("padding")}>
          {(a) => <Input {...a} type="number" min={0} max={10} value={form.padding} onChange={(e) => set("padding", e.target.value)} />}
        </Field>
        <p className="rounded-xl border border-border bg-secondary p-3">
          {t("looksLike")} <strong className="tabular-nums">{preview({ ...form, padding: paddingShown, fy }, nextShown)}</strong>
        </p>
      </form>
    </DialogContent>
  );
}
