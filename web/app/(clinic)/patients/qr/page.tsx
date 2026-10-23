import type { Metadata } from "next";
import { QrScreen } from "./qr-screen";

export const metadata: Metadata = { title: "Registration QR" };

export default function QrPage() {
  return <QrScreen />;
}
