import type { Metadata } from "next";
import { getMe } from "@/lib/session";
import { SheetScreen } from "./sheet-screen";

export const metadata: Metadata = { title: "Sales sheet" };

export default async function LeadsSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ new: openNew }, me] = await Promise.all([searchParams, getMe()]);
  return <SheetScreen openNew={openNew === "1"} role={me?.role ?? "sales_executive"} />;
}
