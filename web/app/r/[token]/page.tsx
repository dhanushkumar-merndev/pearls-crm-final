import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SelfRegistration } from "./self-registration";

export const metadata: Metadata = { title: "Registration", robots: { index: false, follow: false } };

/** Opened from the reception QR on the patient's own phone. No login. */
export default async function SelfRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32,128}$/.test(token)) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-8">
      <SelfRegistration token={token} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </main>
  );
}
