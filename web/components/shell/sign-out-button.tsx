"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { forgetThisBrowser } from "@/lib/push/web-push";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export async function signOut(reason?: string) {
  // A shared computer must not keep popping up this person's notifications.
  await forgetThisBrowser();
  await getSupabaseBrowser()
    .auth.signOut()
    .catch(() => undefined);
  window.location.assign(reason ? `/login?reason=${reason}` : "/login");
}

export function SignOutButton() {
  const t = useTranslations("actions");
  return (
    <Button variant="secondary" onClick={() => signOut()}>
      <LogOut aria-hidden />
      {t("logOut")}
    </Button>
  );
}
