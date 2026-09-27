import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TestCheckout } from "@/components/dev-polaris/test-checkout";
import { devMockEnabled } from "@/lib/dev-polaris/guard";
import { getSession, publicSession } from "@/lib/dev-polaris/mock";
import { getOrderByRef } from "@/lib/orders/service";
import { payInFourApr } from "@/lib/polaris";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Polaris checkout (test)", robots: { index: false } };

/** The dev mock's stand-in for the hosted Polaris checkout (the Polaris app's /pay/[id] sheet). */
export default async function TestCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  if (!devMockEnabled()) notFound();
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  // The real checkout gets line items with photos from the merchant; the mock borrows them from the store's order.
  const order = session.orderId ? await getOrderByRef(session.orderId) : null;
  const thumbnails = order?.lines.map((line) => ({ name: `${line.name}, ${line.optionValue}`, image: line.image })) ?? [];
  return <TestCheckout session={publicSession(session)} aprBps={payInFourApr()} thumbnails={thumbnails} />;
}
