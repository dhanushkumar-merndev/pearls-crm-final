import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { DESK_ROLES, getMe } from "@/lib/session";
import "./print.css";

/** A4 print pages: always white, no app shell. Front desk only. */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  // Bills, registrations and discharge summaries: front-desk papers.
  if (!DESK_ROLES.includes(me.role)) notFound();
  return <div className="print-root">{children}</div>;
}
