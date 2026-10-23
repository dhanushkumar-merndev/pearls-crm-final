import type { Metadata } from "next";
import { AppointmentsScreen } from "./appointments-screen";

export const metadata: Metadata = { title: "Appointments" };

export default function AppointmentsPage() {
  return <AppointmentsScreen />;
}
