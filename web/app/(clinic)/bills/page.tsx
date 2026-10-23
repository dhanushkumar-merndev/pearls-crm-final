import type { Metadata } from "next";
import { BillsScreen } from "./bills-screen";

export const metadata: Metadata = { title: "Bills" };

export default function BillsPage() {
  return <BillsScreen />;
}
