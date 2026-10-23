"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, PageHeader, Textarea } from "@/components/ui/form";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

interface Pending {
  id: string;
  full_name: string;
  payload: { phone_e164?: string };
  created_at: string;
}

/** Self-registrations from the QR waiting for reception to check and save. */
export function PendingScreen() {
  const t = useTranslations("pending");
  const c = useTranslations("common");
  const queryClient = useQueryClient();
  const [discarding, setDiscarding] = useState<Pending | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["pending_registrations"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: Pending[]; next_cursor: string | null }>("pending_registrations", { p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <Table>
        <THead>
          <tr>
            <TH>{t("name")}</TH>
            <TH>{t("phone")}</TH>
            <TH>{t("sent")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{t("none")}</EmptyRow>}
          {items.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium">{r.full_name}</TD>
              <TD className="tabular-nums">{r.payload.phone_e164 ?? "—"}</TD>
              <TD>{formatDateTime(new Date(r.created_at))}</TD>
              <TD className="text-right whitespace-nowrap">
                <Button asChild variant="ghost">
                  <Link href={`/patients/new?request=${r.id}`}>
                    <ClipboardCheck aria-hidden />
                    {t("review")}
                  </Link>
                </Button>
                <Button variant="ghost" onClick={() => setDiscarding(r)}>
                  <Trash2 aria-hidden />
                  {t("discard")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.hasNextPage && (
        <Button variant="secondary" className="mt-3" onClick={() => void list.fetchNextPage()}>
          {c("loadMore")}
        </Button>
      )}
      <Dialog open={discarding !== null} onOpenChange={(o) => !o && setDiscarding(null)}>
        {discarding && (
          <DiscardDialog
            request={discarding}
            onDone={() => {
              setDiscarding(null);
              void queryClient.invalidateQueries({ queryKey: ["pending_registrations"] });
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function DiscardDialog({ request, onDone }: { request: Pending; onDone: () => void }) {
  const t = useTranslations("pending");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const discard = useMutation({
    mutationFn: () => rpc("discard_registration", { p_request_id: request.id, p_reason: reason }),
    onSuccess: () => {
      saved(t("discarded"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("discardTitle", { name: request.full_name })}
      footer={
        <Button variant="danger" disabled={reason.trim().length < 3 || discard.isPending} onClick={() => discard.mutate()}>
          <Trash2 aria-hidden />
          {t("discard")}
        </Button>
      }
    >
      <Field label={t("reason")} hint={t("reasonHint")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </DialogContent>
  );
}
