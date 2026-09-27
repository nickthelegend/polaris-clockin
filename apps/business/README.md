# Polaris for Business

The merchant side of Polaris (`@polaris/business`): the dashboard (Privy login
and payout wallet, payment links, payments, the Pay in 4 ledger, payouts, API
keys and webhooks) **and the backend every Polaris payment goes through**:

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

A session's order id is public, so anyone can settle that order on chain some
other way. Two things stop that from counting as paid:

- every session's price is pinned on chain (`PolarisPayments.quoteOrder`, sent
  by the relayer on its operator role) before the session is returned, so
  every payment path reverts on any other amount;
- ingest completes a session only when what settled its order matches it
  (amount or principal, a mode it offers, its own plan and period). Anything
  else is kept on the session as a `mismatch`, never completes it, never
  counts on its payment link and sends no `payment.succeeded`.

The SDK's direct-pay relay (`/api/v1/relay/payments`) refuses an order id that
belongs to a checkout session, and one PolarisCheckout already settled.

## The relayer (plan §5.3, research §5.5)

`src/server/policy/relayer.ts` is the allow-list, and both enforcers read it:

| Call | Who signs | Why the relayer can't redirect it |
|---|---|---|
| `PolarisCheckout.pay` | buyer: ERC-3009 `ReceiveWithAuthorization` | nonce = `keccak256(merchant, orderId)` |
| `PolarisCheckout.openPlan` | buyer: `PlanIntent` + ERC-2612 `Permit` | the intent names merchant, amount, schedule, order |
| `PolarisCheckout.subscribe` | buyer: `SubscribeIntent` + `Permit` | the intent names plan, price, period |
| `PolarisPayments.payWithAuthorization` | buyer (SDK direct pay) | as `pay` |
| `PolarisPayments.cancelWithSignature` | subscriber | |
| `PolarisPayments.createPlanFor` | operator (server: a session's subscription terms) | publishes a plan for the session's own merchant; moves nothing |
| `PolarisPayments.quoteOrder` | operator (server: a session's price) | pins the session's price on its order before the order id is handed out; moves nothing |
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
