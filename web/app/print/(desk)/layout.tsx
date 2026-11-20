import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { DESK_ROLES, getMe } from "@/lib/session";

/** Bills, registrations and discharge summaries: front-desk papers. */
export default async function DeskPrintLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me || !DESK_ROLES.includes(me.role)) notFound();
  return children;
}
