import type { Metadata } from "next";
import { PoolScreen } from "./pool-screen";

export const metadata: Metadata = { title: "Lead pool" };

export default function PoolPage() {
  return <PoolScreen />;
}
