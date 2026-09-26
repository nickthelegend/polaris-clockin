import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentLink } from "@/lib/data";
import { Checkout } from "./checkout";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const link = await getPaymentLink(id);
  return { title: link ? `Pay ${link.merchant.name}` : "Payment link" };
}

/** A merchant's payment link: pay now, in four, or on a subscription. */
export default async function PayLinkPage({ params }: Props) {
  const { id } = await params;
  const link = await getPaymentLink(id);
  if (!link) notFound();
  return <Checkout link={link} />;
}
