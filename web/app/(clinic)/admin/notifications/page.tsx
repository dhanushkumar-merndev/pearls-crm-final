import type { Metadata } from "next";
import { NotificationRules } from "@/components/admin/notification-rules";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return <NotificationRules />;
}
