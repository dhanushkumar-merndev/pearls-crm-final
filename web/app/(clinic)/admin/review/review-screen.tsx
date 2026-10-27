"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, GitMerge } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { formatDateTime, requiredItem } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem, type LibraryKind } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, PageHeader } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { Page, useAdminBack } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Pending {
  kind: LibraryKind;
  id: string;
  label: string;
  created_at: string;
  created_by: string | null;
}

/** Items staff added on the fly: keep them (mark reviewed) or merge them into an existing item. */
export function ReviewScreen() {
  const adminBack = useAdminBack();
  const t = useTranslations("review");
  const c = useTranslations("common");
  const k = useTranslations("review.kind");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [merging, setMerging] = useState<Pending | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["library_review"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc<{ items: Pending[]; next_cursor: string | null }>("library_review_list", { p_cursor: pageParam, p_limit: 50 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["library_review"] });
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  const keep = useMutation({
    mutationFn: (item: Pending) => rpc("library_mark_reviewed", { p_kind: item.kind, p_ids: [item.id] }),
    onSuccess: () => {
      saved(t("kept"));
      refresh();
    },
    onError: failed,
  });

  return (
    <Page>
      <PageHeader back={adminBack} title={t("title")} description={t("description")} />
      <Table>
        <THead>
          <tr>
            <TH>{t("item")}</TH>
            <TH>{t("list")}</TH>
            <TH>{t("addedBy")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={4} />}
          {list.isSuccess && items.length === 0 && <EmptyRow colSpan={4}>{t("none")}</EmptyRow>}
          {items.map((item) => (
            <TR key={`${item.kind}-${item.id}`}>
              <TD className="font-medium">{item.label}</TD>
              <TD>{k(item.kind)}</TD>
              <TD>
                {item.created_by ?? "—"}
                <span className="block text-[0.9rem] text-text-secondary">{formatDateTime(new Date(item.created_at))}</span>
              </TD>
              <TD className="text-right whitespace-nowrap">
                <Button variant="ghost" disabled={keep.isPending} onClick={() => keep.mutate(item)}>
                  <Check aria-hidden />
                  {t("keep")}
                </Button>
                <Button variant="ghost" onClick={() => setMerging(item)}>
                  <GitMerge aria-hidden />
                  {t("merge")}
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
      <Dialog open={merging !== null} onOpenChange={(o) => !o && setMerging(null)}>
        {merging && <MergeDialog item={merging} onDone={() => (setMerging(null), refresh())} />}
      </Dialog>
    </Page>
  );
}

function MergeDialog({ item, onDone }: { item: Pending; onDone: () => void }) {
  const t = useTranslations("review");
  const { saved, failed } = useFeedback();
  const [into, setInto] = useState<LibraryItem | null>(null);
  const [schema] = useState(() =>
    z.object({ into: requiredItem().refine((id) => id !== item.id, { error: "review.sameItem" }) }),
  );
  const checks = useZodForm(schema);
  const merge = useMutation({
    mutationFn: (intoId: string) => rpc("library_merge", { p_kind: item.kind, p_from: item.id, p_into: intoId }),
    onSuccess: () => {
      saved(t("merged"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("mergeTitle", { name: item.label })}
      description={t("mergeHint")}
      footer={
        <Button
          disabled={merge.isPending}
          onClick={() => {
            const d = checks.validate({ into });
            if (d) merge.mutate(d.into);
          }}
        >
          <GitMerge aria-hidden />
          {t("mergeButton")}
        </Button>
      }
    >
      <Field label={t("keepWhich")} error={checks.error("into")}>
        {(a) => (
          <LibraryCombobox
            {...a}
            kind={item.kind}
            value={into}
            onChange={(v) => {
              setInto(v);
              checks.clear("into");
            }}
          />
        )}
      </Field>
    </DialogContent>
  );
}
