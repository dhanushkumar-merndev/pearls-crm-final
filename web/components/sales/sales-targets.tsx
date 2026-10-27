"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR, istDateString } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/ui/page";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { pct } from "@/lib/periods";
import { rpc } from "@/lib/rpc";
import { targetSchema } from "@/lib/schemas/ops";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

const METRICS = ["converted", "agreed_paise", "calls"] as const;
type Metric = (typeof METRICS)[number];
interface Progress {
  target: number | null;
  actual: number;
}
interface Person extends Record<Metric, Progress> {
  staff_id: string;
  name: string;
  role: string;
}
interface Month {
  month: string;
  enabled: boolean;
  people: Person[];
}

const show = (m: Metric, v: number) => (m === "agreed_paise" ? formatINR(v) : v.toLocaleString("en-IN"));

/** Monthly targets per salesperson (PLAN.md C3 sales_targets, optional). */
export function SalesTargets({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("targets");
  const [month, setMonth] = useState(() => istDateString(new Date()).slice(0, 7));
  const data = useQuery({
    queryKey: ["sales_targets_month", month],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: () => rpc<Month>("sales_targets_month", { p_month: `${month}-01` }),
  });
  const d = data.data;
  return (
    <Page>
      <PageHeader title={t("title")} description={canEdit ? t("description") : t("descriptionManager")} />
      {d && !d.enabled && (
        <p role="status" className="rounded-xl border border-border p-4">
          {t("off")}{" "}
          {/* Inside a sentence a link needs more than its colour: always underlined. */}
          {canEdit && <Link href="/admin/settings" className="text-link underline underline-offset-4">{t("turnOn")}</Link>}
        </p>
      )}
      <Field label={t("month")} className="max-w-xs">
        {(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}
      </Field>
      <Table>
        <THead>
          <tr>
            <TH>{t("person")}</TH>
            {METRICS.map((m) => (
              <TH key={m}>{t(`metric.${m}`)}</TH>
            ))}
          </tr>
        </THead>
        <tbody>
          {d && d.people.length === 0 && <EmptyRow colSpan={4}>{t("nobody")}</EmptyRow>}
          {d?.people.map((p) => (
            <TR key={`${p.staff_id}:${d.month}`}>
              <TD className="font-medium">{p.name}</TD>
              {METRICS.map((m) => (
                <TD key={m}>
                  {canEdit ? <TargetCell person={p} metric={m} month={d.month} /> : null}
                  <p className="text-[0.95rem] text-text-secondary tabular-nums">
                    {p[m].target
                      ? t("progress", { actual: show(m, p[m].actual), target: show(m, p[m].target), pct: pct(p[m].actual, p[m].target) })
                      : t("actualOnly", { actual: show(m, p[m].actual) })}
                  </p>
                </TD>
              ))}
            </TR>
          ))}
        </tbody>
      </Table>
    </Page>
  );
}

function TargetCell({ person, metric, month }: { person: Person; metric: Metric; month: string }) {
  const t = useTranslations("targets");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const current = person[metric].target;
  // Amounts are typed in rupees and stored in paise.
  const [value, setValue] = useState(current === null ? "" : String(metric === "agreed_paise" ? current / 100 : current));
  const checks = useZodForm(targetSchema);
  const save = useMutation({
    mutationFn: async () => {
      const clean = checks.validate({ value });
      if (!clean) return null;
      const n = clean.value === "" ? 0 : Number(clean.value);
      return rpc("set_sales_target", { p_staff_id: person.staff_id, p_month: month, p_metric: metric, p_target: metric === "agreed_paise" ? n * 100 : n });
    },
    onSuccess: (res) => {
      if (res === null) return;
      saved();
      void queryClient.invalidateQueries({ queryKey: ["sales_targets_month"] });
    },
    onError: failed,
  });
  return (
    <form
      noValidate
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label={t("targetFor", { name: person.name, metric: t(`metric.${metric}`) })} labelClassName="sr-only" error={checks.error("value")} className="w-36">
        {(a) => <Input {...a} inputMode="numeric" value={value} placeholder="—" onChange={(e) => (setValue(e.target.value), checks.clear("value"))} />}
      </Field>
      <Button type="submit" variant="ghost" size="icon" aria-label={t("saveFor", { name: person.name, metric: t(`metric.${metric}`) })} disabled={save.isPending}>
        <Save aria-hidden />
      </Button>
    </form>
  );
}
