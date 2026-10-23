import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ClinicMark } from "@/components/clinic-mark";
import { getBranding } from "@/lib/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const [branding, t] = await Promise.all([getBranding(), getTranslations()]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <ClinicMark name={branding.name} logoPath={branding.logo_path} size={56} />
          <p className="text-lg font-medium text-text-secondary">{branding.name ?? t("app.name")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
