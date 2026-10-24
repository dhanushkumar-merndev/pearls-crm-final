"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { z } from "zod";
import { formatDateTime, readSettings, requiredChoice, requiredText } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { callFunction, rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

const TARGETS = ["name", "phone", "alt_phone", "email", "treatment_text", "comments1", "comments2", "ignore"] as const;

interface MetaEvent {
  id: string;
  leadgen_id: string;
  form_id: string | null;
  status: "received" | "created" | "duplicate" | "failed";
  error: string | null;
  attempts: number;
  received_at: string;
  lead_id: string | null;
  lead_name: string | null;
  sl_no: number | null;
}

const mapSchema = z
  .object({ rows: z.array(z.object({ key: requiredText(100), target: requiredChoice(TARGETS) })).max(50, { error: "tooMany" }) })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.rows.forEach((r, i) => {
      const k = r.key.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["rows", i, "key"], message: "duplicateValue" });
      seen.add(k);
    });
  });

/**
 * Admin → Meta lead ads: where Meta sends new leads, how extra form questions map to lead
 * fields (standard questions — name, phone, email — need nothing), and every delivery with a
 * retry for the ones that failed.
 */
export function MetaLeadsScreen({ webhookUrl }: { webhookUrl: string }) {
  const t = useTranslations("metaLeads");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["app_settings", "sales"],
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("app_settings").select("value, version").eq("section", "sales").maybeSingle()) as {
        value: unknown;
        version: number;
      } | null,
  });
  const [rows, setRows] = useState<{ key: string; target: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // Copy the saved map into the form once (never over rows typed meanwhile).
    if (!settings.isSuccess || loaded) return;
    const map = readSettings("sales", settings.data?.value).meta_field_map;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time copy of server data into the editable form
    setRows(Object.entries(map).map(([key, target]) => ({ key, target })));
    setLoaded(true);
  }, [settings.isSuccess, settings.data, loaded]);
  const checks = useZodForm(mapSchema);
  const update = (i: number, patch: Partial<{ key: string; target: string }>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    for (const f of Object.keys(patch)) checks.clear(`rows.${i}.${f}`);
  };
  const save = useMutation({
    mutationFn: (map: Record<string, string>) => {
      const value = { ...readSettings("sales", settings.data?.value), meta_field_map: map };
      return rpc<number>("update_settings", { p_section: "sales", p_value: value, p_version: settings.data?.version ?? 0 });
    },
    onSuccess: () => {
      saved(t("mapSaved"));
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    },
    onError: failed,
  });

  const events = useInfiniteQuery({
    queryKey: ["meta_lead_events"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: MetaEvent[]; next_cursor: string | null }>("meta_lead_events_list", { p_cursor: pageParam, p_limit: 20 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const retry = useMutation({
    mutationFn: (leadgenId: string) => callFunction<{ status: string }>("meta-leads", { action: "retry", leadgen_id: leadgenId }),
    onSuccess: (r) => {
      saved(t("retried", { status: t(`status.${r.status}`) }));
      void queryClient.invalidateQueries({ queryKey: ["meta_lead_events"] });
    },
    onError: failed,
  });
  const items = events.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("setupTitle")}</CardTitle>
        <CardDescription>{t("setupHint")}</CardDescription>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("callbackUrl")} className="min-w-72 flex-1">
            {(a) => <Input {...a} readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />}
          </Field>
          <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => saved(t("copied")))}>
            <Copy aria-hidden />
            {t("copy")}
          </Button>
        </div>
        <ol className="list-decimal pl-6 text-[0.95rem] text-text-secondary">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
          <li>{t("step4")}</li>
        </ol>
        <Link href="/leads/pool" className="self-start text-link underline-offset-4 hover:underline">
          {t("poolLink")}
        </Link>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("mapTitle")}</CardTitle>
        <CardDescription>{t("mapHint")}</CardDescription>
        {rows.length === 0 && <p className="text-text-secondary">{t("noMap")}</p>}
        {rows.map((r, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-start">
            <Field label={t("question")} error={checks.error(`rows.${i}.key`)}>
              {(a) => <Input {...a} maxLength={100} placeholder="e.g. which_treatment?" value={r.key} onChange={(e) => update(i, { key: e.target.value })} />}
            </Field>
            <Field label={t("goesTo")} error={checks.error(`rows.${i}.target`)}>
              {(a) => (
                <Select {...a} value={r.target} onChange={(e) => update(i, { target: e.target.value })}>
                  <option value="">{t("choose")}</option>
                  {TARGETS.map((x) => (
                    <option key={x} value={x}>
                      {t(`target.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="ghost" className="sm:mt-7" aria-label={t("removeRow", { n: i + 1 })} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!loaded} onClick={() => setRows((rs) => [...rs, { key: "", target: "" }])}>
            <Plus aria-hidden />
            {t("addRow")}
          </Button>
          <Button
            disabled={save.isPending || !loaded}
            onClick={() => {
              const d = checks.validate({ rows });
              if (d) save.mutate(Object.fromEntries(d.rows.map((r) => [r.key, r.target])));
            }}
          >
            <Save aria-hidden />
            {t("saveMap")}
          </Button>
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("eventsTitle")}</h2>
        <Table>
          <THead>
            <tr>
              <TH>{t("col.when")}</TH>
              <TH>{t("col.status")}</TH>
              <TH>{t("col.lead")}</TH>
              <TH>{t("col.problem")}</TH>
              <TH className="text-right">
                <span className="sr-only">{t("col.actions")}</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {events.isPending && <EmptyRow colSpan={5}>{t("loading")}</EmptyRow>}
            {events.isSuccess && items.length === 0 && <EmptyRow colSpan={5}>{t("noEvents")}</EmptyRow>}
            {items.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap">{formatDateTime(new Date(e.received_at))}</TD>
                <TD>
                  <StatusBadge
                    kind={e.status === "created" ? "good" : e.status === "duplicate" ? "warning" : e.status === "failed" ? "critical" : "serious"}
                    label={t(`status.${e.status}`)}
                  />
                </TD>
                <TD>
                  {e.lead_id ? (
                    <Link href={`/leads/${e.lead_id}`} className="text-link underline-offset-4 hover:underline">
                      #{e.sl_no} {e.lead_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD className="max-w-md text-[0.95rem] text-text-secondary">{e.error ?? "—"}</TD>
                <TD className="text-right">
                  {(e.status === "failed" || e.status === "received") && (
                    <Button variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate(e.leadgen_id)}>
                      <RotateCcw aria-hidden />
                      {t("retry")}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        {events.hasNextPage && (
          <Button variant="secondary" className="self-start" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            {t("more")}
          </Button>
        )}
      </section>
    </div>
  );
}
