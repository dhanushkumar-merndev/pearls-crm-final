import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PatientFile, type PatientHeader } from "./patient-file";

export const metadata: Metadata = { title: "Patient" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("patient_header", { p_patient_id: id });
  if (error || !data) notFound();
  const header = data as PatientHeader;
  // A merged record opens the patient it was merged into.
  if (header.merged_into_id) redirect(`/patients/${header.merged_into_id}`);
  return <PatientFile initial={header} />;
}
