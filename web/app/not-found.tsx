import { House } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("errors.notFound")}</h1>
      <Button asChild>
        <Link href="/home">
          <House aria-hidden />
          {t("actions.goHome")}
        </Link>
      </Button>
    </main>
  );
}
