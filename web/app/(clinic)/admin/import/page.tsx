import type { Metadata } from "next";
import { ImportScreen } from "./import-screen";

export const metadata: Metadata = { title: "Import patients" };

export default function ImportPage() {
  return <ImportScreen />;
}
