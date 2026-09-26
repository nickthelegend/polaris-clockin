# Polaris for Business

The merchant dashboard (`@polaris/business`): sign in with Privy, share payment
links, follow payments and the Pay in 4 ledger, move money out, and wire up the
API. The product plan is [`docs/plan.md`](../../docs/plan.md) §3.2, §5.7 and
§5.8; the Privy details are in
[`docs/research/privy.md`](../../docs/research/privy.md).

```bash
pnpm install                                   # at the repo root
cp apps/business/.env.example apps/business/.env.local
pnpm --filter @polaris/business dev            # http://localhost:3100
```

Without `NEXT_PUBLIC_PRIVY_APP_ID` every page shows a setup screen and every API
route answers 503. `pnpm --filter @polaris/business build` works either way.

## Environment

| Variable | Where | Required | What it does |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | client + server | **yes** | The Privy app. Unset: the setup screen. Read at build time. |
| `PRIVY_APP_SECRET` | server | **yes** | Lets the server verify access tokens and look up the merchant's embedded wallet. |
| `PRIVY_APP_ID` | server | no | Overrides `NEXT_PUBLIC_PRIVY_APP_ID` on the server. |
| `PRIVY_VERIFICATION_KEY` | server | no | The app's JWT verification key (Dashboard > App settings). Skips the JWKS fetch after a cold start. |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | client | no | A Privy "app client" for this origin. |
| `NEXT_PUBLIC_MONAD_TESTNET_RPC` | client | no | Our own Monad testnet RPC for the embedded wallet instead of the public one. |
| `NEXT_PUBLIC_AUSD_ADDRESS` | client + server | no | AUSD on Monad testnet. When set, **Withdraw** asks the payout wallet to sign an ERC-3009 `TransferWithAuthorization` and the server verifies the signer. Unset: withdrawals are recorded as sample data. |
| `NEXT_PUBLIC_AUSD_EIP712_NAME`, `NEXT_PUBLIC_AUSD_EIP712_VERSION` | client + server | no | AUSD's EIP-712 domain (`eip712Domain()`). Default `AUSD` / `1`; check them against the deployed token. |
| `NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID` | client + server | no | The payout signer's key quorum ID. With AUSD set, turning on automatic payouts creates the per-merchant Privy policy and adds this signer to the wallet. |
| `PRIVY_ADMIN_QUORUM_ID` | server | no | Owner of each payout policy, so the app secret alone can't widen it (research §7). |
| `POLARIS_KEY_PEPPER` | server | no, but set it in production | HMAC pepper for stored secret-key hashes. |

In the Privy dashboard: turn on **Email** and **Google**, and add this origin to
the allowed domains. Monad testnet (10143) and mainnet (143) are configured in
code (`viem/chains`), testnet by default.

## How it fits together

```
src/app/(dashboard)/*     the pages, behind the Privy gate in (dashboard)/layout.tsx
src/app/login             sign in (Privy: email or Google), then name the business
src/app/api/*             route handlers; every one is exported through withMerchant()
src/lib/data              the DashboardData interface, types, formatting, sample data
src/server/auth.ts        verifies the Privy access token; returns user ID + embedded wallet
src/server/store.ts       MerchantStore interface + the in-memory implementation
src/server/services.ts    what each route does once the caller is known
```

### Authentication

`src/server/auth.ts` reads the Privy access token from `Authorization: Bearer`
or the `privy-token` cookie, verifies it with `@privy-io/node`
(`privy.utils().auth().verifyAccessToken`), and looks the merchant's embedded
wallet up from Privy by user ID. **Nothing the client sends can name the
merchant or their wallet**: the old merchant platform trusted an
`x-wallet-address` header, and anyone could read anyone's book.

- Every handler under `src/app/api` is `export const GET = withMerchant(...)`.
  `pnpm lint` runs `scripts/check-api-auth.mjs`, which fails on any handler that
  isn't.
- A cookie-authenticated `POST` must come from the same origin (a Bearer token
  can't be forged cross-site; a cookie can).
- Missing Privy config answers 503, never an unauthenticated fallback.

### Data

Pages use `DashboardData` (`src/lib/data/source.ts`) and nothing else. Today it
is implemented over our API routes (`http.ts`), which read `MerchantStore`
(`src/server/store.ts`). The store is an in-memory map, seeded per merchant with
deterministic sample payments, plans and payouts (`src/lib/data/placeholder.ts`)
and labelled "Sample data" in the UI. Links, API keys and webhook endpoints a
merchant creates are real entries in the store.

To move to a database, implement `MerchantStore` and return it from
`getStore()`. The indexer then fills payments, plans and the collector status;
no page changes.

### API routes

All authenticated. Responses are `{ data }` or `{ error: { code, message } }`.

| Route | Does |
|---|---|
| `GET /api/me`, `POST /api/me` | The merchant; set the business name (onboarding) |
| `GET /api/overview` | Balance, today's payments, Pay in 4 exposure, collector, automatic payouts |
| `GET /api/links`, `POST /api/links` | List; create (amount, description, modes, single-use or reusable, expiry) |
| `GET /api/payments` | Payments, newest first |
| `GET /api/plans` | The Pay in 4 ledger |
| `GET /api/payouts`, `POST /api/payouts` | Balance, settings, history; withdraw to an address |
| `POST /api/payouts/automatic` | Turn automatic daily payouts on or off |
| `GET /api/keys`, `POST /api/keys` | API keys; `POST` returns the secret key once and stores only its hash |
| `GET /api/webhooks`, `POST /api/webhooks` | Endpoints and delivery log; `POST` returns the signing secret once |
| `POST /api/webhooks/:id/test` | Sign and log a test `payment.succeeded` event |

### Payouts and Privy

- **Withdraw.** With AUSD configured, the embedded wallet signs
  `TransferWithAuthorization` (`useSignTypedData`), and the server rebuilds the
  typed data and checks the signature recovers to the merchant's wallet before
  queueing it for the relayer. The merchant never holds MON.
- **Automatic daily payouts.** The server creates a per-merchant Privy policy
  (`src/server/payout-policy.ts`, research §6.2) that allows only
  `eth_signTypedData_v4` AUSD transfers from the merchant's wallet to their
  payout address on Monad testnet. The browser then adds our payout signer with
  that policy (`useSigners().addSigners`); turning it off removes it.

## Not built yet

- The relayer that submits withdrawal authorisations, and the daily sweep cron.
- Live webhook delivery. Test events are signed exactly as live ones will be
  (`polaris-signature: t=…,v1=…`, the scheme in `packages/db/src/webhooks.ts`)
  and logged, but not sent: outbound delivery needs an SSRF guard and retries.
- `MerchantRegistry.registerFor` on onboarding, and the checkout-session API
  that the ten-line snippet calls.
- A database behind `MerchantStore`; the in-memory store is per server instance.
