import type { Metadata } from "next";
import { MetaLeadsScreen } from "./meta-leads-screen";

export const metadata: Metadata = { title: "Meta lead ads" };

export default function MetaLeadsPage() {
  return <MetaLeadsScreen webhookUrl={`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/meta-leads`} />;
}
