# Polaris for Business

The merchant side of Polaris (`@polaris/business`): the landing page, sign-in
with Privy, and the dashboard (payment links, payments, the Pay in 4 ledger,
payouts, API keys and webhooks). It is dark, in the Polaris app's visual
language, and every screen is composed from `packages/ui`
([`docs/design/system.md`](../../docs/design/system.md), "Web dashboard").
The product plan is [`docs/plan.md`](../../docs/plan.md) §3.2, §5.7 and §5.8;
the Privy details are in [`docs/research/privy.md`](../../docs/research/privy.md).

```bash
pnpm install                                   # at the repo root
cp apps/business/.env.example apps/business/.env.local
pnpm --filter @polaris/business dev            # http://localhost:3100
```

Without `NEXT_PUBLIC_PRIVY_APP_ID`, /login and /dashboard show a setup screen
(in development it says what to configure; in production it only says sign-in
is unavailable) and every API route answers 503. The landing page and
`pnpm --filter @polaris/business build` work either way.

## Pages

| Path | What |
|---|---|
| `/` | The merchant landing, "Polaris for Business". Signed-in merchants see **Open dashboard** in its nav. |
| `/login` | Sign in: one **Continue** that opens Privy's modal, then (first time only) the business name. |
| `/dashboard` | Overview: sales, customers this week, sales by mode, payment volume candles, recent sales, credit exposure with Nansen reasons, the Chainlink CRE collections run, the Envio event feed |
| `/dashboard/payments` | Every payment; rows open a detail drawer |
| `/dashboard/links` | Payment links: create (dialog), turn off |
| `/dashboard/plans` | The Pay in 4 ledger with instalment ticks; rows open a plan drawer |
| `/dashboard/payouts` | Balance, one-tap withdraw (with a confirm step), automatic daily payouts, history |
| `/dashboard/developers` | API keys (revoke), webhooks (add, edit, pause, remove, test event, delivery log), the SDK snippet, the demo shop |
| `/gallery` | Every `@polaris/ui` component, beside the reference it reproduces |

The dashboard used to live at the top level: `/payments`, `/links`, `/plans`,
`/payouts` and `/developers` (and anything under them) redirect to
`/dashboard/…` (`next.config.ts`). Detail views open in a right-hand drawer and
create/edit flows in a dialog; below 768px both are bottom sheets.

## Privy: sign-in and the payout wallet

The dashboard never draws a sign-in button of its own for any method. The
sign-in page's **Continue** calls Privy's `login()`, and Privy's modal lists
exactly the methods turned on for the app in the Privy dashboard.

As configured today (checked against the Privy app):

- **Email** is on, and **external wallets** are on.
- **Google is off.** To offer it, turn it on in the Privy dashboard (Login
  methods > Socials > Google); it then appears in the modal by itself, with no
  code change.
- **Allowed domains is empty**, which lets every origin use the app id. Before
  launch, add `http://localhost:3100` and the production domain under
  App settings > Domains, so no other site can start sign-in with it.
- The dashboard's own "create embedded wallet on login" is off; the client
  config asks for it instead (`embeddedWallets.ethereum.createOnLogin:
  "all-users"` in `src/components/auth/privy-auth.tsx`), so every merchant,
  including one who signs in with an external wallet, gets a self-custodial
  payout wallet. Until Privy reports it, the dashboard polls `/api/me`.

The Privy modal carries the team's wordmark (`packages/brand/assets/wordmark.png`)
and our surface and lime colours. If Privy can't be reached for 8 seconds
(offline, a blocker, a firewall), /login and /dashboard say so and offer Retry.

`NEXT_PUBLIC_PRIVY_ANDROID_CLIENT_ID` belongs to the consumer app's Android
build. Never pass it as this web app's `clientId`.

## Environment

| Variable | Where | Required | What it does |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | client + server | **yes** | The Privy app. Unset: the setup screen. Read at build time. |
| `PRIVY_APP_SECRET` | server | **yes** | Lets the server verify access tokens and look up the merchant's embedded wallet. |
| `PRIVY_APP_ID` | server | no | Overrides `NEXT_PUBLIC_PRIVY_APP_ID` on the server. |
| `PRIVY_VERIFICATION_KEY` | server | no, but set it in production | The app's JWT verification key (Dashboard > App settings). Skips the JWKS fetch after every cold start. |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | client | no | A Privy "app client" for this web origin (not the Android one). |
| `NEXT_PUBLIC_MONAD_TESTNET_RPC` | client | no | Our own Monad testnet RPC for the embedded wallet instead of the public one. |
| `NEXT_PUBLIC_AUSD_ADDRESS` | client + server | no | AUSD on Monad testnet, for ERC-3009 withdrawal signatures. |
| `NEXT_PUBLIC_AUSD_EIP712_NAME`, `NEXT_PUBLIC_AUSD_EIP712_VERSION` | client + server | no | AUSD's EIP-712 domain. Default `AUSD` / `1`; check them against the deployed token. |
| `NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID` | client + server | no | The payout signer's key quorum ID, added to a merchant's wallet for automatic payouts. |
| `PRIVY_ADMIN_QUORUM_ID` | server | no | Owner of each payout policy, so the app secret alone can't widen it. |
| `POLARIS_KEY_PEPPER` | server | no, but set it in production | HMAC pepper for stored secret-key hashes. |
| `NEXT_PUBLIC_CONSUMER_APP_URL` | client + server | no | The Polaris app's origin. Payment links are `<this>/pay/<id>`. Default `http://localhost:3000`. |
| `NEXT_PUBLIC_PAY_BASE_URL` | client + server | no | Overrides the link base entirely. |
| `NEXT_PUBLIC_DEMO_SHOP_URL` | client | no | The deployed demo storefront. Unset: "See the demo shop" opens a built-in demo checkout. |
| `POLARIS_WEBHOOK_ALLOW_PRIVATE` | server | no | Outside production only: lets webhook URLs point at localhost and private networks, for local testing. |

**Switches for what is live.** A control whose service isn't running is
disabled, with the reason beside it; it is never left to fail, and nothing
claims money moved when it didn't (`src/lib/features.ts`,
`src/lib/data/links.ts`). Set each to `1` once the piece exists:

| Variable | Turns on |
|---|---|
| `NEXT_PUBLIC_PAY_LINKS_LIVE` | Sharing, copying and QR codes for links (once the consumer checkout reads links from this store) |
| `NEXT_PUBLIC_PAYOUT_RELAYER_LIVE` | Withdraw (also needs `NEXT_PUBLIC_AUSD_ADDRESS`) |
| `NEXT_PUBLIC_PAYOUT_SWEEP_LIVE` | Automatic payouts (also needs withdrawals and the payout signer) |
| `NEXT_PUBLIC_CHECKOUT_API_LIVE` | Creating API keys, and the copy button on the SDK snippet |
| `NEXT_PUBLIC_POLARIS_DEMO_DATA` | A labelled sample book for every new merchant (demos only; off by default) |

**Development only:** `POLARIS_DEV_MOCK_SESSION=1 pnpm --filter
@polaris/business dev` opens the dashboard as an invented merchant with a
labelled sample book, served from the browser, for screenshots;
`POLARIS_DEV_MOCK_SESSION=empty` is the same merchant just after signing up
(nothing paid, nothing connected). It never talks to the API. It exists only
when `NODE_ENV` is `development`: `next.config.ts` blanks the variable in every
other build and the code checks `NODE_ENV` too, so a production build compiled
with the variable set still requires Privy.

## How it fits together

```
src/app/(privy)/page.tsx          the landing (components/landing)
src/app/(privy)/login             sign in, then name the business
src/app/(privy)/dashboard/*       the pages, behind the gate in dashboard/layout.tsx
src/app/(privy)/layout.tsx        Privy (AuthProvider) and the data source: only this group mounts them
src/app/gallery, not-found.tsx    no Privy
src/app/api/*                     route handlers; every one is exported through withMerchant()
src/components/auth               Privy, the unconfigured state and the dev-only mock, behind one AuthContext
src/components/shell              the sidebar, top bar, floating nav and the header's account menu
src/lib/data                      the DashboardData interface, types, formatting, sample data,
                                  and the sponsor-backed panels' typed functions (insights.ts)
src/server/auth.ts                verifies the Privy access token; returns user ID + embedded wallet
src/server/store.ts               MerchantStore interface + the in-memory implementation
src/server/services.ts            what each route does once the caller is known
```

### Authentication

`src/server/auth.ts` reads the Privy access token from `Authorization: Bearer`
or the `privy-token` cookie, verifies it with `@privy-io/node`
(`privy.utils().auth().verifyAccessToken`, using `PRIVY_APP_SECRET`), and looks
the merchant's embedded wallet up from Privy by user ID. Nothing the client
sends can name the merchant or their wallet.

- Every handler under `src/app/api` is `export const GET = withMerchant(...)`.
  `pnpm lint` runs `scripts/check-api-auth.mjs`, which fails on any handler that
  isn't. Unknown `/api/*` paths and unsupported methods answer JSON 404 and 405.
- A cookie-authenticated write must come from the same origin, and writes are
  rate-limited per merchant.
- Missing Privy config answers 503 `auth_not_configured`; a user Privy no longer
  has answers 401 `invalid_token`.
- In the browser, a 401 (`unauthenticated` or `invalid_token`) from any request
  signs out, says "Your session ended. Sign in again." and goes to
  `/login?next=<the page>`. A refresh that fails while older data is on screen
  shows a banner with the data's age and Retry. Pressing **Sign out** goes to
  `/login` with no `next`.

### Data

Pages use `DashboardData` (`src/lib/data/source.ts`) and nothing else. Today it
is implemented over our API routes (`http.ts`), which read `MerchantStore`
(`src/server/store.ts`).

**The store is in memory, per server instance.** A restart clears the business
name, links, keys and webhooks, and on serverless each instance has its own
copy. The dashboard says so where it matters (links, keys, webhooks). To move
to a database, implement `MerchantStore` keyed by the Privy user ID and return
it from `getStore()`; no page changes.

A new merchant starts with an empty book: zero balance, empty states, and the
indexer, CRE and Nansen panels showing "not connected". Sample data appears only
when the merchant chooses **Preview with sample data** (account menu, this
browser only), on a server with `NEXT_PUBLIC_POLARIS_DEMO_DATA=1`, or in the dev
mock session, and then every card and row that shows it carries a **Sample**
chip.

The Overview's sponsor-backed panels read typed functions in
`src/lib/data/insights.ts` (`getCollectionsRun` for Chainlink CRE,
`getIndexedEvents` for Envio, `getUnderwritingReasons` for Nansen). Each returns
`{ source: "not_connected" }` today, or clearly named `placeholder*` data when
sample data is on; wiring a service means returning `{ source: "live" }` from it.

### API routes

All authenticated. Responses are `{ data }` or
`{ error: { code, message, field? } }`, where `message` is written for a person
and `field` names the request field a validation error is about.

| Route | Does |
|---|---|
| `GET /api/me`, `POST /api/me` | The merchant; set the business name (onboarding) |
| `GET /api/overview` | Balance, today's payments, Pay in 4 exposure, collector, automatic payouts |
| `GET /api/links`, `POST /api/links` | List; create (amount, description, modes, single-use or reusable, expiry). At most 500 per merchant. |
| `PATCH /api/links/:id` | `{ active: false }` turns a link off. Links are never deleted. |
| `GET /api/payments` | Payments, newest first |
| `GET /api/plans` | The Pay in 4 ledger |
| `GET /api/payouts`, `POST /api/payouts` | Balance, settings, history; withdraw to an address |
| `POST /api/payouts/automatic` | Turn automatic daily payouts on or off (off never needs the wallet) |
| `GET /api/keys`, `POST /api/keys` | API keys; `POST` returns the secret key once and stores only its hash |
| `DELETE /api/keys/:id` | Revoke a key |
| `GET /api/webhooks`, `POST /api/webhooks` | Endpoints and delivery log; `POST` returns the signing secret once |
| `PATCH /api/webhooks/:id`, `DELETE /api/webhooks/:id` | Edit an endpoint (URL, events, on/off), or remove it |
| `POST /api/webhooks/:id/test` | Sign and log a test `payment.succeeded` event |

Webhook URLs must be `https` on port 443 and must not resolve to loopback,
private, link-local or CGNAT addresses (`src/server/net-guard.ts`); the check
runs at registration and again before a test event, after DNS resolution.
Payout addresses in mixed case must match their EIP-55 checksum.

### Payouts and Privy

- **Withdraw.** With AUSD configured, the embedded wallet signs
  `TransferWithAuthorization` (`useSignTypedData`) after a confirm dialog
  (amount, destination, no fee), and the server rebuilds the typed data and
  checks the signature recovers to the merchant's wallet before queueing it for
  the relayer. The receipt shows the real status: Queued until the relayer
  sends it.
- **Automatic daily payouts.** The server creates a per-merchant Privy policy
  (`src/server/payout-policy.ts`) that allows only `eth_signTypedData_v4` AUSD
  transfers from the merchant's wallet to their payout address on Monad
  testnet. The browser then adds our payout signer with that policy
  (`useSigners().addSigners`); turning it off removes it.

## Not built yet

- A database behind `MerchantStore` (see "Data").
- The relayer that submits withdrawal authorisations, and the daily sweep.
- Live webhook delivery. Test events are signed exactly as live ones will be
  (`polaris-signature: t=…,v1=…`, the scheme in `packages/db/src/webhooks.ts`)
  and logged, but not sent.
- The checkout-session API and `polarispay-sdk` 0.3, which the ten-line snippet
  previews; API keys authenticate nothing until then.
- The consumer checkout reading links from this store, and the indexer, CRE and
  Nansen feeds behind the Overview.
