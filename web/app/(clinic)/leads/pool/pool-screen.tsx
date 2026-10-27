"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { z } from "zod";
import { formatDateTime, requiredInt } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Checkbox, PageHeader } from "@/components/ui/form";
import { FieldError, Input } from "@/components/ui/input";
import { Page } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/use-me";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Member {
  staff_id: string;
  name: string;
  staff_active: boolean;
  in_pool: boolean;
  source_ids: string[];
  sort: number;
  last_assigned_at: string | null;
  open_leads: number;
}
interface Pool {
  round_robin: boolean;
  members: Member[];
}

const poolSchema = z.object({
  members: z.array(z.object({ staff_id: z.string(), in_pool: z.boolean(), source_ids: z.array(z.string()), sort: requiredInt(0, 10000) })),
});

/**
 * Who takes new leads (Meta, imports, walk-ins without an owner): round-robin among the ticked
 * executives, longest-waiting first, optionally only for some sources. Inactive staff are skipped.
 */
export function PoolScreen() {
  const t = useTranslations("leads");
  const me = useMe();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const pool = useQuery({ queryKey: ["lead_pool"], queryFn: () => rpc<Pool>("lead_pool_list") });
  const sources = useQuery({
    queryKey: ["lead_sources_all"],
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser().from("lookup_values").select("id, label").eq("kind", "lead_source").eq("active", true).order("sort").order("label").limit(100),
      ) as { id: string; label: string }[],
  });
  const [rows, setRows] = useState<(Member & { sortText: string })[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fill = (p: Pool) => setRows(p.members.map((m) => ({ ...m, sortText: String(m.sort) })));
  useEffect(() => {
    // Copy the server list into the form once; a background refetch must not wipe unsaved edits.
    if (!pool.data || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time copy of server data into the editable form
    fill(pool.data);
    setLoaded(true);
  }, [pool.data, loaded]);
  const checks = useZodForm(poolSchema);
  const update = (i: number, patch: Partial<Member & { sortText: string }>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    checks.clear(`members.${i}.sort`);
  };
  const save = useMutation({
    mutationFn: (members: z.output<typeof poolSchema>["members"]) => rpc<Pool>("save_lead_pool", { p_members: members }),
    onSuccess: (p) => {
      saved(t("poolSaved"));
      queryClient.setQueryData(["lead_pool"], p);
      fill(p);
    },
    onError: failed,
  });

  return (
    <Page>
      <PageHeader back={{ href: "/leads", label: t("backToLeads") }} title={t("poolTitle")} description={t("poolHint")} />
      {pool.data && (
        <Card className="flex flex-wrap items-center gap-3">
          <StatusBadge kind={pool.data.round_robin ? "good" : "serious"} label={pool.data.round_robin ? t("rrOn") : t("rrOff")} />
          <CardDescription className="flex-1">{pool.data.round_robin ? t("rrOnHint") : t("rrOffHint")}</CardDescription>
          {me?.role === "admin" && (
            <Button asChild variant="ghost">
              <Link href="/admin/settings">
                <Settings aria-hidden />
                {t("rrSetting")}
              </Link>
            </Button>
          )}
        </Card>
      )}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.exec")}</TH>
            <TH>{t("col.inPool")}</TH>
            <TH>{t("col.sources")}</TH>
            <TH>{t("col.order")}</TH>
            <TH className="text-right">{t("col.openLeads")}</TH>
            <TH>{t("col.lastAssigned")}</TH>
          </tr>
        </THead>
        <tbody>
          {pool.isPending && <RowSkeletons asRow rows={3} cols={6} />}
          {pool.data && rows.length === 0 && <EmptyRow colSpan={6}>{t("noExecs")}</EmptyRow>}
          {rows.map((r, i) => (
            <TR key={r.staff_id}>
              <TD>
                <span className="font-medium">{r.name}</span>
                {!r.staff_active && <span className="block text-[0.9rem] text-text-secondary">{t("inactiveSkipped")}</span>}
              </TD>
              <TD>
                <Checkbox label={t("takesLeads")} checked={r.in_pool} onChange={(e) => update(i, { in_pool: e.target.checked })} />
              </TD>
              <TD className="min-w-64">
                <p className="mb-1 text-[0.9rem] text-text-secondary">{r.source_ids.length === 0 ? t("allSources") : t("onlySources")}</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sourcesFor", { name: r.name })}>
                  {sources.data?.map((s) => {
                    const on = r.source_ids.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update(i, { source_ids: on ? r.source_ids.filter((x) => x !== s.id) : [...r.source_ids, s.id] })}
                        className={`min-h-10 rounded-full border px-3.5 text-[0.95rem] ${on ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-popover-accent"}`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </TD>
              <TD className="w-28">
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  aria-label={t("orderFor", { name: r.name })}
                  aria-invalid={checks.error(`members.${i}.sort`) ? true : undefined}
                  value={r.sortText}
                  onChange={(e) => update(i, { sortText: e.target.value })}
                />
                <FieldError>{checks.error(`members.${i}.sort`)}</FieldError>
              </TD>
              <TD className="text-right tabular-nums">{r.open_leads}</TD>
              <TD className="text-[0.9rem] text-text-secondary">{r.last_assigned_at ? formatDateTime(new Date(r.last_assigned_at)) : "—"}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {rows.length > 0 && (
        <Button
          className="self-end"
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ members: rows.map((r) => ({ staff_id: r.staff_id, in_pool: r.in_pool, source_ids: r.source_ids, sort: r.sortText })) });
            if (d) save.mutate(d.members);
          }}
        >
          <Save aria-hidden />
          {t("savePool")}
        </Button>
      )}
    </Page>
  );
}
