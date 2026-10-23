import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { DoctorHours } from "./doctor-hours";

export const metadata: Metadata = { title: "Doctor hours" };

export default async function DoctorHoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("doctors").select("id, full_name").eq("id", id).maybeSingle();
  if (!data) notFound();
  return <DoctorHours doctorId={data.id} doctorName={data.full_name} />;
}
