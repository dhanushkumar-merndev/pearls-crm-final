import type { Metadata } from "next";
import { PatientsScreen } from "./patients-screen";

export const metadata: Metadata = { title: "Patients" };

export default function PatientsPage() {
  return <PatientsScreen />;
}
