import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { TemplateEditor, type Template } from "./template-editor";

export const metadata: Metadata = { title: "Discharge template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("discharge_templates").select("id, name, sections, medications, follow_up_days, active").eq("id", id).maybeSingle();
  if (!data) notFound();
  return <TemplateEditor initial={data as Template} />;
}
