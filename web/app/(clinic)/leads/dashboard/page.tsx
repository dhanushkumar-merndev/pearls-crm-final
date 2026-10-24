import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SalesDashboard } from "@/components/sales/sales-dashboard";
import { PageHeader } from "@/components/ui/form";

export const metadata: Metadata = { title: "Sales dashboard" };

export default async function SalesDashboardPage() {
  const t = await getTranslations("salesDash");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SalesDashboard />
    </div>
  );
}
