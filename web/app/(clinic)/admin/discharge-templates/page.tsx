import type { Metadata } from "next";
import { TemplatesScreen } from "./templates-screen";

export const metadata: Metadata = { title: "Discharge templates" };

export default function DischargeTemplatesPage() {
  return <TemplatesScreen />;
}
