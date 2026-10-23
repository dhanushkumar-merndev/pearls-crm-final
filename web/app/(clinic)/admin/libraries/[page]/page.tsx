import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LIBRARY_PAGES, type LibraryPage } from "@/components/admin/library-configs";
import { LibraryScreen } from "./library-screen";

export const metadata: Metadata = { title: "Libraries" };

export default async function LibraryRoute({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(LIBRARY_PAGES as readonly string[]).includes(page)) notFound();
  return <LibraryScreen page={page as LibraryPage} />;
}
