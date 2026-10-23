import type { Metadata } from "next";
import { ReviewScreen } from "./review-screen";

export const metadata: Metadata = { title: "New items to review" };

export default function ReviewPage() {
  return <ReviewScreen />;
}
