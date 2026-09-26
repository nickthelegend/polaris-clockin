import { notFound } from "next/navigation";
import { brandMark } from "@/lib/brand-mark";

/** PWA icons for the manifest, rendered once at build time. */
const ICONS = {
  "icon-192.png": () => brandMark(192),
  "icon-512.png": () => brandMark(512),
  // Maskable: full bleed, the star inside the 80% safe zone.
  "maskable-512.png": () => brandMark(512, { bleed: true, starScale: 0.44 }),
} as const;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const render = ICONS[name as keyof typeof ICONS];
  if (!render) notFound();
  return render();
}
