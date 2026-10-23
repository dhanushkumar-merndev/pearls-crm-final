import type { Metadata } from "next";
import { FollowupsScreen } from "./followups-screen";

export const metadata: Metadata = { title: "Follow-ups" };

export default function FollowupsPage() {
  return <FollowupsScreen />;
}
