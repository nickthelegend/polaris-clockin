import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderView } from "@/components/order/order-view";
import { getOrder } from "@/lib/orders/service";
import { browserConfig } from "@/lib/polaris";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ via?: string }> }) {
  const [{ id }, { via }] = await Promise.all([params, searchParams]);
  const order = await getOrder(id);
  if (!order) notFound();
  const config = browserConfig();
  return (
    <OrderView
      initial={order}
      fromPolaris={via === "polaris"}
      fromCheckout={via === "polaris" || via === "wallet"}
      devMock={config.ok && config.target === "dev-mock"}
    />
  );
}
