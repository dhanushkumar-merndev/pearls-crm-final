import type { Metadata } from "next";
import { getMe } from "@/lib/session";
import { UsersScreen } from "./users-screen";

export const metadata: Metadata = { title: "Staff logins" };

export default async function UsersPage() {
  const me = await getMe();
  return <UsersScreen myId={me!.id} />;
}
