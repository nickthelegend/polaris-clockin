# Polaris for Business

The merchant side of Polaris (`@polaris/business`): the merchant landing,
sign-in with Privy, the dashboard (payment links, payments, the Pay in 4
ledger, payouts, API keys and webhooks) **and the backend every Polaris
payment goes through**. The web app is dark, in the Polaris app's visual
language, and every screen is composed from `packages/ui`
([`docs/design/system.md`](../../docs/design/system.md), "Web dashboard").

The backend:

- **the relayer**, a policy-locked Privy server wallet that carries every
  buyer action to Monad, so nobody but us ever holds MON;
- **the checkout API** that `polarispay-sdk` calls (`/api/v1/checkout/sessions`),
  with `sk_`/`pk_` keys and idempotency keys;
- **signed webhooks** with retries and a delivery log, built only from chain
  events;
- **merchant onboarding** on chain (`MerchantRegistry.registerFor`, signed by
  the merchant's embedded wallet) and **payouts**, one tap or automatic.

The plan is [`docs/plan.md`](../../docs/plan.md) §3.2, §5.3, §5.7 and §5.8;
the Privy details are in [`docs/research/privy.md`](../../docs/research/privy.md).

## One command

```bash
pnpm install
pnpm --filter @polaris/business e2e:local
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

## The backend

That starts a Hardhat node (`:8610`), deploys every contract with the testnet
deploy script, starts this server (`:3530`) with the dev relayer adapter,
seeds a merchant, and then, with the real `polarispay-sdk`: creates a checkout
session (and replays it with its Idempotency-Key), pays it now through
`/api/relay` as a buyer with no MON, opens a Pay in 4 plan after a CRE
underwriting report, pays through the SDK's direct-pay relay, collects
instalment 1 with a CRE collections report, and checks that `payment.succeeded`,
`plan.opened` and `installment.collected` arrive at a local receiver and verify
with the SDK. Nothing touches Privy, a public chain, or any account.

Other commands (`pnpm --filter @polaris/business <cmd>`):

| Command | What it does |
|---|---|
| `dev` | The dashboard and API on http://localhost:3100 |
| `test` | 104 unit and route tests (vitest, on SQLite in memory): validation, auth, idempotency, the relayer's policy and signature checks, chain ingestion, webhook signing and retries, payouts, onboarding |
| `lint` | ESLint, then `scripts/check-api-auth.mjs`: every route must be exported through the authentication its path requires |
| `typecheck`, `build` | `tsc --noEmit`; `next build` |
| `dev:merchant` | Create a local merchant with `sk_test_`/`pk_test_` keys (and a webhook endpoint) without Privy |
| `privy:setup-relayer` | Create the relayer wallet and its policy in your Privy app (dry run unless `-- --apply`) |
| `privy:setup-payouts` | Create the payout signer for automatic payouts (dry run unless `-- --apply`) |
| `privy:prove-policy` | Ask Privy to sign one allowed and four forbidden calls, and show what it refused (`-- --run`) |

## How a payment flows

```
merchant server ──polarispay-sdk──► POST /api/v1/checkout/sessions (sk_test_)  ──► session cs_test_…
buyer (Polaris app) ──────────────► GET  /api/public/sessions/cs_test_…         ──► price, modes, on-chain terms
buyer signs (Face ID, no gas) ────► POST /api/relay {type: "pay" | "openPlan" | "subscribe", …}
   relay.ts: rebuild the typed data, check the signature, check it against the session
   submit.ts: policy check → eth_call simulation → estimateGas + 15% → nonce lane → Privy signs → broadcast
   ingest.ts: the receipt's own events → session complete → records → webhook events
merchant server ◄── POST https://merchant/webhook (Polaris-Signature: t=…,v1=…) ── dispatcher.ts, with retries
```

"Paid" only ever comes from a transaction's events: the relayer's receipt, or
the chain sync (`ingest/sync.ts`) for everything the relayer didn't send (CRE
collections and renewals, liquidations, a buyer paying from their own wallet).
Each log is handled once, whichever path sees it first.

## The relayer (plan §5.3, research §5.5)

`src/server/policy/relayer.ts` is the allow-list, and both enforcers read it:

| Call | Who signs | Why the relayer can't redirect it |
|---|---|---|
| `PolarisCheckout.pay` | buyer: ERC-3009 `ReceiveWithAuthorization` | nonce = `keccak256(merchant, orderId)` |
| `PolarisCheckout.openPlan` | buyer: `PlanIntent` + ERC-2612 `Permit` | the intent names merchant, amount, schedule, order |
| `PolarisCheckout.subscribe` | buyer: `SubscribeIntent` + `Permit` | the intent names plan, price, period |
| `PolarisPayments.payWithAuthorization` | buyer (SDK direct pay) | as `pay` |
| `PolarisPayments.cancelWithSignature` | subscriber | |
| `PolarisPayments.createPlanFor` | (server: a session's subscription terms) | publishes a plan for the session's own merchant |
| `PolarisSend.send` / `claim` / `cancel` | sender + link key / link key / sender | the link key's signature names the recipient |
| `PolarisLoanEngine.repayWithSig` | borrower: `RepayIntent` | |
| `MerchantRegistry.registerFor` / `updatePayoutAddressWithSig` | merchant's embedded wallet | the merchant signs name and payout address |
| AUSD `transferWithAuthorization` | owner (withdrawals, payouts) | the owner signs `to` and `value` |

1. **Privy** (`RELAYER_MODE=privy`): `privy:setup-relayer` builds the policy
   from that list: one `DENY` for any transaction carrying MON, then one
   `ALLOW` per call (`eth_signTransaction`, this chain, this contract, this
   function, function-only ABI fragments). Anything else matches no rule and
   Privy denies it in its enclave. The wallet and the policy are owned by an
   offline admin key quorum; the server's key is only an additional signer, so
   a stolen server key can't change the policy (research §7).
2. **Us**: `checkRelayerCall` applies the same list before anything is signed,
   so the local dev adapter (`RELAYER_MODE=local`, a raw key, local chains
   only) is held to exactly the production policy, and a call Privy would
   refuse fails here with a clear error.

Privy signs and we broadcast to our own RPC (research §4.3, route B): it works
on any EVM chain and lets us set the gas limit, which Monad bills in full.

`POST /api/relay` also: verifies every signature server-side before
simulating; refuses a signature for another amount, merchant, order or
schedule than the session's; relays the same signatures once (the relay id is
their digest); refuses a second settlement for a session while one is in
flight; maps contract errors to messages for the buyer (`ExceedsCreditLimit`
→ "This is more than your Polaris limit right now."); and rate-limits per IP
and per signing account.

### Setting it up (you run these; they create things in your Privy app)

```bash
pnpm --filter @polaris/business privy:setup-relayer                          # dry run: the plan and the policy JSON
pnpm --filter @polaris/business privy:setup-relayer -- --apply --registry-admin
# fund the relayer address it prints with ~1 MON, then give it its roles:
RELAYER_ADDRESS=0x… pnpm --filter @polarispay/contracts grant-relayer:monad
NEW_OWNER=0x… node apps/business/scripts/transfer-registry-owner.mjs --apply  # only with --registry-admin, after grant-relayer
pnpm --filter @polaris/business privy:setup-payouts -- --apply
pnpm --filter @polaris/business privy:prove-policy -- --run                   # the bounty evidence: what Privy refused
```

The scripts write the server's side to `apps/business/.env.privy`
(git-ignored); copy those lines into `.env.local`. The admin key quorum's
private key is printed once and belongs offline.

## Checkout sessions (plan §5.8)

Exactly the HTTP contract in [`packages/sdk/README.md`](../../packages/sdk/README.md#http-api):

| Route | Auth | |
|---|---|---|
| `POST /api/v1/checkout/sessions` | `sk_test_` | Validates like the SDK (same `code` and `param` on every error); `Idempotency-Key`: same key and body → the first session (200), different body → 409 `idempotency_key_reused`, still running → 409 `idempotency_in_progress`; 24 h expiry; the on-chain order id is your `orderId`, else the session id |
| `GET /api/v1/checkout/sessions/{id}` | `sk_test_` | Your own sessions only (others are a 404); `status` becomes `complete` only from a chain event, `expired` from time |
| `POST /api/v1/relay/payments` | `pk_test_` | The SDK's `pay()` relay: `PolarisPayments.payWithAuthorization` for the key's own merchant, any other contract or chain refused |
| `GET /api/public/sessions/{id}` | public | What the hosted checkout reads: price, modes, the Pay in 4 schedule and whether it's offered (and why not), the exact on-chain terms; `?buyer=0x…` adds that buyer's nonces and loan quote. No metadata, no secrets |
| `POST /api/public/links/{id}/checkout` | public | Opens a dashboard payment link as a fresh one-hour session |
| `GET /api/public/network` | public | Chain, contract addresses and EIP-712 domains, from the deployment record |
| `POST /api/relay` | the buyer's signature | Every buyer action (above) |

Secret keys are stored only as `HMAC-SHA256(POLARIS_KEY_PEPPER, key)`; the
server refuses to hash without the pepper in production. Every response
carries `Polaris-Request-Id`; errors are `{ error: { code, message, param? } }`.

## Webhooks

`src/server/webhooks`: every event is stored once (its id derives from the
chain log it came from), then one delivery per subscribed endpoint:

- signed exactly as `polarispay-sdk` verifies: `Polaris-Signature: t=<unix>,v1=<HMAC-SHA256(whsec_…, "t.body")>`,
  with `Polaris-Event` and `Polaris-Delivery-Attempt`; the body is identical on
  every attempt;
- retried on failure at 1 min, 5 min, 30 min, 2 h, 6 h, 10 h and 15 h (eight
  attempts), each attempt logged with status, time and the start of the
  response; retry any delivery by hand;
- an SSRF guard refuses private and loopback addresses at connect time, not
  just when the URL is saved;
- all nine events: `payment.succeeded`, `plan.opened` (with the schedule),
  `installment.collected`, `installment.failed` (following the dunning ladder:
  one event per rung, not per CRE run), `plan.completed`, `plan.liquidated`,
  `subscription.charged`, `subscription.canceled`, `payout.paid`, with the
  fields in the SDK's `events.ts`.

Dashboard routes: `GET/POST /api/webhooks`, `DELETE /api/webhooks/{id}`,
`POST /api/webhooks/{id}/test` (sent now, signed like a live event),
`POST /api/webhooks/deliveries/{id}/retry`.

## Merchants, onboarding and payouts

- **Authentication**: every dashboard route verifies the Privy access token
  server-side (`@privy-io/node`) and reads the merchant's embedded wallet from
  Privy; nothing a client sends can name the merchant or their wallet.
- **Onboarding**: `GET /api/merchant/registration` returns the
  `Registration` typed data for the embedded wallet to sign;
  `POST` verifies it and relays `registerFor`, then (with `REGISTRY_ACTIVATOR`)
  activates the merchant for Pay in 4 at the cap. The client hook is
  `useRegisterMerchant()` in `src/lib/payouts.ts`.
- **One-tap withdraw**: `POST /api/payouts` with the wallet's
  `TransferWithAuthorization`; the server rebuilds it from the amount and
  destination, checks the signer and the balance, and relays it.
- **Automatic payouts**: `POST /api/payouts/automatic` creates the merchant's
  own Privy policy (only AUSD, only this chain, only from their wallet, only to
  their payout address, at most $10,000 per payout); the browser adds our
  payout signer under it (`useSigners().addSigners`). The daily sweep (and
  `POST /api/payouts/automatic/run`) signs with that signer and the relayer
  submits it; it refuses to run if the wallet no longer lists our signer with
  that exact policy.

## Environment

See [`.env.example`](.env.example) for every variable. The essentials:

| Variable | |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Sign-in; the dashboard routes answer 503 without them |
| `POLARIS_DEPLOYMENT` / `POLARIS_DEPLOYMENT_FILE`, `POLARIS_RPC_URL` | Which contracts, which RPC |
| `RELAYER_MODE` (+ `PRIVY_RELAYER_*`) | `privy` in production, `local` on a Hardhat node, `off` |
| `POLARIS_KEY_PEPPER` | Required in production |
| `POLARIS_CHECKOUT_ORIGIN` | Where session URLs point (`https://pay.polarispay.app`) |
| `CRON_SECRET` | For `/api/cron/tick` on serverless hosts |

## Code map

```
src/app/api/**                 route handlers; each exported through one wrapper from src/server/auth.ts
src/server/auth.ts             Privy tokens, sk_/pk_ keys, signed requests, public, cron; errors → responses
src/server/env.ts              configuration, the deployment record
src/server/policy/             the relayer, registry-admin and payout policies (plain TS, shared with scripts)
src/server/relayer/            relay.ts (requests), carry.ts (bookkeeping), submit.ts (gas, nonces, broadcast), signer.ts (Privy / local)
src/server/sessions/           params.ts (the SDK's validation), idempotency.ts, sessions.ts
src/server/ingest/             ingest.ts (chain events → records + webhooks), sync.ts (the log poller, late receipts)
src/server/webhooks/           events.ts (emit), dispatcher.ts (deliver, retry)
src/server/payouts/            withdrawals and the automatic sweep
src/server/onboarding.ts       MerchantRegistry registration and activation
src/server/services.ts         the dashboard's reads and writes
src/instrumentation.ts         starts the background loops on a long-running server
packages/db                    the store, the record schema, key hashing, webhook signing and delivery
```

## Storage and deployment

The store is SQLite (`node:sqlite`, nothing to install) at
`POLARIS_DB_URL` (default `sqlite:.data/polaris.db`), so run it as one server
with a persistent disk; on a serverless host, implement `@polaris/db`'s
`Store` over Postgres. The relayer assigns nonces in-process: run one relayer
instance per wallet. Background work runs in-process (`POLARIS_WORKERS`,
default on outside production), or from a scheduler calling
`POST /api/cron/tick` with `CRON_SECRET`.

Without a deployment record the dashboard still runs: new merchants see a
sample book, labelled as such, and nothing is relayed.
