"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RecordingsList, type RecordingFilters, type RecordingStatus } from "@/components/recordings/recordings-list";
import { Field, PageHeader, Select } from "@/components/ui/form";

const STATUSES: RecordingStatus[] = ["on_phone", "queued", "synced", "failed"];
const KINDS = ["call", "voice_note", "visit"] as const;

/** Every recording this person may hear: synced ones play, the rest can be asked from the phone. */
export function RecordingsScreen() {
  const t = useTranslations("recordings");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") as RecordingStatus | null;
  const kind = params.get("kind") as RecordingFilters["kind"] | null;
  const go = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const filters: RecordingFilters = { ...(status ? { status } : {}), ...(kind ? { kind } : {}) };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap gap-4">
        <Field label={t("filterStatus")} className="w-64">
          {(a) => (
            <Select {...a} value={status ?? ""} onChange={(e) => go("status", e.target.value)}>
              <option value="">{t("any")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("filterKind")} className="w-64">
          {(a) => (
            <Select {...a} value={kind ?? ""} onChange={(e) => go("kind", e.target.value)}>
              <option value="">{t("any")}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <RecordingsList key={`${status}-${kind}`} filters={filters} />
    </div>
  );
}
