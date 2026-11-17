import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { LeadsScreen } from "./leads-screen";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string; phone?: string }> }) {
  const [{ new: openNew, phone }, me] = await Promise.all([searchParams, getMe()]);
  // A sales executive works from the sheet (their own leads); the managers' list has assign and bulk tools.
  if (me?.role === "sales_executive") redirect(openNew === "1" ? "/leads/sheet?new=1" : "/leads/sheet");
  return <LeadsScreen openNew={openNew === "1"} phone={phone && /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null} />;
}
