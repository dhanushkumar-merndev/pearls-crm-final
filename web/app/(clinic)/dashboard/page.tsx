import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

/** The clinic in numbers (PLAN.md B6, admin). The database checks the role again. */
export default async function DashboardPage() {
  const me = await getMe();
  if (me?.role !== "admin") notFound();
  return <AdminDashboard />;
}
