import type { Metadata } from "next";
import { Gallery } from "@polaris/ui/gallery";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Every @polaris/ui component in every variant, beside the reference it reproduces.",
};

/** The component gallery. Public: it needs no Privy session and no merchant data. */
export default function GalleryPage() {
  return <Gallery app="business" />;
}
