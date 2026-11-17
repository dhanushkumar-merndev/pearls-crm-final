"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { formatDate, formatINR } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { newId, rpc } from "@/lib/rpc";
import { breakdownTargetSchema } from "@/lib/schemas/billing";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import type { BillChip, BreakdownBill, BreakdownPreset, BreakdownSources, SourcesData } from "./types";

type Picked = { sessions: Set<string>; stays: Set<string>; bills: Set<string> };
const none = (): Picked => ({ sessions: new Set(), stays: new Set(), bills: new Set() });

/** Where a target's bills come from: its sessions, its IP stays, and bills for the whole treatment. */
function targetParts(data: SourcesData | undefined, target: string) {
  if (!data) return null;
  if (target.startsWith("t:")) {
    const tr = data.treatments.find((x) => x.id === target.slice(2));
    return tr ? { treatment: tr, sessions: tr.sessions, stays: tr.stays, extra: tr.bills } : null;
  }
  if (target.startsWith("s:")) {
    const st = data.stays.find((x) => x.id === target.slice(2));
    return st ? { treatment: null, sessions: [], stays: [st], extra: [] as BillChip[] } : null;
  }
  if (target === "other") return { treatment: null, sessions: [], stays: [], extra: data.other_bills };
  return { treatment: null, sessions: [], stays: [], extra: [] as BillChip[] };
}

/** Everything ticked for a surgery or stay; only the given bill for "other bills". */
function startPicked(data: SourcesData | undefined, target: string, preset?: BreakdownPreset, sources?: BreakdownSources): Picked {
  const parts = targetParts(data, target);
  if (!parts) return none();
  if (sources) {
    return { sessions: new Set(sources.session_ids ?? []), stays: new Set(sources.admission_id ? [sources.admission_id] : []), bills: new Set(sources.bill_ids ?? []) };
  }
  if (target === "other") return { ...none(), bills: new Set(preset?.bill_id ? [preset.bill_id] : []) };
  // From a bill page: that bill's session (or stay) with its bills, or only that bill.
  const from = preset?.bill_id;
  if (from) {
    const s = parts.sessions.find((x) => x.bills.some((b) => b.id === from));
    if (s) return { ...none(), sessions: new Set([s.id]), bills: new Set(s.bills.map((b) => b.id)) };
    const st = parts.stays.find((x) => x.bills.some((b) => b.id === from));
    if (st) return { ...none(), stays: new Set([st.id]), bills: new Set(st.bills.map((b) => b.id)) };
    if (parts.extra.some((b) => b.id === from)) return { ...none(), bills: new Set([from]) };
  }
  const bills = new Set<string>();
  for (const s of parts.sessions) for (const b of s.bills) bills.add(b.id);
  for (const st of parts.stays) for (const b of st.bills) bills.add(b.id);
  for (const b of parts.extra) bills.add(b.id);
  return { sessions: new Set(parts.sessions.map((s) => s.id)), stays: new Set(parts.stays.map((s) => s.id)), bills };
}

/** The dialog's first choice for a preset (a bill page, a stay, a treatment) or the saved sources. */
function startTarget(data: SourcesData | undefined, preset?: BreakdownPreset, sources?: BreakdownSources): string {
  if (!data) return "";
  const treatment = sources?.treatment_id ?? preset?.treatment_id;
  if (treatment && data.treatments.some((x) => x.id === treatment)) return `t:${treatment}`;
  const stay = sources?.admission_id ?? preset?.admission_id;
  if (stay) {
    const tr = data.treatments.find((x) => x.stays.some((s) => s.id === stay));
    if (tr) return `t:${tr.id}`;
    if (data.stays.some((s) => s.id === stay)) return `s:${stay}`;
  }
  const bill = preset?.bill_id;
  if (bill && data.other_bills.some((b) => b.id === bill)) return "other";
  if (sources && (sources.bill_ids?.length ?? 0) > 0) return "other";
  return "";
}

/**
 * New breakdown bill (insurance): choose the surgery (or IP stay), tick its sessions and the bills to
 * fill from (owner, 17/11/2026: "all for that surgery selected and select session"). With `refill`,
 * the same choice fills an existing draft again.
 */
export function NewBreakdownDialog({
  patientId,
  preset,
  refill,
  onDone,
}: {
  patientId: string;
  preset?: BreakdownPreset;
  refill?: { id: string; version: number; sources: BreakdownSources };
  onDone: (filled?: BreakdownBill) => void;
}) {
  const t = useTranslations("breakdown.new");
  const tbd = useTranslations("breakdown");
  const tb = useTranslations("bill");
  const tr = useTranslations("treatments");
  const router = useRouter();
  const { failed, saved } = useFeedback();
  const checks = useZodForm(breakdownTargetSchema);
  const sources = useQuery({
    queryKey: ["breakdown_sources", patientId],
    queryFn: () => rpc<SourcesData>("breakdown_sources", { p_patient_id: patientId }),
  });
  const data = sources.data;
  const [chosen, setChosen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const target = chosen ?? startTarget(data, preset, refill?.sources);
  const ticks = picked ?? startPicked(data, target, preset, chosen === null ? refill?.sources : undefined);
  const parts = useMemo(() => targetParts(data, target), [data, target]);

  const choose = (v: string) => {
    setChosen(v);
    setPicked(startPicked(data, v, preset));
    checks.clear("target");
  };
  const toggle = (kind: keyof Picked, id: string, billIds: string[] = []) => {
    const next = { sessions: new Set(ticks.sessions), stays: new Set(ticks.stays), bills: new Set(ticks.bills) };
    const on = !next[kind].has(id);
    if (on) next[kind].add(id);
    else next[kind].delete(id);
    // Ticking a session or stay ticks its bills; unticking takes them off.
    for (const b of billIds) {
      if (on) next.bills.add(b);
      else next.bills.delete(b);
    }
    setPicked(next);
  };

  // The bills shown: those of the ticked sessions and stays, plus the treatment's own (or the other bills).
  const shownBills = useMemo(() => {
    if (!parts) return [];
    const seen = new Map<string, BillChip>();
    for (const s of parts.sessions) if (ticks.sessions.has(s.id)) for (const b of s.bills) seen.set(b.id, b);
    for (const st of parts.stays) if (ticks.stays.has(st.id)) for (const b of st.bills) seen.set(b.id, b);
    for (const b of parts.extra) seen.set(b.id, b);
    return [...seen.values()];
  }, [parts, ticks]);

  const payload = (): BreakdownSources => {
    const shown = new Set(shownBills.map((b) => b.id));
    return {
      treatment_id: parts?.treatment?.id ?? null,
      admission_id: parts?.stays.find((s) => ticks.stays.has(s.id))?.id ?? null,
      session_ids: parts?.sessions.filter((s) => ticks.sessions.has(s.id)).map((s) => s.id) ?? [],
      bill_ids: [...ticks.bills].filter((id) => shown.has(id)),
    };
  };
  const [clientId] = useState(newId);
  const make = useMutation({
    mutationFn: () =>
      refill
        ? rpc<BreakdownBill>("breakdown_refill", { p_id: refill.id, p_version: refill.version, p_sources: payload() })
        : rpc<BreakdownBill>("create_breakdown_bill", { p_patient_id: patientId, p_sources: payload(), p_client_id: clientId }),
    onSuccess: (bb) => {
      if (refill) {
        saved(tbd("refillDone"));
        onDone(bb);
      } else router.push(`/breakdown/${bb.id}`);
    },
    onError: failed,
  });

  const existing = (data?.breakdowns ?? []).filter((x) => !parts?.treatment || x.treatment_id === parts.treatment.id);
  const billLabel = (b: BillChip) =>
    t("billLine", { type: tb(`type.${b.bill_type}`), no: b.bill_no ?? "", date: b.bill_at ? formatDate(new Date(b.bill_at)) : "—", amount: formatINR(b.total_paise) });

  return (
    <DialogContent
      wide
      title={refill ? t("refill") : t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone()}>
            {t("cancel")}
          </Button>
          <Button
            disabled={make.isPending || sources.isPending}
            onClick={() => {
              if (checks.validate({ target })) make.mutate();
            }}
          >
            {make.isPending ? <Loader2 aria-hidden className="animate-spin" /> : refill ? <RefreshCw aria-hidden /> : <FileSpreadsheet aria-hidden />}
            {refill ? t("refill") : t("make")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("for")} error={checks.error("target")}>
          {(a) => (
            <Select {...a} value={target} disabled={sources.isPending} onChange={(e) => choose(e.target.value)}>
              <option value="" disabled>
                {sources.isPending ? t("loading") : t("choose")}
              </option>
              {data?.treatments.map((x) => (
                <option key={x.id} value={`t:${x.id}`}>
                  {t("treatmentOption", { name: x.name, date: formatDate(new Date(x.start_date)) })}
                </option>
              ))}
              {data?.stays.map((s) => (
                <option key={s.id} value={`s:${s.id}`}>
                  {t("stayOption", { ip: s.ip_number })}
                </option>
              ))}
              {(data?.other_bills.length ?? 0) > 0 && <option value="other">{t("otherOption")}</option>}
              <option value="empty">{t("emptyOption")}</option>
            </Select>
          )}
        </Field>

        {parts && parts.sessions.length > 0 && (
          <fieldset className="flex flex-col gap-1" data-testid="bb-sessions">
            <legend className="mb-1 font-medium">{t("sessions")}</legend>
            {parts.sessions.map((s) => (
              <Checkbox
                key={s.id}
                checked={ticks.sessions.has(s.id)}
                onChange={() => toggle("sessions", s.id, s.bills.map((b) => b.id))}
                label={t("sessionLine", { n: s.seq, date: formatDate(new Date(s.actual_date ?? s.planned_date)) })}
                hint={s.bills.length > 0 ? s.bills.map(billLabel).join(" · ") : tr(`session.${s.status}`)}
              />
            ))}
          </fieldset>
        )}

        {parts && parts.stays.length > 0 && target.startsWith("t:") && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{t("stays")}</legend>
            {parts.stays.map((s) => (
              <Checkbox
                key={s.id}
                checked={ticks.stays.has(s.id)}
                onChange={() => toggle("stays", s.id, s.bills.map((b) => b.id))}
                label={t("stayLine", { ip: s.ip_number, date: formatDate(new Date(s.admitted_at)) })}
              />
            ))}
          </fieldset>
        )}

        {target && target !== "empty" && (
          <fieldset className="flex flex-col gap-1" data-testid="bb-bills">
            <legend className="mb-1 font-medium">{t("bills")}</legend>
            {shownBills.length === 0 && <p className="text-text-secondary">{t("noBills")}</p>}
            {shownBills.map((b) => (
              <Checkbox key={b.id} checked={ticks.bills.has(b.id)} onChange={() => toggle("bills", b.id)} label={billLabel(b)} />
            ))}
          </fieldset>
        )}

        {!refill && existing.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("made")}</p>
            <ul className="flex flex-wrap gap-2">
              {existing.map((x) => (
                <li key={x.id}>
                  <Link href={`/breakdown/${x.id}`} className="text-link underline-offset-4 hover:underline">
                    {x.bb_no ?? tb("status.draft")} · {formatINR(x.total_paise)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DialogContent>
  );
}
