# Zero-mock test plan

Every page, endpoint, on-chain interaction and integration of Polaris, with
what "correct" means for each. Run through a real browser (Claude in Chrome)
against the real local stack: an anvil fork of Monad testnet with Agora's
AUSD, real contracts, real signed transactions, the real SQLite store, the
real APIs. On every item the console has no errors and the network tab has
no failed request the product didn't expect. Status is one of **PASS**,
**FAIL** (with the fix), or **UNTESTED** (with the exact missing
dependency); never PASS on an assumption. See [`PLAN.md`](../PLAN.md) P4.

**Stack under test.** `demo:local` in fork mode on its own ports (PLAN P2.1).
Buyers sign in with a real WebAuthn ceremony: Claude in Chrome uses the
person's own platform authenticator (Touch ID) when they are present; the
automated run (`demo:e2e`) uses Chrome's virtual authenticator with PRF, so
Mera's own code derives every key. Monad testnet itself is on hold: items
that need it are UNTESTED, "awaiting testnet go".

Legend for the run columns: **R1** first full run, **R2** the re-run after
fixes.

## L. Landing page (`apps/landing`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| L1 | `/` loads | Renders hero, sections and footer; fonts load; no console error | not run | |
| L2 | "Get the app" | Opens the app URL configured in `NEXT_PUBLIC_APP_URL` | not run | |
| L3 | "Log in" / "Start accepting" | Open Polaris for Business `/login` | not run | |
| L4 | 375 px | No horizontal scroll; nav collapses; text readable | not run | |

## A. The Polaris app: screens (`apps/app`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| A1 | Not configured | Built without `NEXT_PUBLIC_POLARIS_API_URL`: a "not configured" screen, no balances or activity invented | not run | |
| A2 | `/onboard` | Continue with Face ID starts a WebAuthn create with PRF; email (Privy) shown only when configured | not run | |
| A3 | Home `/` | Balance read from the chain for the signed-in account; activity from the API; empty state for a new account | not run | |
| A4 | `/activity`, `/activity/[id]` | Lists real payments, plans, sends; a detail opens; unknown id shows "not found" | not run | |
| A5 | `/credit`, `/credit/score` | The on-chain credit line and its reasons; "Raise your limit" names a missing provider honestly | not run | |
| A6 | `/plans`, `/plans/[id]` | Open plans with the next instalment from the chain | not run | |
| A7 | `/pay`, `/pay/[id]` | A payment link's checkout: merchant, amount, Pay now / Pay in 4 / Subscribe as the link allows; unknown id → not found | not run | |
| A8 | `/send` | Amount entry, a link created, shareable; invalid amount refused | not run | |
| A9 | `/claim` | A send link claims to this account once; a second claim refused | not run | |
| A10 | `/split/new`, `/split/[id]` | Create a split; friends pay their share; hidden when PolarisSplit isn't deployed | not run | |
| A11 | `/receive` | The account's address and QR | not run | |
| A12 | `/add` | Adding dollars: the real route (faucet on the fork / instructions), no fake top-up | not run | |
| A13 | `/accounts`, `/cards`, `/insights`, `/notifications`, `/profile`, `/settings` | Each renders real data or an honest empty state; no dead buttons | not run | |
| A14 | Sheets (`@sheet/*`) | Each sheet opens over its screen and closes; deep link opens the full page | not run | |
| A15 | `/gallery` | Not reachable in a production build (development only) | not run | |
| A16 | 375 px, every screen | No overflow, tappable targets, safe areas | not run | |
| A17 | `/api/fx` | Chainlink rates read live (server-side), with age; a currency with no feed → no line | not run | |
| A18 | `/api/health` | Production build flags, chain 10143, API URL | not run | |
| A19 | `/.well-known/assetlinks.json` | Served as JSON with the configured fingerprint, or 404 when unset | not run | |

## F. The Polaris app: flows

| ID | Flow | Correct means | R1 | R2 |
|---|---|---|---|---|
| F1 | Face ID sign-up | One ceremony; Mera derives the account; reload and storage clear → same account from the passkey | not run | |
| F2 | Pay now from a link | One confirm; relayed `PolarisCheckout.pay` on the fork; buyer −amount, merchant +amount −0.5%; receipt shown; buyer holds 0 MON | not run | |
| F3 | Pay in 4 | Plan opens on chain against the credit line; merchant paid in full from the pool; 4 × instalments shown | not run | |
| F4 | Raise your limit | With no Nansen/Zerion key: says which provider isn't configured; never a line from invented data | not run | |
| F5 | Subscribe | First period charged on chain; cancel stops the next | not run | |
| F6 | Send by link → claim | Escrowed in PolarisSend; claim pays the recipient once; sender cancel works before claim | not run | |
| F7 | Split the bill | Organiser creates; a friend pays a share straight to the organiser; closing works | not run | |
| F8 | Sealed receipt | The server holds ciphertext only; the app opens it with the passkey's inbox key | not run | |
| F9 | Collections | A due instalment is collected on chain (CRE collections code, Chainlink's forwarder on the fork) | not run | |
| F10 | Lost approval → sign again | The buyer re-signs; the retry collects at once | not run | |
| F11 | Guardian pause | A raised threshold pauses new Pay in 4 ("Threshold raised for demo"); resumes after | not run | |
| F12 | Mid-flow interruption | Closing the checkout popup leaves no charge and a retryable session | not run | |
| F13 | API down | The app shows a retryable error, no fake success | not run | |
| F14 | Insufficient balance | Pay now refused before signing with a clear message | not run | |

## B. Polaris for Business (`apps/business`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| B1 | `/login` | Privy sign-in renders; unavailable state when Privy isn't configured | not run | |
| B2 | Sign-in (Privy email) | A real merchant signs in; embedded wallet created | not run | |
| B3 | Onboarding | Naming the business registers it on `MerchantRegistry` by its own signature, relayed | not run | |
| B4 | `/dashboard` overview | Real balance, payments, plans; empty states for a new merchant; no sample data in any build | not run | |
| B5 | `/dashboard/payments`, `/plans`, `/payouts` | Real rows from the store and chain sync (or the indexer when configured) | not run | |
| B6 | `/dashboard/links` | Create a link; it opens in the app's checkout; disable works | not run | |
| B7 | `/dashboard/developers` | Create and revoke API keys (secret shown once); add a webhook endpoint; test delivery; retry | not run | |
| B8 | Payouts | One-tap withdraw signed by the merchant's wallet and relayed; automatic payouts run | not run | |
| B9 | `/dashboard/chainlink` | CRE workflow status and the guardian from real runs; honest empty state before any | not run | |
| B10 | `/dashboard/settings` | Real merchant settings persist across reload | not run | |
| B11 | 375 px | Dashboard usable on a phone | not run | |

## P. API endpoints (`apps/business/src/app/api`)

| ID | Endpoint | Correct means | R1 | R2 |
|---|---|---|---|---|
| P1 | `GET /api/health`, `/api/health/ready` | Ready: config, chain, store on disk, workers; problems listed with `CRON_SECRET` | not run | |
| P2 | `GET /api/public/network` | Chain 10143 (fork), every contract equal to the deployment record, relayer available | not run | |
| P3 | `POST /api/relay` | Relays a valid signed intent; refuses a bad signature, a stranger origin (CORS), an over-limit gas | not run | |
| P4 | `POST /api/v1/checkout/sessions`, `GET …/[id]` | Secret key required; session created; publishable key can't create | not run | |
| P5 | `POST /api/v1/relay/payments` | The shop's publishable-key relay path works from the shop's origin only | not run | |
| P6 | `GET /api/public/sessions/[id]`, `/links/[id]/checkout`, `/merchants/[id]`, `/splits/[id]` | Real records; unknown id → 404 | not run | |
| P7 | `GET /api/public/buyers/[address]`, `/credit/[account]`, `/credit/[account]/messages`, `/credit-guard` | Real chain-derived data | not run | |
| P8 | `POST /api/receipts`, `/api/receipts/inbox` | Signed read returns ciphertext only; unsigned refused | not run | |
| P9 | `POST /api/credit/underwrite` | Fires the CRE underwriting trigger; without provider keys, an honest not-configured answer | not run | |
| P10 | `POST /api/cre/callback` | Refuses a bad HMAC | not run | |
| P11 | `GET /api/me`, `/api/overview`, `/api/payments`, `/api/plans`, `/api/payouts`, `/api/links`, `/api/keys`, `/api/webhooks` | 401 without a session; real data with one | not run | |
| P12 | `PUT /api/cron/tick` | 401 without `CRON_SECRET`; runs the loops with it | not run | |

## S. Halcyon, the demo shop (`apps/shop`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| S1 | `/`, `/shop`, `/products/[slug]`, unknown slug | Catalogue renders; unknown → the shop's 404 | not run | |
| S2 | Cart and checkout | Polaris checkout opens through the SDK; without Polaris config the shop says payments aren't configured | not run | |
| S3 | Order paid by webhook | The signed webhook marks the order paid; an unsigned POST is refused | not run | |
| S4 | `/orders/[id]` | Real order state and its log | not run | |
| S5 | 375 px | Usable on a phone | not run | |

## C. On chain (the fork)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| C1 | Deploy | `deploy:fork` with real AUSD; `check:deployment:fork` all pass | not run | |
| C2 | Money paths | `fork:smoke` 14 of 14 on real AUSD | not run | |
| C3 | Monad testnet | `check:deployment:monad` read-only 65 of 65; any testnet transaction: UNTESTED, awaiting testnet go | not run | |

## I. Integrations

| ID | Integration | Correct means | R1 | R2 |
|---|---|---|---|---|
| I1 | Mera (Face ID) | Real ceremony with PRF; account and receipt keys derived by Mera | not run | |
| I2 | Privy relayer | Server wallet policy refuses a disallowed call (testnet: awaiting go; local uses the local relayer) | not run | |
| I3 | Privy merchant login | Real email sign-in on the local origin | not run | |
| I4 | Chainlink CRE | `cre workflow simulate` of each workflow | not run | |
| I5 | Chainlink feeds | FX rates and AUSD/USD read live from Monad mainnet | not run | |
| I6 | Nansen | Live facts for a linked wallet | not run | |
| I7 | Zerion | Live balances and tenure | not run | |
| I8 | Etherscan | Live history signal (key present) | not run | |
| I9 | Envio | Indexer on the local chain feeds the dashboard, webhooks and CRE candidates | not run | |
| I10 | Agora AUSD | Real AUSD on the fork, faucet funding | not run | |

## Summary

| Run | PASS | FAIL | UNTESTED | Not run |
|---|---|---|---|---|
| R1 | | | | |
| R2 | | | | |
