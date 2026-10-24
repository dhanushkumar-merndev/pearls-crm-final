import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMe } from "@/lib/session";
import { RecordingsScreen } from "./recordings-screen";

export const metadata: Metadata = { title: "Recordings" };

/** Sales managers and admins. The database checks again. */
export default async function RecordingsPage() {
  const me = await getMe();
  if (me?.role !== "sales_manager" && me?.role !== "admin") notFound();
  return (
    <Suspense>
      <RecordingsScreen />
    </Suspense>
  );
}
