import type { Metadata } from "next";
import { LibraryScreen } from "../admin/libraries/[page]/library-screen";

export const metadata: Metadata = { title: "Treatments" };

/** Treatment plans: sessions, gaps and package prices; sales quote from them (reception and admin). */
export default function TreatmentsPage() {
  return <LibraryScreen page="treatments" />;
}
