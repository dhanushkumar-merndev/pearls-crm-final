import type { Metadata } from "next";
import { ImportScreen } from "@/components/import/import-screen";

export const metadata: Metadata = { title: "Import leads" };

export default function LeadsImportPage() {
  return <ImportScreen kind="leads" />;
}
