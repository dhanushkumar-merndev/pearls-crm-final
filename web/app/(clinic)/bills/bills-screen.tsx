"use client";

import { useTranslations } from "next-intl";
import { BillsTable } from "@/components/bills/bills-table";
import { PageHeader } from "@/components/ui/form";
import { Page } from "@/components/ui/page";

export function BillsScreen() {
  const t = useTranslations("bills");
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <BillsTable />
    </Page>
  );
}
