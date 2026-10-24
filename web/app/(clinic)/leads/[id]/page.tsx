import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LeadScreen, type LeadDetail } from "./lead-screen";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("lead_detail", { p_id: id });
  if (error || !data) notFound();
  return <LeadScreen initial={data as LeadDetail} />;
}
