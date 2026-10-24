import type { Metadata } from "next";
import { ImportScreen } from "@/components/import/import-screen";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <ImportScreen kind={kind === "stock" ? "stock" : kind === "leads" ? "leads" : "patients"} />;
}
