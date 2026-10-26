"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Image as ImageIcon, Pause, Play } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { decodePolyline, formatDistance, formatTime, istDateString, isIsoDate, type LatLng } from "@pearl/shared";
import { BdmMap, type MapMarker } from "@/components/bdm/bdm-map";
import { trackPoints, type TrackPoint } from "@/lib/bdm";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";

interface Visit {
  id: string;
  destination: string;
  purpose: string | null;
  travel_started_at: string;
  reached_at: string | null;
  completed_at: string | null;
  reached_lat: number | null;
  reached_lng: number | null;
  outcome: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_designation: string | null;
  interest: string | null;
  actual_m: number | null;
  est_distance_m: number | null;
  est_minutes: number | null;
  estimate_status: "pending" | "ok" | "failed";
  flag_long_route: boolean;
  punch_photo_file_id: string | null;
  recording_file_id: string | null;
  lead: { id: string; name: string; sl_no: number | null } | null;
}

interface Timeline {
  staff: { id: string; name: string };
  day: {
    id: string;
    started_at: string;
    ended_at: string | null;
    start_lat: number | null;
    start_lng: number | null;
    end_lat: number | null;
    end_lng: number | null;
    start_in_geofence: boolean | null;
    start_distance_m: number | null;
    office: string | null;
    selfie_file_id: string | null;
    flags: string[];
    auto_ended: boolean;
  } | null;
  summary?: {
    visits: number;
    leads: number;
    distance_m: number;
    actual_m: number;
    est_m: number;
    estimates_pending: number;
    travel_s: number;
    meeting_s: number;
    break_s: number;
    break_allowed_s: number;
    office_s: number;
  };
  events?: { id: string; kind: string; at: string; visit_id: string | null }[];
  visits?: Visit[];
  breaks?: { id: string; type: string | null; planned_minutes: number; started_at: string; ended_at: string | null; overrun: boolean }[];
  chunks?: { seq: number; started_at: string; polyline: string; offsets: number[]; distance_m: number }[];
  trips?: { id: string; site_visit_id: string; gaps: { from: string; to: string; reason: "gps_off" | "no_signal" }[] }[];
}

const time = (at: string | null | undefined) => (at ? formatTime(new Date(at)) : "—");
const mins = (s: number) => Math.round(s / 60);

/** One BDM's day, like the paper sheet: km driven vs expected first, then the route and what happened. */
export function DayScreen({ staffId }: { staffId: string }) {
  const t = useTranslations("bdm");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = istDateString(new Date());
  const date = isIsoDate(params.get("date") ?? "") ? params.get("date")! : today;
  const go = (d: string) => router.replace(`${pathname}?date=${d}`, { scroll: false });
  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00+05:30`);
    d.setDate(d.getDate() + days);
    go(istDateString(d));
  };
  const tl = useQuery({ queryKey: ["bdm_day_timeline", staffId, date], queryFn: () => rpc<Timeline>("bdm_day_timeline", { p_staff_id: staffId, p_date: date }) });
  const data = tl.data;
  const points = useMemo(() => trackPoints(data?.chunks ?? []), [data?.chunks]);
  const paths = useMemo(() => (data?.chunks ?? []).map((c) => ({ id: String(c.seq), points: decodePolyline(c.polyline) })), [data?.chunks]);
  const markers: MapMarker[] = useMemo(() => {
    const d = data?.day;
    const list: MapMarker[] = [];
    if (d?.start_lat != null && d.start_lng != null)
      list.push({ id: "start", lat: d.start_lat, lng: d.start_lng, label: t("dayStart"), tone: d.start_in_geofence === false ? "warning" : "good" });
    for (const v of data?.visits ?? [])
      if (v.reached_lat != null && v.reached_lng != null) list.push({ id: v.id, lat: v.reached_lat, lng: v.reached_lng, label: v.destination, tone: "good" });
    if (d?.end_lat != null && d.end_lng != null) list.push({ id: "end", lat: d.end_lat, lng: d.end_lng, label: t("dayEnd"), tone: "muted" });
    return list;
  }, [data, t]);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/bdm" className="inline-flex items-center gap-1 self-start text-link underline-offset-4 hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        {t("back")}
      </Link>
      <PageHeader title={data?.staff?.name ? t("sheetTitle", { name: data.staff.name }) : t("daySheet")} description={t("sheetDescription")} />
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" aria-label={t("previousDay")} onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Field label={t("date")} className="w-48">
          {(a) => <Input {...a} type="date" value={date} max={today} onChange={(e) => isIsoDate(e.target.value) && go(e.target.value)} />}
        </Field>
        <Button variant="secondary" aria-label={t("nextDay")} disabled={date >= today} onClick={() => shift(1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {tl.isPending && <p className="text-text-secondary">{t("loading")}</p>}
      {tl.isSuccess && !data?.day && <p className="text-text-secondary">{t("noDay")}</p>}
      {data?.day && data.summary && (
        <>
          <Summary data={data} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <RouteCard points={points} paths={paths} markers={markers} />
            <EventsCard data={data} />
          </div>
          <VisitsCard visits={data.visits ?? []} trips={data.trips ?? []} />
          <BreaksCard breaks={data.breaks ?? []} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex min-w-40 flex-1 flex-col gap-1">
      <CardDescription>{label}</CardDescription>
      <span className="text-[1.6rem] font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-[0.9rem] text-text-secondary">{sub}</span>}
    </Card>
  );
}

function Summary({ data }: { data: Timeline }) {
  const t = useTranslations("bdm");
  const s = data.summary!;
  const d = data.day!;
  const { failed } = useFeedback();
  const [selfie, setSelfie] = useState<string | null>(null);
  const showSelfie = useMutation({
    mutationFn: async () => (await viewUrls([d.selfie_file_id!]))[d.selfie_file_id!] ?? null,
    onSuccess: setSelfie,
    onError: failed,
  });
  return (
    <section aria-label={t("summary")} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {/* Owner's sheet: "km covered (VV Imp)" — driven vs expected comes first. */}
        <Tile label={t("kmDriven")} value={formatDistance(s.actual_m || s.distance_m)} sub={t("kmTotalDay", { km: formatDistance(s.distance_m) })} />
        <Tile
          label={t("kmExpected")}
          value={s.est_m ? formatDistance(s.est_m) : "—"}
          sub={s.estimates_pending ? t("estimatesPending", { n: s.estimates_pending }) : undefined}
        />
        <Tile label={t("visits")} value={String(s.visits)} />
        <Tile label={t("leads")} value={String(s.leads)} />
        <Tile label={t("breakUsed")} value={t("minutesOf", { used: mins(s.break_s), allowed: mins(s.break_allowed_s) })} />
      </div>
      <p className="text-text-secondary">
        {t("timeSplit", { travel: mins(s.travel_s), meeting: mins(s.meeting_s), brk: mins(s.break_s), office: mins(s.office_s) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("startedAt", { time: time(d.started_at) })}</span>
        <StatusBadge
          kind={d.start_in_geofence === false ? "warning" : "good"}
          label={d.start_in_geofence === false ? t("startedAwayFrom", { m: d.start_distance_m ?? 0 }) : t("startedInOffice", { office: d.office ?? "" })}
        />
        <span>{d.ended_at ? t("endedAt", { time: time(d.ended_at) }) : t("stillOpen")}</span>
        {d.auto_ended && <StatusBadge kind="serious" label={t("flag.auto_ended")} />}
        {d.flags.filter((f) => f !== "auto_ended").map((f) => (
          <StatusBadge key={f} kind="serious" label={t.has(`flag.${f}`) ? t(`flag.${f}`) : f} />
        ))}
        {d.selfie_file_id && !selfie && (
          <Button variant="secondary" disabled={showSelfie.isPending} onClick={() => showSelfie.mutate()}>
            <ImageIcon aria-hidden />
            {t("showSelfie")}
          </Button>
        )}
      </div>
      {selfie && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
        <img src={selfie} alt={t("selfieAlt")} className="max-h-60 self-start rounded-xl border border-border" />
      )}
    </section>
  );
}

function RouteCard({ points, paths, markers }: { points: TrackPoint[]; paths: { id: string; points: LatLng[] }[]; markers: MapMarker[] }) {
  const t = useTranslations("bdm");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= points.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [playing, points.length]);
  const current = points[Math.min(index, points.length - 1)];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("route")}</CardTitle>
      <BdmMap markers={markers} paths={paths} cursor={playing || index > 0 ? (current?.point ?? null) : null} label={t("routeMapLabel")} className="h-96" />
      {points.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            {playing ? t("pause") : t("playRoute")}
          </Button>
          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={Math.min(index, points.length - 1)}
            onChange={(e) => setIndex(Number(e.target.value))}
            aria-label={t("playbackPosition")}
            aria-valuetext={current ? formatTime(new Date(current.at)) : undefined}
            className="min-h-11 flex-1 accent-[var(--chart-1)]"
          />
          <span className="tabular-nums">{current ? formatTime(new Date(current.at)) : ""}</span>
        </div>
      ) : (
        <p className="text-text-secondary">{t("noRoute")}</p>
      )}
    </Card>
  );
}

function EventsCard({ data }: { data: Timeline }) {
  const t = useTranslations("bdm");
  const visits = new Map((data.visits ?? []).map((v) => [v.id, v.destination]));
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{t("timeline")}</CardTitle>
      <ol className="flex flex-col gap-1">
        {(data.events ?? []).map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-20 shrink-0 tabular-nums text-text-secondary">{time(e.at)}</span>
            <span>
              {t.has(`event.${e.kind}`) ? t(`event.${e.kind}`) : e.kind}
              {e.visit_id && visits.get(e.visit_id) ? ` — ${visits.get(e.visit_id)}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function VisitsCard({ visits, trips }: { visits: Visit[]; trips: NonNullable<Timeline["trips"]> }) {
  const t = useTranslations("bdm");
  const { failed } = useFeedback();
  const [links, setLinks] = useState<Record<string, string>>({});
  const open = useMutation({
    mutationFn: (id: string) => viewUrls([id]),
    onSuccess: (urls) => setLinks((l) => ({ ...l, ...urls })),
    onError: failed,
  });
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("visitsTitle")}</CardTitle>
      {visits.length === 0 && <p className="text-text-secondary">{t("noVisits")}</p>}
      <ul className="flex flex-col gap-3">
        {visits.map((v) => {
          const gaps = trips.find((tr) => tr.site_visit_id === v.id)?.gaps ?? [];
          return (
            <li key={v.id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{v.destination}</span>
                {v.purpose && <span className="text-text-secondary">· {v.purpose}</span>}
                {v.flag_long_route && <StatusBadge kind="warning" label={t("longRoute")} />}
                {!v.completed_at && <StatusBadge kind="serious" label={t("notCompleted")} />}
              </div>
              <p className="tabular-nums text-text-secondary">
                {t("visitTimes", { start: time(v.travel_started_at), reached: time(v.reached_at), done: time(v.completed_at) })}
              </p>
              {v.reached_at && (
                <p className="font-medium">
                  {v.estimate_status === "ok"
                    ? t("kmVs", { actual: formatDistance(v.actual_m ?? 0), est: formatDistance(v.est_distance_m ?? 0), minutes: v.est_minutes ?? 0 })
                    : v.estimate_status === "failed"
                      ? t("kmNoEstimate", { actual: formatDistance(v.actual_m ?? 0) })
                      : t("kmPending", { actual: formatDistance(v.actual_m ?? 0) })}
                </p>
              )}
              {gaps.map((g) => (
                <p key={g.from} className="text-text-secondary">
                  {t(g.reason === "gps_off" ? "gapGpsOff" : "gapNoSignal", { from: time(g.from), to: time(g.to) })}
                </p>
              ))}
              {v.outcome && <p className="whitespace-pre-wrap">{v.outcome}</p>}
              {(v.contact_name || v.contact_phone) && (
                <p className="text-text-secondary">{[v.contact_name, v.contact_designation, v.contact_phone].filter(Boolean).join(" · ")}</p>
              )}
              {v.interest && <p>{t("interest", { level: t(`interestLevel.${v.interest}`) })}</p>}
              {v.lead && (
                <Link href={`/leads/${v.lead.id}`} className="self-start text-link underline-offset-4 hover:underline">
                  {t("leadMade", { name: v.lead.name })}
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {v.punch_photo_file_id && !links[v.punch_photo_file_id] && (
                  <Button variant="secondary" onClick={() => open.mutate(v.punch_photo_file_id!)}>
                    <ImageIcon aria-hidden />
                    {t("showPhoto")}
                  </Button>
                )}
                {v.recording_file_id && !links[v.recording_file_id] && (
                  <Button variant="secondary" onClick={() => open.mutate(v.recording_file_id!)}>
                    <Play aria-hidden />
                    {t("playMeeting")}
                  </Button>
                )}
              </div>
              {v.punch_photo_file_id && links[v.punch_photo_file_id] && (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link
                <img src={links[v.punch_photo_file_id]} alt={t("photoAlt", { place: v.destination })} className="max-h-72 self-start rounded-xl border border-border" />
              )}
              {v.recording_file_id && links[v.recording_file_id] && (
                <audio controls autoPlay src={links[v.recording_file_id]} className="w-full max-w-xl" aria-label={t("meetingPlayer")} />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BreaksCard({ breaks }: { breaks: NonNullable<Timeline["breaks"]> }) {
  const t = useTranslations("bdm");
  if (breaks.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{t("breaks")}</CardTitle>
      <ul className="flex flex-col gap-1">
        {breaks.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">
              {time(b.started_at)}–{time(b.ended_at)}
            </span>
            <span>{b.type ?? t("break")}</span>
            <span className="text-text-secondary">{t("planned", { n: b.planned_minutes })}</span>
            {b.overrun && <StatusBadge kind="warning" label={t("overrun")} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
