import type { Metadata } from "next";
import { Cards } from "./cards";

export const metadata: Metadata = { title: "Your cards" };

export default function CardsPage() {
  return <Cards />;
}
