import type { Metadata } from "next";
import { Claim } from "./claim";

export const metadata: Metadata = {
  title: "You've got dollars",
  // A claim link is a bearer secret in its fragment. Keep it out of indexes and previews.
  robots: { index: false, follow: false },
};

export default function ClaimPage() {
  return <Claim />;
}
