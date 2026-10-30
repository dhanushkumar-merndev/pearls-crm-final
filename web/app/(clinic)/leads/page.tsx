import type { Metadata } from "next";
import { LeadsScreen } from "./leads-screen";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string; phone?: string }> }) {
  const { new: openNew, phone } = await searchParams;
  return <LeadsScreen openNew={openNew === "1"} phone={phone && /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null} />;
}
