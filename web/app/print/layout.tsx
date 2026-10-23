import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import "./print.css";

/** A4 print pages: always white, no app shell. Staff only. */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  return <div className="print-root">{children}</div>;
}
