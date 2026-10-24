import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxScreen } from "./inbox-screen";

export const metadata: Metadata = { title: "WhatsApp" };

export default function WhatsAppInboxPage() {
  return (
    <Suspense>
      <InboxScreen />
    </Suspense>
  );
}
