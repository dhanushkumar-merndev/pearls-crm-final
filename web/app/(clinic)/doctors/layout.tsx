import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** Doctors and services: reception manages them like the admin (owner, 25/11/2026). */
export default async function Layout({ children }: { children: ReactNode }) {
  await onlyFor(["receptionist", "admin"]);
  return children;
}
