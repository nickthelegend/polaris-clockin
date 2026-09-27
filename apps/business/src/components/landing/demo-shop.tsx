import { Button, type ButtonSize, type ButtonVariant } from "@polaris/ui";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { DEMO_SHOP_URL } from "@/lib/features";

/**
 * "See the demo shop": Halcyon (apps/shop), a storefront that pays through
 * polarispay-sdk with Pay now, Pay in 4 and direct wallet pay. It runs on
 * http://localhost:3600 by default; NEXT_PUBLIC_DEMO_SHOP_URL points it at a
 * deployed one.
 */
export function DemoShopButton({
  label,
  icon,
  variant = "outline",
  size = "lg",
  className,
}: {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Button asChild variant={variant} size={size} icon={icon} iconRight={<ArrowUpRight />} className={className}>
      <a href={DEMO_SHOP_URL} target="_blank" rel="noreferrer">
        {label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}
