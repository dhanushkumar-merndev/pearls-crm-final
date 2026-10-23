import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SummaryScreen, type Summary } from "./summary-screen";

export const metadata: Metadata = { title: "Discharge summary" };

export default async function DischargePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_discharge_summary", { p_id: id });
  if (error || !data) notFound();
  return <SummaryScreen initial={data as Summary} />;
}
