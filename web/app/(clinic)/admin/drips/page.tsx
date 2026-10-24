import type { Metadata } from "next";
import { DripsScreen } from "./drips-screen";

export const metadata: Metadata = { title: "Drip campaigns" };

export default function DripsPage() {
  return <DripsScreen />;
}
