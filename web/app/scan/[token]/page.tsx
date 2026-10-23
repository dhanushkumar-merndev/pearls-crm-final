import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhoneScan } from "./phone-scan";

export const metadata: Metadata = { title: "Scan pages", robots: { index: false, follow: false } };

/** Opened from the QR in the desk's scanner, on a phone. No login: the link works on one phone only. */
export default async function PhoneScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32,128}$/.test(token)) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-6">
      <PhoneScan token={token} />
    </main>
  );
}
