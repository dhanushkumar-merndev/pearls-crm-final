import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMe } from "@/lib/session";
import { DayScreen } from "./day-screen";

export const metadata: Metadata = { title: "BDM day" };

export default async function BdmDayPage({ params }: { params: Promise<{ staffId: string }> }) {
  const me = await getMe();
  if (me?.role !== "admin") notFound();
  const { staffId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) notFound();
  return (
    <Suspense>
      <DayScreen staffId={staffId} />
    </Suspense>
  );
}
