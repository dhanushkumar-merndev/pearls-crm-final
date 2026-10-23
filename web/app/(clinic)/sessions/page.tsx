import type { Metadata } from "next";
import { SessionsScreen } from "./sessions-screen";

export const metadata: Metadata = { title: "Sessions to book" };

export default function SessionsPage() {
  return <SessionsScreen />;
}
