import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** Treatments: reception manages them like the admin (owner, 27/11/2026). */
export default async function Layout({ children }: { children: ReactNode }) {
  await onlyFor(["receptionist", "admin"]);
  return children;
}
