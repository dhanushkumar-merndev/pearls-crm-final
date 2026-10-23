"use client";

import { useTranslations } from "next-intl";
import { BillsTable } from "@/components/bills/bills-table";
import { PageHeader } from "@/components/ui/form";

export function BillsScreen() {
  const t = useTranslations("bills");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <BillsTable />
    </div>
  );
}
