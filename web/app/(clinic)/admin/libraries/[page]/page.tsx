import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LIBRARY_PAGES, type LibraryPage } from "@/lib/library-pages";
import { LibraryScreen } from "./library-screen";

export const metadata: Metadata = { title: "Libraries" };

export default async function LibraryRoute({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(LIBRARY_PAGES as readonly string[]).includes(page)) notFound();
  // Doctors and services moved out of Admin (reception manages them too).
  if (page === "doctors" || page === "services") redirect(`/${page}`);
  return <LibraryScreen page={page as LibraryPage} />;
}
