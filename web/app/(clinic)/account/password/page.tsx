import type { Metadata } from "next";
import { getMe } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change my password" };

export default async function ChangePasswordPage() {
  const me = await getMe();
  return <ChangePasswordForm username={me?.username ?? ""} />;
}
