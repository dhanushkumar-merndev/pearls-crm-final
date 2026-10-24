import type { Metadata } from "next";
import { LeadsScreen } from "./leads-screen";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: openNew } = await searchParams;
  return <LeadsScreen openNew={openNew === "1"} />;
}
