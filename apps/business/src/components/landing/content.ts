/**
 * The merchant landing's copy and its fixed sample figures. Everything here is
 * illustrative (an invented studio, "Oat & Ember"), and the figures are pure
 * arithmetic with no clock or timezone in them, so the server and the browser
 * render the same page.
 */

export const nav = {
  links: [
    { label: "Payments", href: "#ways" },
    { label: "Credit", href: "#credit" },
    { label: "Developers", href: "#developers" },
    { label: "Payouts", href: "#payouts" },
    { label: "Pricing", href: "#pricing" },
    { label: "FAQ", href: "#faq" },
  ],
};

export const hero = {
  eyebrow: "Polaris for Business · live on Monad testnet",
  headline: ["Get paid in full.", "Let them pay in 4."],
  sub: "One payment link. Your buyer pays now, in four payments on Polaris credit, or by subscription. You're paid in full, in dollars, in 0.8 seconds.",
  primary: "Start accepting payments",
  secondary: "See the demo shop",
  trust: ["0.5% per payment", "No setup or monthly fees", "The credit risk is ours"],
};

export const sponsors = {
  pill: "Built on Monad with Privy, Chainlink CRE, Nansen, Envio, Agora AUSD and Mera",
  items: [
    { name: "Monad", glyph: "monad" },
    { name: "Privy", glyph: "privy" },
    { name: "Chainlink CRE", glyph: "chainlink" },
    { name: "Nansen", glyph: "nansen" },
    { name: "Envio", glyph: "envio" },
    { name: "Agora AUSD", glyph: "agora" },
    { name: "Mera", glyph: "mera" },
  ],
} as const;

export const ways = {
  eyebrow: "Checkout",
  heading: ["One link,", "three ways to pay."],
  sub: "Share a link or a QR, or open the checkout from your own site. The buyer picks how to pay with Face ID. You never chase anyone.",
  cards: [
    {
      key: "now",
      title: "Pay now",
      body: "In full, in dollars. Settled before the page could reload.",
      foot: "0.5% fee",
    },
    {
      key: "later",
      title: "Pay in 4",
      body: "Four payments on the buyer's Polaris credit line. You still get 100% today.",
      foot: "100% to you, today",
    },
    {
      key: "subscribe",
      title: "Subscribe",
      body: "Monthly or weekly. A missed period is skipped, never stacked on the next.",
      foot: "0.5% per charge",
    },
  ],
} as const;

export const credit = {
  eyebrow: "Credit",
  heading: ["Paid in full today.", "We carry the credit."],
  sub: "With Pay in 4 you're paid the whole order the moment the buyer confirms. Collections, reminders and the risk of a missed payment are ours.",
  stats: [
    { value: 0.8, suffix: " s", decimals: 1, label: "from Confirm to your balance" },
    { value: 100, suffix: "%", decimals: 0, label: "of every Pay in 4 order, up front" },
    { value: 0, prefix: "$", decimals: 0, label: "of credit risk on your side" },
  ],
  flow: [
    { title: "The buyer confirms", body: "Face ID in the Polaris app. No wallet, no gas, no seed phrase.", tag: "0.0 s" },
    { title: "You're paid $200.00", body: "In AUSD, to your payout account, final on Monad.", tag: "0.8 s" },
    { title: "Chainlink CRE collects", body: "A workflow checks every minute and takes each $50.38 on its weekly due date.", tag: "Weekly" },
    { title: "A payment fails? We retry", body: "After 6 hours, a day, three days. The buyer is reminded; you're never involved.", tag: "Ours" },
  ],
  underwriting: {
    title: "Why Kofi got a $500 line",
    note: "Facts from Nansen wallet history, attested by Chainlink CRE nodes. The score is computed on chain.",
    reasons: [
      { text: "First funded from a major exchange", points: 10 },
      { text: "Two years of wallet history", points: 8 },
      { text: "Paid back an earlier plan on time", points: 12 },
      { text: "No liquidations on record", points: 6 },
      { text: "Not part of a cluster of related wallets", points: 5 },
    ],
  },
};

export const developers = {
  eyebrow: "Developers",
  heading: ["Ten lines of code."],
  sub: "Create a checkout session on your server, open it from your page, and fulfil from a signed webhook. Or skip the code and share a link.",
  bullets: [
    "Checkout sessions with idempotency keys",
    "Webhooks signed with HMAC, replay-protected",
    "React button with Pay in 4 messaging built in",
  ],
  note: "polarispay-sdk 0.3.0",
  samples: [
    {
      key: "react",
      label: "React",
      filename: "components/checkout.tsx",
      language: "tsx",
      code: `"use client";
import { PolarisCheckoutButton } from "polarispay-sdk/react";

// Your /api/checkout route creates the session (Node tab) and returns it.
export function Checkout({ cart }: { cart: { id: string; title: string; total: string } }) {
  return (
    <PolarisCheckoutButton
      publishableKey={process.env.NEXT_PUBLIC_POLARIS_KEY!}
      amount={cart.total}
      createSession={() =>
        fetch("/api/checkout", { method: "POST", body: JSON.stringify(cart) }).then((r) => r.json())
      }
      onSuccess={() => location.assign("/thanks")}
    />
  );
}`,
    },
    {
      key: "node",
      label: "Node",
      filename: "server.ts",
      language: "ts",
      code: `import express from "express";
import { createPolarisServer } from "polarispay-sdk/server";

const polaris = createPolarisServer({
  secretKey: process.env.POLARIS_SECRET_KEY!, // sk_test_… from Developers
  baseUrl: process.env.POLARIS_BASE_URL!, // this dashboard's URL
});
const app = express();

app.post("/checkout", express.urlencoded({ extended: false }), async (req, res) => {
  const { id, title, total } = req.body;
  const session = await polaris.checkout.sessions.create(
    { amount: total, description: title, orderId: id, successUrl: "https://your.shop/thanks" },
    { idempotencyKey: id },
  );
  res.redirect(303, session.url);
});

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["polaris-signature"];
  const event = polaris.webhooks.verify(req.body, signature, process.env.POLARIS_WEBHOOK_SECRET!);
  if (event.type === "payment.succeeded" || event.type === "plan.opened") fulfil(event.data.orderId);
  res.sendStatus(204);
});`,
    },
    {
      key: "html",
      label: "HTML",
      filename: "checkout.html",
      language: "html",
      code: `<!-- Posts to /checkout in the Node tab, which redirects to Polaris -->
<form action="/checkout" method="post">
  <input type="hidden" name="id" value="INV-2041" />
  <input type="hidden" name="title" value="Brand identity package" />
  <input type="hidden" name="total" value="200.00" />
  <button type="submit">Pay with Polaris</button>
</form>

<!-- No server at all: paste a payment link from your dashboard -->
<a href="https://pay.polarispay.app/pay/pl_…">Pay $200, or 4 × $50.38</a>`,
    },
  ],
} as const;

export const payouts = {
  eyebrow: "Payouts",
  heading: ["Easy withdraw."],
  sub: "Your balance is dollars in an account only you control, created when you sign up. Move it whenever you like.",
  features: [
    { title: "One tap, to any address", body: "An exchange, a treasury, a bank on-ramp. Confirm once and it's there in under a second." },
    { title: "No network fee", body: "You never hold MON. Our relayer pays the gas, and it can only send what you signed." },
    { title: "Automatic daily payouts", body: "A Privy session signer sweeps your balance every day at 17:00 UTC, to one address you choose and nowhere else." },
  ],
};

export const pricing = {
  eyebrow: "Pricing",
  line: ["0.5% per payment.", "Pay in 4 costs you nothing."],
  sub: "No setup fee and no monthly fee. On Pay in 4 you receive 100% of the order; the buyer pays 10% APR, pro-rated and shown before they confirm.",
  compare: "Cards: about 2.9% + 30¢, and days to settle",
};

export const faq = {
  heading: ["Questions,", "answered."],
  sub: "About checkout, credit, payouts and what it costs.",
  items: [
    {
      q: "Do my customers need a crypto wallet?",
      a: "No. They open your link and create an account with Face ID in a few seconds. No wallet to install, no seed phrase and no gas to hold. Prices are in dollars, and they tap Confirm once.",
    },
    {
      q: "How does Pay in 4 work for me?",
      a: "At checkout the buyer can split the order into four weekly payments against a credit line built from their payment and wallet history. You're paid 100% the moment they confirm. Collections and missed payments are ours.",
    },
    {
      q: "When do I get paid?",
      a: "When the payment lands: Monad finalises in under a second, so the order shows Paid before the page could reload. Your balance is in dollars (AUSD) and you can withdraw the same minute.",
    },
    {
      q: "How do I withdraw?",
      a: "One tap to any address, with no network fee: our relayer submits what your account signed. Or turn on automatic daily payouts, and a Privy session signer that can only pay your chosen address sweeps your balance every day.",
    },
    {
      q: "What does it cost?",
      a: "0.5% per payment and per subscription charge. On Pay in 4 you pay nothing: you receive 100% of the order, and the buyer's interest (10% APR, pro-rated, $1.53 on $200) pays for the credit. Nothing monthly, nothing to set up.",
    },
    {
      q: "Is it live?",
      a: "Polaris runs on Monad testnet today, with test dollars. Payment links, Pay in 4, subscriptions and payouts run end to end there; mainnet starts with Pay now and payouts, capped.",
    },
  ],
};

export const closing = {
  heading: ["Your first link", "in a minute."],
  sub: "Sign in, name your business, share a link. Your payout account is created for you.",
};

/** Daily payment volume in $K for the hero's candle panel: a steady run-up with two dips. */
export const heroCandles = (() => {
  const path = [
    74, 70, 69, 71, 68, 79, 95, 101, 103, 104, 102, 105, 88, 77, 76, 99, 103, 106, 110, 116, 117, 115, 113, 112, 116, 124, 128.06,
  ];
  // A tiny deterministic wobble (no Math.random: the server and the browser must agree).
  const wobble = (i: number, k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  let prev = path[0]! + 2;
  return path.map((close, i) => {
    const open = i === 12 ? 105 : i === 13 ? 86 : i === 15 ? 78 : prev + (wobble(i, 1) - 0.5) * 2;
    const high = Math.max(open, close) + wobble(i, 2) * 6 + 0.5;
    const low = Math.min(open, close) - wobble(i, 3) * 5 - 0.5;
    prev = close;
    return {
      t: `2026-08-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      o: Number(open.toFixed(2)),
      h: Number(high.toFixed(2)),
      l: Number(low.toFixed(2)),
      c: Number(close.toFixed(2)),
    };
  });
})();

export const heroSalesSpark = [18, 21, 19.5, 20, 22.6, 17.8, 18.4, 21.2, 23.1, 17.6, 20.8, 22.2, 19.4, 18.3, 23.6];
