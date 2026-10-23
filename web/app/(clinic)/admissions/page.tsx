import type { Metadata } from "next";
import { AdmissionsScreen } from "./admissions-screen";

export const metadata: Metadata = { title: "IP stays" };

export default function AdmissionsPage() {
  return <AdmissionsScreen />;
}
