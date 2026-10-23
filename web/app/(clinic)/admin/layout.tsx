import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/session";

/** Admin pages exist only for admins (others get "This page doesn't exist"). The database refuses them anyway. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (me?.role !== "admin") notFound();
  return children;
}
