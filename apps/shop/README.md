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
  - **Pay directly with a wallet**: an ERC-3009 signature from any EIP-1193
    wallet (`window.ethereum`), relayed gas-free by Polaris, with every state
    shown: connect, switch network, sign, relaying, paid, declined, wrong
    network, no wallet.
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

Every Polaris call is in two files:

| File | Side | Calls |
|---|---|---|
| [`src/lib/polaris.ts`](src/lib/polaris.ts) | Server | `createPolarisServer`, `checkout.sessions.create` (one idempotency key per order and attempt), `checkout.sessions.retrieve`, `webhooks.verify` |
| [`src/lib/polaris-client.ts`](src/lib/polaris-client.ts) | Browser | `createPolaris`, `openCheckout` / `redirectToCheckout`, `pay`, and the React components `PolarisMessaging`, `PolarisCheckoutButton`, `PolarisPayButton` |

They are written against `polarispay-sdk@0.3.0`, which is being built on the
`metropolis/sdk` branch. Until it is published they import a spec-exact
stand-in in [`src/lib/polaris-sdk`](src/lib/polaris-sdk); when 0.3.0 lands,
change the imports in those two files to `polarispay-sdk` and
`polarispay-sdk/react` and delete the folder.

The routes that use them:

| Route | What it does |
|---|---|
| `POST /api/checkout` | Validates and prices the order from the catalogue (never from the browser), stores it as `awaiting_payment` under the request's `Idempotency-Key`, then either creates a Polaris checkout session or returns what `pay()` needs |
| `POST /api/webhooks/polaris` | Verifies the signature against the raw body, dedupes on the event id, and moves the order forward if the event matches it (amount, currency). The only writer of `paid` |
| `GET /api/orders/[id]` | The order, for the receipt to poll. `?sync=1` also shows the session status from `sessions.retrieve` |
| `POST /api/orders/[id]/log` | The browser reports its SDK calls for the developer drawer. It can only append to a log |

Orders live in `apps/shop/.data/orders.json` (git-ignored), with an in-memory
fallback when the disk isn't writable.

## Run it with the dev mock (no backend needed)

```bash
pnpm install
pnpm --filter @polaris/shop dev        # http://localhost:3600
```

With `POLARIS_API_BASE` unset, `next dev` talks to a mock of the Polaris API
served by this app under `/api/dev-polaris`. It implements the same HTTP
contract as the real API (`POST` and `GET /api/v1/checkout/sessions`, bearer
secret key, idempotency keys, validation errors), a relayer that checks the
buyer's ERC-3009 signature, and signed webhook delivery back to the store with
retries. Its checkout page is labelled *Polaris test checkout · development
mock* on a striped banner; it lets you complete a session as Pay now, Pay in 4
or Subscribe, then posts the result back to the store exactly as the real
checkout does. In the developer drawer, *Collect instalment* and *Charge the
next month* fire the webhooks Polaris would send a week or a month later.

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

Direct wallet payments in dev mode are signed for real by your wallet on Monad
Testnet (chain 10143) and checked by the mock relayer, but nothing is sent on
chain: the authorization names the zero address as the payee, so it could
never move funds even if someone submitted it.

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
pnpm --filter @polaris/shop test        # vitest
pnpm --filter @polaris/shop lint
pnpm --filter @polaris/shop typecheck
pnpm --filter @polaris/shop build       # includes the no-dev-mock assertion
```

The tests cover the session route (catalogue pricing, the exact SDK request,
idempotency, retries, validation, the subscription rules, production refusing
the mock), webhook verification (valid, tampered, wrong secret, stale, future,
re-stamped, malformed, rolled secrets), the webhook route (tampered, unsigned,
stale and replayed deliveries, out-of-order instalments, no client write path),
the order status transitions, and the dev mock (idempotency, validation,
signature checks on the relayer, and that it is compiled only for `next dev`).

## What the shop needs from the SDK

Things the shop relies on that 0.3.0 should ship, or that the stand-in had to
decide. Each is marked in the stand-in's code.

1. **`openCheckout` must take a promise or a function** that resolves to the
   session, and open the popup synchronously inside the click, before the
   network call. Opening it after `await fetch(...)` is blocked by Safari and
   often by Chrome.
2. **The postMessage contract**: the hosted checkout posts
   `{ source: "polaris-checkout", version: 1, sessionId, status: "complete" | "canceled", mode, orderId }`
   to `window.opener` with the target origin of the session's `successUrl`,
   then closes. `openCheckout` accepts it only from `checkoutOrigin`, and
   resolves `closed` if the window closes without one. Without an opener
   (mobile), it redirects to `successUrl` or `cancelUrl`.
3. **`openCheckout` should reject a session URL that isn't on
   `checkoutOrigin`** with a configuration error, instead of opening it and
   never hearing back.
4. **Webhook event shape**: `{ id, object: "event", type, created, livemode, data }`,
   with `data.metadata` echoing the session's metadata and `data.orderId` /
   `data.sessionId` on every payment, plan and subscription event. The shop
   finds its order by `metadata.orderId`, then `sessionId`.
5. **`plan.opened.data.amount` is the principal** (what the merchant was paid),
   and `installments[]` carries `index`, `amount`, `dueAt`, `status`; with
   interest, the instalments sum to more than `amount`.
6. **A subscription session needs its terms**: `subscription: { interval, intervalCount }`
   on `sessions.create`. The spec has no field for it.
7. **`modes` order is a preference**: the checkout should open on `modes[0]`.
   The shop sends `["later", "now"]` for Pay in 4 so a buyer who isn't
   approved can still pay in full.
8. **`expiresAt` is ISO 8601** in the stand-in; confirm (Stripe uses Unix
   seconds).
9. **`PolarisPayButton` needs a `prepare()`** that creates the order at click
   time and returns `{ orderId, merchant, amount }`, since the order id must
   exist (and be unguessable) before the buyer signs.
10. **`pay()` needs a pinned EIP-712 domain option** for when the wallet's RPC
    can't answer `eip712Domain()`, and should refuse to sign when
    `PolarisPayments` isn't deployed on the chain (the stand-in throws
    `not_deployed`). The relayer endpoint and its request body
    (`payer, merchant, amount, value, orderId, validAfter, validBefore, v, r, s, signature, chainId`,
    authorised with the publishable key) need confirming with the API branch.
11. **`PolarisMessaging` needs to know the price**: an `aprBps` prop (or the
    merchant's Pay in 4 terms from the API). The plan prices Pay in 4 at 10%
    APR (4 × $50.38 for $200) while this store advertises interest-free; the
    team should pick one, and the component should say "interest-free" only
    when it is.
12. **`webhooks.generateTestHeader`** (for tests and local tools) and
    `PolarisSignatureVerificationError.reason`.
13. **A messaging variant for subscriptions** would let the Coffee Club page
    say *Subscribe with Polaris* in the provider's own words.
14. **`quotePayIn4` display amounts must add up.** Rounding each instalment
    to the cent separately shows $159.01 as 4 × $39.75 ($159.00). The
    stand-in splits the rounded total in whole cents and puts the remainder
    on the last payment; the branch's `money.ts` rounds each instalment.

## Credits

The product photographs and the room scene in `public/products` are
AI-generated for this demo and show no real brands. Type: Hedvig Letters Serif
and Schibsted Grotesk (SIL Open Font License), JetBrains Mono (OFL), self-hosted
through Fontsource. Motion by [Motion](https://motion.dev).
