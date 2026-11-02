import type { Metadata } from "next";
import { AppointmentsScreen } from "./appointments-screen";

export const metadata: Metadata = { title: "Appointments" };

/** `?auto=1&date=YYYY-MM-DD` (from an "auto-cancelled" alert) opens the table filtered to those bookings. */
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : undefined;
  return <AppointmentsScreen autoCancelled={q.auto === "1" ? { date } : undefined} />;
}
