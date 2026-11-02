"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { formatDateTime, type StatusKind } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

export interface DayStartRequest {
  id: string;
  name: string;
  role: "bdm" | "sales_executive";
  created_at: string;
  reason: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  distance_m: number | null;
  office: string | null;
  status: "pending" | "approved" | "declined" | "used";
  decline_note: string | null;
  decided_by: string | null;
}

const KIND: Record<DayStartRequest["status"], StatusKind> = { pending: "warning", approved: "good", used: "good", declined: "critical" };
export const declineSchema = z.object({ note: z.string().trim().min(1, { error: "required" }).max(500, { error: "tooLong" }) });

export function distanceLabel(m: number | null): string | null {
  if (m === null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

/**
 * Admin: BDMs and sales executives asking to start the day away from the office (owner, 02/11/2026).
 * Waiting ones first; Approve lets them press Start day where they are; Decline sends a note back.
 */
export function DayStartRequests() {
  const t = useTranslations("dayStart");
  const roles = useTranslations("roles");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["day_start_requests"],
    queryFn: () => rpc<DayStartRequest[]>("day_start_requests_list"),
    refetchInterval: 30_000,
  });
  const [declining, setDeclining] = useState<DayStartRequest | null>(null);
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note?: string }) =>
      rpc<DayStartRequest>("day_start_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note ?? null }),
    onSuccess: (_r, v) => {
      saved(v.approve ? t("approved") : t("declined"));
      setDeclining(null);
      void queryClient.invalidateQueries({ queryKey: ["day_start_requests"] });
      void queryClient.invalidateQueries({ queryKey: ["bdm_live"] });
    },
    onError: failed,
  });
  const rows = list.data ?? [];

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="day-start-title">
      <div>
        <CardTitle id="day-start-title">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </div>
      {list.isPending && <RowSkeletons rows={2} />}
      {list.isSuccess && rows.length === 0 && <p className="text-text-secondary">{t("none")}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const far = distanceLabel(r.distance_m);
          return (
            <li key={r.id} className="flex flex-col gap-1.5 rounded-xl border border-border p-3" aria-label={t("requestFrom", { name: r.name })}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <span className="text-text-secondary">{roles(r.role)}</span>
                <StatusBadge kind={KIND[r.status]} label={t(`status.${r.status}`)} />
                <span className="text-[0.9rem] tabular-nums text-text-secondary">{formatDateTime(new Date(r.created_at))}</span>
              </div>
              <p>{r.reason}</p>
              <p className="flex flex-wrap items-center gap-x-3 text-[0.9rem] text-text-secondary">
                {far && <span>{r.office ? t("fromOffice", { distance: far, office: r.office }) : far}</span>}
                <a
                  className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
                  href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  {t("seeOnMap")}
                </a>
              </p>
              {r.status === "declined" && r.decline_note && <p className="text-[0.9rem]">{t("note", { note: r.decline_note })}</p>}
              {r.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, approve: true })}
                    aria-label={t("approveFor", { name: r.name })}
                  >
                    <Check aria-hidden />
                    {t("approve")}
                  </Button>
                  <Button variant="secondary" disabled={decide.isPending} onClick={() => setDeclining(r)} aria-label={t("declineFor", { name: r.name })}>
                    <X aria-hidden />
                    {t("decline")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={declining !== null} onOpenChange={(open) => !open && setDeclining(null)}>
        {declining && (
          <DeclineDialog
            request={declining}
            busy={decide.isPending}
            onDecline={(note) => decide.mutate({ id: declining.id, approve: false, note })}
          />
        )}
      </Dialog>
    </Card>
  );
}

function DeclineDialog({ request, busy, onDecline }: { request: DayStartRequest; busy: boolean; onDecline: (note: string) => void }) {
  const t = useTranslations("dayStart");
  const [note, setNote] = useState("");
  const form = useZodForm(declineSchema);
  return (
    <DialogContent
      title={t("declineTitle", { name: request.name })}
      footer={
        <Button type="submit" form="decline-form" variant="danger" disabled={busy}>
          <X aria-hidden />
          {t("decline")}
        </Button>
      }
    >
      <form
        id="decline-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const v = form.validate({ note });
          if (v) onDecline(v.note);
        }}
      >
        <Field label={t("noteLabel")} hint={t("noteHint")} error={form.error("note")}>
          {(a) => (
            <Textarea
              {...a}
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value);
                form.clear("note");
              }}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}
