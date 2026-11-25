import { redirect } from "next/navigation";

/** Old address: the doctor's page now lives at /doctors/[id] (reception uses it too). */
export default async function OldDoctorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const [{ id }, { new: isNew }] = await Promise.all([params, searchParams]);
  redirect(`/doctors/${encodeURIComponent(id)}${isNew === "1" ? "?new=1" : ""}`);
}
