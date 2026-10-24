import type { Metadata } from "next";
import { WhatsAppAdminScreen } from "./whatsapp-admin-screen";

export const metadata: Metadata = { title: "WhatsApp" };

export default function WhatsAppAdminPage() {
  return <WhatsAppAdminScreen webhookUrl={`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/wa-webhook`} />;
}
