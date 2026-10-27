import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SalesDashboard } from "@/components/sales/sales-dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Sales dashboard" };

export default async function SalesDashboardPage() {
  const t = await getTranslations("salesDash");
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <SalesDashboard />
    </Page>
  );
}
