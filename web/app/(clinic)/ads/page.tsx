import type { Metadata } from "next";
import { AdsDashboard } from "@/components/ads/ads-dashboard";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Ads" };

export default function AdsPage() {
  return (
    <Page>
      <AdsDashboard />
    </Page>
  );
}
