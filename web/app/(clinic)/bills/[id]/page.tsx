import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Bill } from "@/components/bills/types";
import { getSupabaseServer } from "@/lib/supabase/server";
import { BillScreen } from "./bill-screen";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_bill", { p_bill_id: id });
  if (error || !data) notFound();
  return <BillScreen initial={data as Bill} />;
}
