import type { Metadata } from "next";
import { PendingScreen } from "./pending-screen";

export const metadata: Metadata = { title: "Pending registrations" };

export default function PendingPage() {
  return <PendingScreen />;
}
