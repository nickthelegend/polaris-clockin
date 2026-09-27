"use client";

import { Avatar, Button, Dialog, Money, type ButtonSize, type ButtonVariant } from "@polaris/ui";
import { ArrowLeft, ArrowUpRight, ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";

import { DEMO_SHOP_URL } from "@/lib/features";
import { CheckoutPreview } from "./checkout-preview";

/**
 * "See the demo shop". With NEXT_PUBLIC_DEMO_SHOP_URL set it opens the
 * deployed storefront; without one it opens a small shop right here, with the
 * real checkout components, so the button always does what it says.
 */
export function DemoShopButton({
  label,
  icon,
  variant = "outline",
  size = "lg",
}: {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  if (DEMO_SHOP_URL) {
    return (
      <Button asChild variant={variant} size={size} icon={icon} iconRight={<ArrowUpRight />}>
        <a href={DEMO_SHOP_URL} target="_blank" rel="noreferrer">
          {label}
        </a>
      </Button>
    );
  }
  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DemoShopDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const PRODUCTS = [
  { name: "Brand identity package", cents: 200_00, tone: "honey" as const, note: "Logo, palette, type and a one-page guide" },
];

function DemoShopDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<"shop" | "checkout">("shop");
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(() => setStep("shop"), 250);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="sm"
      title={step === "shop" ? "Oat & Ember, a demo shop" : "Checkout"}
      description="A demonstration: nothing is charged."
      sheetSnapPoints={["full"]}
    >
      <Dialog.Body className="pb-6">
        {step === "shop" ? (
          <div className="grid gap-3">
            {PRODUCTS.map((p) => (
              <div key={p.name} className="flex items-center gap-4 rounded-ui-tile bg-ui-surface-2 p-4">
                <Avatar name={p.name} tone={p.tone} size="lg" icon={<ShoppingBag />} decorative />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-medium">{p.name}</p>
                  <p className="truncate text-[13px] text-ui-muted">{p.note}</p>
                  <Money value={p.cents / 100} className="mt-1 text-[17px] font-medium" />
                </div>
                <Button variant="lime" size="sm" onClick={() => setStep("checkout")}>
                  Buy
                </Button>
              </div>
            ))}
            <p className="px-1 pt-2 text-[13px] leading-relaxed text-ui-muted">
              In a real shop, Buy opens the Polaris checkout: Pay now, Pay in 4 or Subscribe, confirmed with Face ID.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => setStep("shop")} className="justify-self-start">
              Back to the shop
            </Button>
            <div className="h-[560px] overflow-hidden rounded-ui-card bg-ui-canvas pt-4">
              <CheckoutPreview />
            </div>
          </div>
        )}
      </Dialog.Body>
    </Dialog>
  );
}
