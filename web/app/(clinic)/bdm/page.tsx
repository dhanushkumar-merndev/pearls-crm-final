import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/session";
import { BdmScreen } from "./bdm-screen";

export const metadata: Metadata = { title: "BDM" };

/** Admin only (PLAN.md C7: BDM data is own + admin). The database checks again. */
export default async function BdmPage() {
  const me = await getMe();
  if (me?.role !== "admin") notFound();
  return <BdmScreen />;
}
