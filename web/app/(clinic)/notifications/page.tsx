import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsScreen } from "./notifications-screen";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationsScreen />
    </Suspense>
  );
}
