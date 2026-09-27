import Image from "next/image";

import { cn } from "@polaris/ui";

/**
 * The glass renders from the Polaris app's onboarding (coins in lime, purple
 * and crimson, the lime card with the star, the pin), as stills. Decorative.
 */
export type GlassArt = "coin-lime" | "coin-purple" | "coin-crimson" | "card-lime" | "pin";

export function Glass({
  art,
  size,
  className,
  priority = false,
}: {
  art: GlassArt;
  size: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/assets/glass/${art}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      sizes={`${size}px`}
      priority={priority}
      draggable={false}
      className={cn("pointer-events-none select-none", className)}
    />
  );
}
