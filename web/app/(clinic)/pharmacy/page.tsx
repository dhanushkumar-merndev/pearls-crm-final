import type { Metadata } from "next";
import { PHARMACY_TABS, type PharmacyTab } from "@/components/pharmacy/tabs";
import { PharmacyScreen } from "./pharmacy-screen";

export const metadata: Metadata = { title: "Pharmacy" };

export default async function PharmacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initial = (PHARMACY_TABS as readonly string[]).includes(tab ?? "") ? (tab as PharmacyTab) : "stock";
  return <PharmacyScreen initialTab={initial} />;
}
