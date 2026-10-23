import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PurchaseScreen, type Purchase } from "./purchase-screen";

export const metadata: Metadata = { title: "Purchase" };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "new") return <PurchaseScreen initial={null} />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_purchase", { p_purchase_id: id });
  if (error || !data) notFound();
  return <PurchaseScreen initial={data as Purchase} />;
}
