import type { Metadata } from "next";
import { LibraryScreen } from "../admin/libraries/[page]/library-screen";

export const metadata: Metadata = { title: "Services" };

/** Services and their prices for bills (reception and admin). */
export default function ServicesPage() {
  return <LibraryScreen page="services" />;
}
