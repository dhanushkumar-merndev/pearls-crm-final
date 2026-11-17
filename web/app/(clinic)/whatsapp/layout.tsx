import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** The shared WhatsApp inbox: reception, sales managers and admins (sales executives reply from a lead's page on the phone). */
export default async function WhatsAppLayout({ children }: { children: ReactNode }) {
  await onlyFor(["receptionist", "sales_manager", "admin"]);
  return children;
}
