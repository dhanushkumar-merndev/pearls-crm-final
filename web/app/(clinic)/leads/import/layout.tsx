import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** A managers' lead page: sales managers and admins only (sales executives get "This page doesn't exist"). */
export default async function ManagerLeadsLayout({ children }: { children: ReactNode }) {
  await onlyFor(["sales_manager", "admin"]);
  return children;
}
