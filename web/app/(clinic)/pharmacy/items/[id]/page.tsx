import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ItemScreen, type ItemStock } from "./item-screen";

export const metadata: Metadata = { title: "Medicine stock" };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("item_stock", { p_item_id: id });
  if (error || !data) notFound();
  return <ItemScreen initial={data as ItemStock} />;
}
