import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Admission } from "@/components/admissions/types";
import { getSupabaseServer } from "@/lib/supabase/server";
import { AdmissionScreen } from "./admission-screen";

export const metadata: Metadata = { title: "IP stay" };

export default async function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_admission", { p_admission_id: id });
  if (error || !data) notFound();
  return <AdmissionScreen initial={data as Admission} />;
}
