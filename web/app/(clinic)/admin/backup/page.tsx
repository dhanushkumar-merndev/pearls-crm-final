import type { Metadata } from "next";
import { BackupCentre } from "@/components/admin/backup-centre";

export const metadata: Metadata = { title: "Backup centre" };

export default function BackupPage() {
  return <BackupCentre />;
}
