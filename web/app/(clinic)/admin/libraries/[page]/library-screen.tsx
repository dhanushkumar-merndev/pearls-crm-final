"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CrudTable } from "@/components/admin/crud-table";
import { LOOKUP_KINDS, useLibraryConfig, type LibraryPage, type LookupKind } from "@/components/admin/library-configs";
import { Field, PageHeader, Select } from "@/components/ui/form";
import { Page, useAdminBack } from "@/components/ui/page";

export function LibraryScreen({ page }: { page: LibraryPage }) {
  const adminBack = useAdminBack();
  const t = useTranslations("library");
  const [kind, setKind] = useState<LookupKind>("payment_mode");
  const config = useLibraryConfig(page, kind);
  return (
    <Page>
      <PageHeader back={adminBack} title={t(`pages.${page}.title`)} description={t(`pages.${page}.description`)} />
      {page === "lists" && (
        <Field label={t("whichList")} className="max-w-sm">
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as LookupKind)}>
              {LOOKUP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`lookupKind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <CrudTable
        key={page === "lists" ? kind : page}
        config={config}
        title={page === "lists" ? t(`lookupKind.${kind}`) : t(`pages.${page}.title`)}
        addLabel={t(`pages.${page}.add`)}
      />
    </Page>
  );
}
