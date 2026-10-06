// What the four devnet demo merchants sell. The merchants themselves are real
// accounts registered on chain by packages/solana/scripts/setup-devnet.ts;
// prices here are what the checkout charges.
export type Item = { id: string; title: string; price: number; note: string };
export type Shop = { slug: string; tagline: string; icon: string; tint: string; items: Item[] };

export const SHOPS: Shop[] = [
  {
    slug: "nomada-coffee",
    tagline: "Coffee bar · Lisbon",
    icon: "cafe",
    tint: "#c27c4a",
    items: [
      { id: "flat-white", title: "Flat white", price: 4.5, note: "Oat or whole milk" },
      { id: "beans", title: "House beans, 1 kg", price: 28, note: "Washed Ethiopia" },
    ],
  },
  {
    slug: "kora-rail",
    tagline: "Rail passes · Europe",
    icon: "train",
    tint: "#2fae7a",
    items: [
      { id: "porto", title: "Lisbon → Porto, return", price: 64, note: "Second class, flexible" },
      { id: "interrail", title: "Interrail, 7 days", price: 180, note: "Any 7 days in a month" },
    ],
  },
  {
    slug: "lumen-audio",
    tagline: "Headphones · studio gear",
    icon: "headset",
    tint: "#4f7cff",
    items: [
      { id: "headphones", title: "Studio headphones", price: 240, note: "Closed back, 32 Ω" },
      { id: "cable", title: "Braided cable", price: 18, note: "3 m, 3.5 mm" },
    ],
  },
  {
    slug: "studio-sol",
    tagline: "Design studio · Buenos Aires",
    icon: "sunny",
    tint: "#ff8a3d",
    items: [
      { id: "identity", title: "Brand identity package", price: 200, note: "Logo, type, colour" },
      { id: "poster", title: "Gig poster", price: 45, note: "A2, two colours" },
    ],
  },
];

export const shopOf = (slug: string) => SHOPS.find((s) => s.slug === slug);
