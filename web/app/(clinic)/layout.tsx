import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { WEB_ROLES } from "@pearl/shared";
import { AppShell } from "@/components/shell/app-shell";
import { getIdleLogoutMinutes, getMe } from "@/lib/session";

export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!WEB_ROLES.includes(me.role)) redirect("/use-the-app");
  const idleMinutes = await getIdleLogoutMinutes();
  return (
    <AppShell me={me} idleMinutes={idleMinutes}>
      {children}
    </AppShell>
  );
}
