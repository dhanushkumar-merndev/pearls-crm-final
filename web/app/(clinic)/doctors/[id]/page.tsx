import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { DoctorHours } from "./doctor-hours";
import {
  DoctorDetails,
  DoctorSignature,
  NewDoctorBanner,
  type DoctorProfile,
} from "./doctor-profile";

export const metadata: Metadata = { title: "Doctor" };

/** One doctor (19d): details, the signature that prints on discharge summaries, weekly hours and leave. */
export default async function DoctorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, { new: isNew }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("doctors")
    .select(
      "id, full_name, display_name, specialization, qualification, designation, reg_council, reg_number, consultation_fee_paise, slot_minutes, signature_file_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const doctor = data as DoctorProfile;
  return (
    <DoctorHours doctorId={doctor.id} doctorName={doctor.full_name}>
      {isNew === "1" && <NewDoctorBanner />}
      <DoctorDetails doctor={doctor} />
      <DoctorSignature doctor={doctor} />
    </DoctorHours>
  );
}
