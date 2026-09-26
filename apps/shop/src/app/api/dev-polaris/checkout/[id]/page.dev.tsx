import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TestCheckout } from "@/components/dev-polaris/test-checkout";
import { devMockEnabled } from "@/lib/dev-polaris/guard";
import { getSession, publicSession } from "@/lib/dev-polaris/mock";
import { payInFourApr } from "@/lib/polaris";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Polaris test checkout (dev mock)", robots: { index: false } };

/** The dev mock's stand-in for the hosted Polaris checkout (the Polaris app's /pay/[id] sheet). */
export default async function TestCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  if (!devMockEnabled()) notFound();
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  return <TestCheckout session={publicSession(session)} aprBps={payInFourApr()} />;
}
