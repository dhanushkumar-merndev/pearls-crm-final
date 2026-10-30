import type { ReactNode } from "react";
import { ClinicMark } from "@/components/clinic-mark";
import { getBranding } from "@/lib/session";

/** ChatGPT-style sign-in: no card, one plain column in the exact middle of the screen. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-[22rem]">
        <div className="mb-6 flex justify-center">
          <ClinicMark name={branding.name} logoPath={branding.logo_path} size={48} />
        </div>
        {children}
      </div>
    </main>
  );
}
