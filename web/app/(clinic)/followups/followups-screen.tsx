"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Phone, Plus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { formatDate } from "@pearl/shared";
import { FollowupDialog } from "@/components/followups/followup-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, PageHeader, Textarea } from "@/components/ui/form";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { followupOutcomeSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Followup {
  id: string;
  kind: string;
  due_date: string;
  reason: string;
  patient_id: string | null;
  patient: string | null;
  uhid: string | null;
  phone: string | null;
}
const SCOPES = ["today", "overdue", "upcoming"] as const;

/** Follow-ups and tasks: today / overdue / upcoming. Done = with an outcome. */
export function FollowupsScreen() {
  const t = useTranslations("followups");
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        }
      />
      <Tabs.Root defaultValue="today" className="flex flex-col gap-4">
        <Tabs.List aria-label={t("when")} className="flex gap-1 border-b border-border">
          {SCOPES.map((s) => (
            <Tabs.Trigger
              key={s}
              value={s}
              className="min-h-11 rounded-t-xl px-4 font-medium text-text-secondary data-[state=active]:border-b-2 data-[state=active]:border-foreground data-[state=active]:text-foreground"
            >
              {t(`scope.${s}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {SCOPES.map((s) => (
          <Tabs.Content key={s} value={s}>
            <FollowupList scope={s} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <FollowupDialog onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}

function FollowupList({ scope }: { scope: (typeof SCOPES)[number] }) {
  const t = useTranslations("followups");
  const c = useTranslations("common");
  const [closing, setClosing] = useState<{ f: Followup; cancel: boolean } | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["followups", scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: Followup[]; next_cursor: string | null }>("followups_list", { p_scope: scope, p_cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <tr>
            <TH>{t("due")}</TH>
            <TH>{t("patient")}</TH>
            <TH>{t("reason")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{t("none")}</EmptyRow>}
          {items.map((f) => (
            <TR key={f.id}>
              <TD className="whitespace-nowrap">{formatDate(new Date(f.due_date))}</TD>
              <TD>
                {f.patient_id ? (
                  <Link href={`/patients/${f.patient_id}`} className="font-medium text-link underline-offset-4 hover:underline">
                    {f.patient}
                  </Link>
                ) : (
                  "—"
                )}
                {f.uhid && <span className="block text-[0.9rem] text-text-secondary">{f.uhid}</span>}
              </TD>
              <TD>
                <span className="block text-[0.85rem] text-text-secondary">{t(`kind.${f.kind}`)}</span>
                {f.reason}
              </TD>
              <TD className="text-right whitespace-nowrap">
                {f.phone && (
                  <Button asChild variant="ghost">
                    <a href={`tel:${f.phone}`}>
                      <Phone aria-hidden />
                      {t("call")}
                    </a>
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setClosing({ f, cancel: false })}>
                  <Check aria-hidden />
                  {t("done")}
                </Button>
                <Button variant="ghost" onClick={() => setClosing({ f, cancel: true })}>
                  <X aria-hidden />
                  {t("notNeeded")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.hasNextPage && (
        <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>
          {c("loadMore")}
        </Button>
      )}
      <Dialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)}>
        {closing && <CloseDialog {...closing} onDone={() => setClosing(null)} />}
      </Dialog>
    </div>
  );
}

function CloseDialog({ f, cancel, onDone }: { f: Followup; cancel: boolean; onDone: () => void }) {
  const t = useTranslations("followups");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [outcome, setOutcome] = useState("");
  const checks = useZodForm(followupOutcomeSchema);
  const close = useMutation({
    mutationFn: (o: string | null) => rpc("complete_followup", { p_id: f.id, p_outcome: o, p_cancel: cancel }),
    onSuccess: () => {
      saved(cancel ? t("cancelled") : t("completed"));
      void queryClient.invalidateQueries({ queryKey: ["followups"] });
      void queryClient.invalidateQueries({ queryKey: ["today_board"] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={cancel ? t("notNeededTitle") : t("doneTitle")}
      description={f.reason}
      footer={
        <Button
          disabled={close.isPending}
          onClick={() => {
            const d = checks.validate({ outcome });
            if (d) close.mutate(d.outcome);
          }}
        >
          <Check aria-hidden />
          {cancel ? t("notNeeded") : t("done")}
        </Button>
      }
    >
      <Field label={t("outcome")} hint={t("outcomeHint")} error={checks.error("outcome")}>
        {(a) => <Textarea {...a} rows={2} maxLength={500} value={outcome} onChange={(e) => (setOutcome(e.target.value), checks.clear("outcome"))} />}
      </Field>
    </DialogContent>
  );
}
