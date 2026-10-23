import type { Metadata } from "next";
import { ImportScreen } from "./import-screen";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <ImportScreen kind={kind === "stock" ? "stock" : "patients"} />;
}
