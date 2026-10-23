import { Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { WEB_ROLES } from "@pearl/shared";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Use the app" };

/** Sales executives and BDMs work in the Android app. */
export default async function UseTheAppPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (WEB_ROLES.includes(me.role)) redirect("/home");
  const t = await getTranslations("useTheApp");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
      <Smartphone aria-hidden className="size-12 text-text-secondary" />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-text-secondary">{t("body")}</p>
      <SignOutButton />
    </main>
  );
}
