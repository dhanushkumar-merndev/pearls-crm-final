import type { Metadata } from "next";
import { LibraryScreen } from "../admin/libraries/[page]/library-screen";

export const metadata: Metadata = { title: "Doctors" };

/** Doctors: add, change, hours, leave and signature (reception and admin). */
export default function DoctorsPage() {
  return <LibraryScreen page="doctors" />;
}
