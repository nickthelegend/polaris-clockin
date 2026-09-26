# Halcyon: a store that takes payment through Polaris

Halcyon is a demo online store (headphones, lamps, a chair, a coffee
subscription) built the way any merchant would integrate Polaris. It exists
for the Monad Metropolis demo: a normal-looking shop, with Polaris only where
a store embeds a payment provider.

- **Product pages** carry Polaris on-site messaging under the price: *or 4
  payments of $87.25 with Polaris*, with a *Learn more* popover.
- **The bag** (a drawer and `/cart`) repeats it for the bag total.
- **Checkout** offers two ways to pay:
  - **Polaris**: *Pay in full*, *Pay in 4* on Polaris credit, or *Subscribe*
    for the Coffee Club. The server creates a checkout session with the SDK;
    the browser opens the hosted Polaris checkout in a centred popup (a
    full-page redirect on phones) and reacts to the result it posts back.
  - **Pay directly with a wallet**: `polaris.pay()` asks any EIP-1193 wallet
    (`window.ethereum`) for one ERC-3009 signature and the Polaris relayer
    submits it gas-free, with every state shown: connect (and switch to
    Monad Testnet), sign, relaying, paid, declined, wrong network, no wallet.
- **The receipt** (`/orders/[id]`) updates live. An order becomes *paid* only
  when a signed Polaris webhook says so, never because the browser did. Pay in
  4 orders show the four-payment schedule from `plan.opened` and tick off each
  `installment.collected`; subscriptions show the next charge date.
- **Built with Polaris** (the floating button, bottom left) shows the exact SDK
  calls this checkout made, server and browser, and every webhook it received,
  with the ten lines of integration code.

Pages: `/`, `/shop`, `/products/[slug]`, `/cart`, `/checkout`,
`/orders/[id]`. Screenshots of each page and each checkout path, at 1440×900
and 390×844, are in [`docs/design/shop`](../../docs/design/shop): `desktop-*`
and `mobile-*`, plus `popup-*` for the checkout window on desktop. They were
taken against the dev mock, with motion settled; the wallet screens use a
scripted EIP-1193 test wallet in place of MetaMask.

## The integration

The shop uses **`polarispay-sdk` 0.3.0** from this workspace
(`packages/sdk`, merged from the `metropolis/sdk` branch). Every Polaris call
is in two files:

| File | Side | Calls |
|---|---|---|
| [`src/lib/polaris.ts`](src/lib/polaris.ts) | Server, `polarispay-sdk/server` | `createPolarisServer`, `checkout.sessions.create` (the order id as `orderId`, one idempotency key per order and attempt), `checkout.sessions.retrieve`, `webhooks.verify` |
| [`src/lib/polaris-client.ts`](src/lib/polaris-client.ts) | Browser, `polarispay-sdk` and `polarispay-sdk/react` | `createPolaris`, `openCheckout` (through `PolarisCheckoutButton`), `pay`, `PolarisMessaging`, `PolarisMark` |

The SDK ships from `dist/`, so it has to be built before the shop runs:
`pnpm --filter @polaris/shop dev`, `build` and `test` do it first (so does the
`shop` entry in `.claude/launch.json`, which runs the dev script on port 3600).

The routes that use them:

| Route | What it does |
|---|---|
| `POST /api/checkout` | Validates and prices the order from the catalogue (never from the browser), stores it as `awaiting_payment` under the request's `Idempotency-Key`, then either creates a Polaris checkout session or returns what `pay()` needs |
| `POST /api/webhooks/polaris` | Verifies the signature against the raw body, dedupes on the event id, and moves the order forward if the event matches it (amount, currency). The only writer of `paid` |
| `GET /api/orders/[id]` | The order, for the receipt to poll. `?sync=1` also shows the session status from `sessions.retrieve` |
| `POST /api/orders/[id]/log` | The browser reports its SDK calls for the developer drawer. It can only append to a log |

An order becomes paid on `payment.succeeded` (Pay now, and direct wallet
payments), `plan.opened` (Pay in 4: the store is paid the principal in full
when the plan opens) or the first `subscription.charged`, and only when the
amount and currency match the order; anything else sends it to review.

Orders live in `apps/shop/.data/orders.json` (git-ignored), with an in-memory
fallback when the disk isn't writable.

## Run it with the dev mock (no backend needed)

```bash
pnpm install
pnpm --filter @polaris/shop dev        # builds the SDK, then http://localhost:3600
```

With `POLARIS_API_BASE` unset, `next dev` talks to a mock of the Polaris API
served by this app under `/api/dev-polaris`. It implements the same HTTP
contract as the real API (`POST` and `GET /api/v1/checkout/sessions`, bearer
secret key, idempotency keys, validation errors, the `CheckoutSession`
shape), a relayer that takes the SDK's `RelayPayRequest` and checks the
buyer's ERC-3009 signature, and webhooks in the SDK's event shapes, signed
with its `signWebhookPayload` and retried on 409 and 5xx. Its checkout page
is labelled *Polaris test checkout · development mock* on a striped banner;
it lets you complete a session as Pay now, Pay in 4 or Subscribe, then
answers the store with the SDK's own `createCheckoutMessage` (`ready`, then
`completed` or `canceled`), or redirects to the success URL on a phone. In
the developer drawer, *Collect instalment* and *Charge the next month* fire
the webhooks Polaris would send a week or a month later.

The mock can't run in production:

- its route files are named `route.dev.ts` / `page.dev.tsx`, and
  `next.config.ts` only includes those extensions for the development server,
  so a production build doesn't contain them at all;
- `pnpm --filter @polaris/shop build` ends with
  `scripts/assert-no-dev-mock.mjs`, which fails the build if any
  `dev-polaris` route is in `.next`;
- each mock route also answers 404 unless `NODE_ENV=development` and
  `POLARIS_API_BASE` is unset, and the shop only ever points at the mock under
  the same two conditions (tested in `test/dev-mock.test.ts`).

**Direct wallet payments and the mock.** The SDK's `pay()` reads the chain
through the buyer's wallet before it asks for a signature (the token's
decimals and EIP-712 domain, the balance, whether the order is already paid
or priced), and PolarisPayments isn't deployed on Monad testnet yet. So in
dev mode the shop points the SDK at a stand-in PolarisPayments address,
`0x…dEaD`, which no one can call from, so a signature for it can never move
money; the mock relayer only checks it. A real browser wallet can't answer
the reads for that address, so the wallet path works end to end with the
scripted test wallet the screenshots use, and with a real wallet once the
contracts are deployed.

## Run it against the real Polaris backend

1. Start the Polaris API (apps/business, port 3100) and the hosted checkout
   (apps/app, port 3000).
2. In Polaris for Business, create test API keys and a webhook endpoint for
   `http://localhost:3600/api/webhooks/polaris`.
3. Copy [`.env.example`](.env.example) to `.env.local` (git-ignored) and set:

   ```bash
   POLARIS_API_BASE=http://localhost:3100
   POLARIS_SECRET_KEY=sk_test_…
   NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY=pk_test_…
   NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN=http://localhost:3000
   POLARIS_WEBHOOK_SECRET=whsec_…
   POLARIS_MERCHANT_ADDRESS=0x…          # the store's payout address
   # POLARIS_RELAY_URL=…                 # defaults to {POLARIS_API_BASE}/api/v1/relay
   ```

4. `pnpm --filter @polaris/shop dev`. Setting `POLARIS_API_BASE` switches the
   mock off.

In production (`next build && next start`) all six values are required; with
any missing, checkout shows *Payments are switched off* instead of guessing.

`POLARIS_PAY_IN_4_APR_BPS` sets the Pay in 4 price the store advertises: 0
(the default) is interest-free, 1000 is the loan engine's 10% APR. The copy
("interest-free", "no fees when you pay on time") follows it.

## Checks

```bash
pnpm --filter @polaris/shop test        # builds the SDK, then vitest
pnpm --filter @polaris/shop lint
pnpm --filter @polaris/shop typecheck
pnpm --filter @polaris/shop build       # includes the no-dev-mock assertion
```

The tests cover the session route (catalogue pricing, the exact request the
SDK sends, idempotency, retries, validation, the subscription rules,
production refusing the mock), webhook verification through the store's
config (valid, tampered, wrong secret, stale, future, re-stamped, malformed,
rolled secrets), the webhook route (tampered, unsigned, stale and replayed
deliveries, out-of-order instalments, no client write path), the order status
transitions for every event, Pay in 4 pricing, and the dev mock (the
`CheckoutSession` shape, idempotency, validation, the relayer's checks, and
that it is compiled only for `next dev`).

## What the shop needs from the SDK

Found while building against `polarispay-sdk` 0.3.0:

1. **`pay()` can't run until PolarisPayments is deployed**, and there's no
   test path: it reads decimals, the EIP-712 domain, the balance,
   `paymentFor` and `quotedAmount` through the wallet. A test mode (or
   overrides for those reads) would let a store demo direct pay against a
   test relayer before the contracts land.
2. **`PolarisPayButton` needs an async order.** Its `orderId` is a string or
   a synchronous function, but a store has to create the order on its server
   (the id the buyer signs for must exist and be unguessable) at click time.
   The shop calls `polaris.pay()` from its own button instead; a
   `createOrder: () => Promise<{ orderId, merchant, amount }>` prop would fix it.
3. **Wrong network vs. declined.** When the buyer refuses the network switch,
   `pay()` says "You cancelled the request." rather than asking them to
   switch to Monad Testnet; a distinct `code` on the result (not only
   `cause`) would let a store show the right step.
4. **Messaging figures.** `.plrs-msg strong` and `.plrs-caption strong` force
   `tabular-nums`, which in some fonts (Schibsted Grotesk here) spaces out
   the point: "$87 . 25". The store overrides it; the SDK could leave figures
   to the host font or expose `--polaris-numeric`.
5. **`quotePayIn4` display amounts don't always add up.** Each instalment is
   rounded to the cent on its own, so $159.01 shows as 4 × $39.75 ($159.00).
   Splitting the rounded total in whole cents, with the remainder on the last
   payment, keeps what the buyer reads consistent. (The store's prices all
   divide evenly, so it doesn't show here.)
6. **Line items can't carry a variant or a photo.** `LineItem` is name,
   quantity and price, so the shop folds the option into the name ("Halcyon
   One, Graphite"). `description` and `imageUrl` would let the hosted checkout
   show what the buyer is paying for.
7. **A Polaris lockup component.** The SDK exports the mark; stores that list
   Polaris among payment methods need mark + wordmark (the shop sets its own).
8. **Pay in 4 terms from the API.** `PolarisMessaging` and the checkout button
   default to 10% APR; a store that funds interest-free plans has to pass
   `aprBps={0}` everywhere. The merchant's terms from the API (or the session)
   would keep the badge, the button and the hosted checkout in agreement. The
   plan prices Pay in 4 at 10% APR while this store advertises interest-free;
   the team should pick one.
9. **A subscription messaging variant** would let the Coffee Club page say
   *Subscribe with Polaris* in the provider's own words.
10. **Workspace consumers need a build step.** The package exports only
    `dist/`; a `development` export condition pointing at `src/` would let
    apps in the monorepo use it without building it first.

## Credits

The product photographs and the room scene in `public/products` are
AI-generated for this demo and show no real brands. Type: Hedvig Letters Serif
and Schibsted Grotesk (SIL Open Font License), JetBrains Mono (OFL), self-hosted
through Fontsource. Motion by [Motion](https://motion.dev).
