import type { ReactNode } from "react";
import { DESK_ROLES, onlyFor } from "@/lib/session";

/** Front-desk pages: reception and admin only (sales managers get "This page doesn't exist"). */
export default async function DeskLayout({ children }: { children: ReactNode }) {
  await onlyFor(DESK_ROLES);
  return children;
}
