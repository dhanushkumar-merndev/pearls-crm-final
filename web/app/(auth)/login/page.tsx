import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { WEB_ROLES } from "@pearl/shared";
import { getMe, hasSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const REASONS = { idle: "reasonIdle", no_access: "reasonNoAccess", password_changed: "reasonPasswordChanged" } as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  const t = await getTranslations("login");

  const me = await getMe();
  if (me) redirect(WEB_ROLES.includes(me.role) ? safeNext(next) : "/use-the-app");

  // Logged in, but no active staff record (deactivated): explain instead of looping.
  const signedInWithoutAccess = !me && (await hasSession());
  const reasonKey = signedInWithoutAccess ? "reasonNoAccess" : REASONS[reason as keyof typeof REASONS];

  return (
    <LoginForm
      next={safeNext(next)}
      notice={reasonKey ? t(reasonKey) : null}
      signOutFirst={signedInWithoutAccess}
    />
  );
}

/** Only allow redirects back into this app. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}
