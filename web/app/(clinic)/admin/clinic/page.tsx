import type { Metadata } from "next";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ClinicProfileForm, type ClinicProfile } from "./clinic-profile-form";

export const metadata: Metadata = { title: "Clinic profile" };

export default async function ClinicProfilePage() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("clinic_settings").select("*").eq("branch_code", "main").maybeSingle();
  return <ClinicProfileForm initial={(data as ClinicProfile | null) ?? null} />;
}
