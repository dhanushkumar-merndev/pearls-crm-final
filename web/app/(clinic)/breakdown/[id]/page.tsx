import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BreakdownBill } from "@/components/breakdown/types";
import { getSupabaseServer } from "@/lib/supabase/server";
import { BreakdownScreen } from "./breakdown-screen";

export const metadata: Metadata = { title: "Breakdown bill" };

export default async function BreakdownPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_breakdown_bill", { p_id: id });
  if (error || !data) notFound();
  return <BreakdownScreen initial={data as BreakdownBill} />;
}
