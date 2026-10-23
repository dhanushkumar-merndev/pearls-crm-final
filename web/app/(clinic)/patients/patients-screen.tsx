"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Inbox, QrCode, Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate } from "@pearl/shared";
import { useDebounced } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";

export interface PatientCard {
  id: string;
  uhid: string;
  full_name: string;
  gender: string;
  age: number | null;
  phone_e164: string | null;
  city: string | null;
  created_at?: string;
}
interface SearchHit {
  id: string;
  title: string;
  uhid: string;
  subtitle: string;
}

/** Recent patients (newest first, "load more") or server search by name / phone / UHID. */
export function PatientsScreen() {
  const t = useTranslations("patients");
  const c = useTranslations("common");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 300);

  const recent = useInfiniteQuery({
    queryKey: ["patients_recent"],
    initialPageParam: null as string | null,
    enabled: search.length < 2,
    queryFn: ({ pageParam }) => rpc<{ items: PatientCard[]; next_cursor: string | null }>("patients_recent", { p_cursor: pageParam, p_limit: 20 }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const hits = useQuery({
    queryKey: ["global_search", search],
    enabled: search.length >= 2,
    queryFn: () => rpc<SearchHit[]>("global_search", { p_q: search, p_limit: 20 }),
  });
  const pending = useQuery({
    queryKey: ["pending_registrations", "count"],
    queryFn: () => rpc<{ items: unknown[]; next_cursor: string | null }>("pending_registrations", { p_limit: 100 }),
  });
  const pendingCount = pending.data ? pending.data.items.length + (pending.data.next_cursor ? 1 : 0) : 0;
  const rows = recent.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/patients/qr">
                <QrCode aria-hidden />
                {t("showQr")}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/patients/pending">
                <Inbox aria-hidden />
                {t("pending", { count: pendingCount })}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/patients/new">
                <UserPlus aria-hidden />
                {t("new")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="relative mb-4 max-w-xl">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
      </div>

      {search.length >= 2 ? (
        <Table>
          <THead>
            <tr>
              <TH>{t("name")}</TH>
              <TH>{t("details")}</TH>
            </tr>
          </THead>
          <tbody>
            {hits.isPending && <EmptyRow colSpan={2}>{c("loading")}</EmptyRow>}
            {hits.data?.length === 0 && <EmptyRow colSpan={2}>{t("noneFound")}</EmptyRow>}
            {hits.data?.map((h) => (
              <TR key={h.id}>
                <TD>
                  <Link href={`/patients/${h.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                    {h.title}
                  </Link>
                </TD>
                <TD className="text-text-secondary">{h.subtitle}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>{t("name")}</TH>
                <TH>{t("uhid")}</TH>
                <TH>{t("phone")}</TH>
                <TH>{t("registeredOn")}</TH>
              </tr>
            </THead>
            <tbody>
              {recent.isPending && <EmptyRow colSpan={4}>{c("loading")}</EmptyRow>}
              {recent.isSuccess && rows.length === 0 && <EmptyRow colSpan={4}>{t("noPatients")}</EmptyRow>}
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/patients/${p.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                      {p.full_name}
                    </Link>
                    {p.age !== null && <span className="ml-2 text-text-secondary">{t("age", { n: p.age })}</span>}
                  </TD>
                  <TD className="tabular-nums">{p.uhid}</TD>
                  <TD className="tabular-nums">{p.phone_e164 ?? "—"}</TD>
                  <TD>{p.created_at ? formatDate(new Date(p.created_at)) : "—"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {recent.hasNextPage && (
            <Button variant="secondary" className="mt-3" onClick={() => void recent.fetchNextPage()} disabled={recent.isFetchingNextPage}>
              {c("loadMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
