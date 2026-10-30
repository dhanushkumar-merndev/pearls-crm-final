import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdsDashboard } from "@/components/ads/ads-dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Ads" };

export default async function AdsPage() {
  const t = await getTranslations("ads");
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <AdsDashboard />
    </Page>
  );
}
