# Polaris

**Stripe for every app on Monad.** One link to get paid now, later, or every
month.

- **The Polaris app** (buyers and senders): open a link, create an account with
  Face ID ([Mera](https://docs.monad.xyz/guides/mera) passkeys), and pay in
  dollars (AUSD). Pay in full, in four instalments against a credit line read
  from your on-chain history, or on a subscription, and send dollars across
  borders by link. No wallet, no gas, no seed phrase.
- **Polaris for Business** (merchants and platforms): payment links, a checkout
  API and SDK, a collections dashboard, webhooks, and one-tap or automatic
  payouts. Built on [Privy](https://privy.io).
- **The credit engine**: undercollateralized Pay in 4 on Monad at 10% APR (a
  $200 order is 4 × $50.38, nothing due at checkout). The merchant is paid in
  full up front. Credit is underwritten, instalments are collected (and
  retried the moment a buyer signs again), and new Pay in 4 plans are paused
  when Chainlink's AUSD/USD depegs or the pool runs short, by three
  [Chainlink CRE](https://docs.chain.link/cre) workflows, using
  [Nansen](https://nansen.ai) and Zerion wallet data, and indexed by
  [Envio](https://envio.dev).

Built for [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis),
Track 02: Consumer Products & Payments. The plan is in
[`docs/plan.md`](docs/plan.md).

> **Status (28 Sep 2026):** Polaris is live on **Monad testnet**. Every
> contract is deployed and wired, and read back on chain (65 of 65), and the
> smoke test ran Pay now and Pay in 4 through the API and the relayer. The
> CRE guardian's receiver was redeployed the same day with the review's
> fixes (still 65 of 65). The addresses are in
> [Monad testnet deployment](#monad-testnet-deployment). The dollar there is
> a clearly labelled **mock** (`MockAUSD`), because the deployer held no
> testnet AUSD. The whole product also runs end to end on a local chain with
> one command (`pnpm demo:local`, below). The Chainlink CRE workflows ran
> with the CRE CLI (`simulate --broadcast`) and delivered **three signed
> reports on Monad testnet**: an instant collection on an EVM log trigger, a
> scheduled collection, and a guardian attestation that reads Chainlink's
> AUSD/USD feed on Monad mainnet
> ([the runs](#cre-runs-on-monad-testnet-28-sep-2026)).

---

## Submission

The Metropolis submission kit is in [`docs/submission`](docs/submission):

| File | What it is |
|---|---|
| [`writeup.md`](docs/submission/writeup.md) | The write-up: the problem, the product, the first five minutes, how it works, what's new since the foundation import, and one heading per bounty with its requirement, where it is met (code and Monad testnet transactions) and what is not done yet |
| [`bounty-fields.md`](docs/submission/bounty-fields.md) | Ready-to-paste answers for each bounty's portal fields |
| [`video-script.md`](docs/submission/video-script.md) | The 3-minute demo: shot list, on-screen text, the command behind each scene |
| [`profile.md`](docs/submission/profile.md) | Name, one-liner, 50- and 150-word descriptions, track, bounties, tech stack, team |
| [`diffstat.txt`](docs/submission/diffstat.txt) | `git diff --stat` from the foundation import (`85b29e4`), by folder and in full (`pnpm docs:diffstat` regenerates it) |
| [`sources.md`](docs/submission/sources.md) | Where each requirement comes from, and what needs the logged-in portal to confirm |

`pnpm docs:check` ([`scripts/check-docs-links.mjs`](scripts/check-docs-links.mjs))
checks every link in this README and the kit, and every hash and address in
the kit against the committed deployment and CRE records.

---

## Run it

Node 22.6+ and pnpm 10.

```bash
pnpm install
pnpm demo:local
```

`pnpm demo:local` ([`scripts/demo-local.mjs`](scripts/demo-local.mjs)) starts
everything on this machine, with nothing live (no Privy login, no CRE login,
no public chain):

| What | Where | How it runs |
|---|---|---|
| A Hardhat node, chain 31337 | http://127.0.0.1:8545 | every contract deployed by `packages/contracts/scripts/deploy-monad.js` (MockAUSD, a funded credit pool, a local CRE forwarder) |
| Polaris for Business | http://localhost:3100 | the dev relayer adapter (a local key held to the production relayer policy), a fresh SQLite store, Halcyon's merchant seeded with test API keys and a webhook, registered on `MerchantRegistry` through the dashboard's registration API; the dashboard is signed in for Halcyon with a random local session |
| The CRE underwriting trigger | http://127.0.0.1:2000/trigger | `workflows` `trigger:local`: the real `polaris-underwrite` handler on the CRE SDK's test runtime, with fixture evidence |
| The Polaris app | http://localhost:3000 | the hosted checkout; the dev signer stands in for Face ID (badge on every screen) |
| Halcyon, the demo shop | http://127.0.0.1:3600 | `polarispay-sdk` against the real API and checkout (not its dev mock) |
| A faucet | http://127.0.0.1:3650/mint | test dollars; the app's **Add money** offers it on this chain |
| The CRE collections workflow | every minute, and on every `Reauthorized` | `workflows` `collections:local`: the real `polaris-collections` handler on the CRE SDK's test runtime, on both its triggers: the cron collects due Pay in 4 instalments through `CollectionsReceiver` (and dunns what fails), and the EVM log trigger on `PolarisCheckout.Reauthorized` collects a buyer the moment they sign again; it reports each run to the API (the dashboard's Collections card and Chainlink page, `installment.collected` webhooks) and logs to `.demo/logs/cre-collections.log` |
| The CRE guardian | every minute | `workflows` `guardian:local`: the real `polaris-guardian` handler, reading **Chainlink's AUSD/USD on Monad mainnet** (public RPC, reads only; `DEMO_GUARDIAN_PRICE=mock` for the labelled local mock) and the pool on the local chain, and attesting to `GuardianReceiver`, which `PolarisCheckout.openPlan` asks before every new plan; `.demo/logs/cre-guardian.log` |

Then: open the shop, add something to the bag, **check out with Polaris**. The
checkout opens in a popup (the app's `/pay/[id]` sheet). Pay now, or choose
Pay in 4: a new buyer has no line, so **Raise your limit** runs the CRE
underwriting workflow first. The shop's order is marked paid by the Polaris
webhook, and the merchant dashboard at http://localhost:3100/dashboard shows
the payment and the plan. Before it prints its URLs, `demo:local` opens every
page and API route once, so no first click waits for `next dev` to compile.
`DEMO_FAST_PLANS=1` makes Pay in 4 instalments a minute apart instead of a
week (and the loan engine's grace 15 minutes, so a missed payment is dunned before it is liquidated), so the collections run shows on camera (instalment 1 is collected about
two minutes after checkout; Pay in 4's 10% APR is pro-rated over those minutes, so the plan shows $0.00 interest). Ports move with `DEMO_NODE_PORT`,
`DEMO_BUSINESS_PORT`, `DEMO_APP_PORT`, `DEMO_SHOP_PORT`, `DEMO_TRIGGER_PORT`
and `DEMO_FAUCET_PORT`. Logs and state are in `.demo/`; `.demo/demo.json`
has every URL of the run.

`pnpm demo:e2e` ([`scripts/demo-e2e.cjs`](scripts/demo-e2e.cjs), needs
Playwright: `PLAYWRIGHT_MODULE=<path>`, and `CHROMIUM=<chrome.exe>` if its
browser build isn't installed) drives that run headless and writes the
screenshots in [`docs/demo`](docs/demo). It finds the run's URLs in
`.demo/demo.json` (or `APP`, `SHOP`, `BUSINESS`, `RPC` and `FAUCET`). The committed ones are from a run in
which all 24 steps passed (the `x-*` screens were captured right after, on the
same run):

| Step | Screenshot |
|---|---|
| A buyer account (dev signer), $1,000 from the local faucet, read from the chain | [`01-app-home-funded`](docs/demo/01-app-home-funded.png) |
| Halcyon → bag → checkout, Pay now | [`10-paynow-3-shop-checkout`](docs/demo/10-paynow-3-shop-checkout.png) |
| The Polaris checkout in the shop's popup, Face ID confirm | [`10-paynow-4-app-checkout-popup`](docs/demo/10-paynow-4-app-checkout-popup.png), [`10-paynow-5-app-confirm`](docs/demo/10-paynow-5-app-confirm.png) |
| The popup posts `completed` and closes; the webhook marks the order paid | [`10-paynow-7-shop-order-paid`](docs/demo/10-paynow-7-shop-order-paid.png) |
| Pay in 4: the checkout opens on Pay in 4; Raise your limit | [`20-payin4-4-app-checkout-popup`](docs/demo/20-payin4-4-app-checkout-popup.png), [`20-payin4-5-raise-your-limit`](docs/demo/20-payin4-5-raise-your-limit.png) |
| The CRE underwriting workflow opens a $1,000 line on chain, with its reasons (the linked account's history, the one from Nansen) | [`20-payin4-6-limit-raised`](docs/demo/20-payin4-6-limit-raised.png) |
| The popup's receipt stays up until the checkout closes itself | [`10-paynow-6-app-receipt`](docs/demo/10-paynow-6-app-receipt.png), [`20-payin4-8b-app-receipt`](docs/demo/20-payin4-8b-app-receipt.png) |
| A new buyer on a fresh phone: Pay in 4 → Raise your limit offers **Continue with Face ID**, and one tap creates the account and opens the line | [`25-newbuyer-5-raise-your-limit`](docs/demo/25-newbuyer-5-raise-your-limit.png), [`25-newbuyer-6-limit-raised`](docs/demo/25-newbuyer-6-limit-raised.png) |
| `DEMO_FAST_PLANS=1`: the CRE collections workflow collects the first instalment a minute after checkout | `.demo/logs/cre-collections.log`; the dashboard's Collections card in [`x-1280-dashboard-overview`](docs/demo/x-1280-dashboard-overview.png) |
| 4 × $87.92, nothing due today; confirm | [`20-payin4-7-app-checkout-with-line`](docs/demo/20-payin4-7-app-checkout-with-line.png), [`20-payin4-8-app-confirm`](docs/demo/20-payin4-8-app-confirm.png) |
| The shop's order, paid through a Polaris plan (`plan.opened` webhook) | [`20-payin4-9-shop-order-plan`](docs/demo/20-payin4-9-shop-order-plan.png) |
| Subscribe: the Coffee Club, monthly, in the Polaris popup; the first month charged on chain | [`50-subscribe-2-app-checkout-popup`](docs/demo/50-subscribe-2-app-checkout-popup.png), [`50-subscribe-4-shop-order`](docs/demo/50-subscribe-4-shop-order.png) |
| Pay directly with a wallet: `polarispay-sdk` `pay()`, one signature, relayed gas-free | [`60-wallet-1-shop-checkout`](docs/demo/60-wallet-1-shop-checkout.png), [`60-wallet-2-shop-order-paid`](docs/demo/60-wallet-2-shop-order-paid.png) |
| The buyer's app afterwards: balance, credit line, the plan | [`30-app-home-after`](docs/demo/30-app-home-after.png), [`31-app-credit-line`](docs/demo/31-app-credit-line.png), [`32-app-pay-in-4-plans`](docs/demo/32-app-pay-in-4-plans.png) |
| The dashboard: payments, Envio feed and credit reasons, the plan, registration | [`40-dashboard-overview`](docs/demo/40-dashboard-overview.png), [`41-dashboard-panels`](docs/demo/41-dashboard-panels.png), [`42-dashboard-payments`](docs/demo/42-dashboard-payments.png), [`43-dashboard-pay-in-4`](docs/demo/43-dashboard-pay-in-4.png), [`44-dashboard-settings-registered`](docs/demo/44-dashboard-settings-registered.png) |
| A dashboard payment link: paid, the receipt says **Done** and goes Home; the next visitor gets a fresh checkout | [`45-dashboard-share-link`](docs/demo/45-dashboard-share-link.png), [`46-link-3-app-receipt`](docs/demo/46-link-3-app-receipt.png), [`46-link-4-next-visitor`](docs/demo/46-link-4-next-visitor.png) |
| After the run: a send link from "Maya" (name asked once), claimed on a new phone, "Your link was claimed"; Home, Activity, Credit, the dashboard at 1280 and 390 | [`x-1440-send-confirm`](docs/demo/x-1440-send-confirm.png), [`x-1440-send-link-ready`](docs/demo/x-1440-send-link-ready.png), [`x-390-claim-open`](docs/demo/x-390-claim-open.png), [`x-1440-notifications`](docs/demo/x-1440-notifications.png), [`x-1440-home`](docs/demo/x-1440-home.png), [`x-1440-activity`](docs/demo/x-1440-activity.png), [`x-1440-credit-score`](docs/demo/x-1440-credit-score.png), [`x-1280-dashboard-overview`](docs/demo/x-1280-dashboard-overview.png), [`x-1280-dashboard-payments`](docs/demo/x-1280-dashboard-payments.png), [`x-390-dashboard-payments`](docs/demo/x-390-dashboard-payments.png), [`x-1280-landing`](docs/demo/x-1280-landing.png) |

### Each app on its own

[`.claude/launch.json`](.claude/launch.json) has all four dev servers:

| App | Command | Port |
|---|---|---|
| The Polaris app | `pnpm --filter @polaris/app dev` (`next dev -p 3000`) | 3000 |
| Polaris for Business | `pnpm --filter @polaris/business dev` | 3100 |
| The Polaris landing page | `pnpm --filter @polaris/landing dev` | 3200 |
| Halcyon, the demo shop | `pnpm --filter @polaris/shop dev` | 3600 |

On their own, without `NEXT_PUBLIC_POLARIS_API_URL`, the app is an offline
demo and says so on every screen ("Demo mode · sample data, nothing is on
chain"); the dashboard has a development-only sample session
(`POLARIS_DEV_MOCK_SESSION=1`); and the shop uses its own labelled dev mock of
the API. Each app's README lists its environment.

### Tests and builds

| Package | Command | Result on this branch |
|---|---|---|
| Contracts | `pnpm --filter @polarispay/contracts test` | 543 passing |
| `polarispay-sdk` | `pnpm --filter polarispay-sdk test`, `build` | 151 passing; ESM and CJS builds |
| Underwriting | `pnpm --filter @polarispay/underwriting test`, `typecheck`, `build` | 263 passing |
| Gateway | `pnpm --filter @polarispay/gateway test` | 7 passing |
| `@polaris/db` | `pnpm --filter @polaris/db test` | 29 passing |
| Indexer client | `pnpm --filter @polarispay/indexer-client test` | 56 passing |
| Envio indexer (the Windows-runnable part) | `node packages/indexer/scripts/generate.mjs --check`; `bun test test/lib.test.ts` in `packages/indexer` | config and schema in sync; 22 passing (codegen and the handler tests run in WSL or CI: `packages/indexer/scripts/wsl.sh test`) |
| CRE workflows | `pnpm --filter @polaris/cre-workflows test`, `typecheck`, `build` (WASM; needs the CRE CLI: `cre:install`, or `CRE_BIN`) | 209 passing; all three workflows compile to WASM |
| Polaris for Business | `pnpm --filter @polaris/business test`, `typecheck`, `lint`, `build` | 232 passing; the API auth check covers every route |
| The Polaris app | `pnpm --filter @polaris/app test`, `typecheck`, `lint`, `check:signatures`, `build` | 9 passing (the Chainlink states, a credit line's provenance, the dollar it signs for); 43 signature checks against the Solidity typehashes |
| Halcyon | `pnpm --filter @polaris/shop test`, `typecheck`, `lint`, `build` | 88 passing; the build proves no dev mock ships |
| Landing | `pnpm --filter @polaris/landing typecheck`, `build` | builds |
| Chainlink FX rates | `pnpm --filter @polaris/fx test`, `typecheck` (`check:live` reads every feed) | 46 passing |
| End to end | `DEMO_FAST_PLANS=1 pnpm demo:local` + `pnpm demo:e2e` | 24 of 24 steps (Pay now, Pay in 4 with CRE underwriting, a new buyer's one-tap line, a CRE collection, Subscribe, direct wallet pay, the dashboard, a dashboard payment link paid and reopened); [`docs/demo`](docs/demo) |
| | `DEMO_FAST_PLANS=1 pnpm demo:local` + `pnpm demo:e2e:chainlink` | 18 of 18 steps (FX in pesos, CRE underwriting with the line labelled a local run, the guardian pausing and resuming Pay in 4 from Chainlink AUSD/USD on Monad mainnet with Pay now still working, a dunned buyer collected by the log trigger 2 s after signing again, the Chainlink dashboard); [`docs/demo/chainlink`](docs/demo/chainlink/README.md) |
| | `pnpm --filter @polaris/business e2e:local` | 13 of 13 checks (SDK sessions, relayed Pay now and Pay in 4, verified webhooks, a collection) |
| | `pnpm --filter @polarispay/contracts e2e:local` | all twelve flows (the credit guard and `reauthorize` among them); the buyer, sender and freelancer never hold MON |
| | `pnpm --filter @polaris/cre-workflows e2e:local` | 12 passing (all three workflows and every trigger against real contracts on a local node) |
| Monad testnet | `pnpm --filter @polarispay/contracts check:deployment:monad` | 65 of 65 (every address has code, every role and threshold as recorded; read-only), after the guardian's redeploy |
| | `VERIFY_DRY_RUN=1 pnpm --filter @polarispay/contracts verify:monad` | 12 of 12 reproduced from source (PolarisCheckout from the deploy commit, rebuilt from git), ready for Monadscan once an Etherscan key is set |
| | `pnpm --filter @polaris/business smoke:testnet -- --run` | 10 of 10 (Pay now, Pay in 4, a re-signed approval, relayed on Monad testnet; [hashes](packages/contracts/deployments/monad-testnet.smoke.json)) |
| Lockfile | `pnpm install --frozen-lockfile` | passes |
| Docs | `pnpm docs:check`, `pnpm test:scripts` | every link in this README and [`docs/submission`](docs/submission) resolves, every hash in the kit is in the committed evidence; 9 passing |

---

## Components

| Path | What it is |
|---|---|
| [`apps/app`](apps/app/README.md) | **The Polaris app**: the buyer's installable PWA, phone and desktop layouts. Face ID accounts (Mera), the hosted checkout `/pay/[id]` (Pay now, Pay in 4, Subscribe), send by link, plans, the credit line and score. Reads the chain and the API (`src/lib/data/live.ts`); an offline demo without the API |
| [`apps/business`](apps/business/README.md) | **Polaris for Business**: the merchant landing, Privy sign-in, the dashboard (payments, links, Pay in 4 ledger, payouts, developers, settings), and the API: checkout sessions, the relayer (`/api/relay`), webhooks, payouts, merchant registration, CRE underwriting requests and callbacks, the buyer's book |
| [`apps/shop`](apps/shop/README.md) | **Halcyon**, a demo store paying through `polarispay-sdk`: Pay now, Pay in 4, a subscription and direct wallet payment, with signed webhooks |
| `apps/landing` | The Polaris landing page |
| [`apps/gateway`](apps/gateway/README.md) | The underwriting API (`/v1/underwrite`, `/v1/explain`) on port 3510 |
| [`packages/contracts`](packages/contracts/README.md) | Solidity: `PolarisCheckout` (Pay now, Pay in 4, Subscribe), `PolarisLoanEngine`, `ScoreManager`, `PolarisPayments`, `PolarisSend`, `MerchantRegistry`, `CollateralVault`, `BatchSettlement`, the CRE receivers; deploy, local end to end, ABIs |
| [`packages/sdk`](packages/sdk/README.md) | `polarispay-sdk` 0.3: server client (sessions, webhooks), the checkout popup and its v1 postMessage protocol, React components, Pay in 4 quotes on the engine's schedule |
| [`packages/underwriting`](packages/underwriting/README.md) | Nansen-powered underwriting: provider clients, the Facts the DON attests, the thin-file gate (the contract's), the score, the Pay in 4 decision and plain-language reasons |
| [`packages/indexer`](packages/indexer/README.md) | The Envio HyperIndex indexer for every Polaris event, with a webhook outbox |
| `packages/indexer/client` | `@polarispay/indexer-client`: typed queries the dashboard, the CRE collections workflow and webhooks use |
| `packages/db` | Polaris for Business storage (SQLite or memory), API keys, webhook signing |
| [`packages/fx`](packages/fx/README.md) | Chainlink FX rates for the local-currency line: the verified feed table (Monad mainnet, Ethereum, Polygon, Base), a cached viem reader, the display formatting |
| [`packages/ui`](packages/ui/README.md) | The shared component library both web apps are built from (`/gallery` in each) |
| `packages/brand` | The Polaris mark and wordmark |
| `packages/keeperhub` | The dunning ladder the collections path uses |
| [`workflows`](workflows/README.md) | The Chainlink CRE workflows: `polaris-underwrite` (HTTP trigger), `polaris-collections` (cron and an EVM log trigger), `polaris-guardian` (cron, reading Chainlink AUSD/USD on Monad mainnet); and their local runners `trigger:local`, `collections:local`, `guardian:local` |
| `scripts` | `demo-local.mjs` (`pnpm demo:local`), `demo-e2e.cjs` (`pnpm demo:e2e`), `demo-chainlink.mjs` (the Chainlink scenes on a running demo), `demo-e2e-chainlink.cjs` (`pnpm demo:e2e:chainlink`), `check-docs-links.mjs` (`pnpm docs:check`), `submission-diffstat.mjs` (`pnpm docs:diffstat`), the Lottie generators |
| `docs` | [`plan.md`](docs/plan.md), the design contract (`design/system.md`), research, [`demo`](docs/demo), the [submission kit](docs/submission) |

---

## Monad testnet deployment

Deployed on 28 Sep 2026 by `pnpm --filter @polarispay/contracts deploy:monad`
from `0x6Df4a0b84BD608123D1f3412709AcaC69523c115` (34 transactions, 2.94 MON),
from commit `020484b`. The same day `redeploy-guardian:monad` replaced
GuardianReceiver alone with the review's fixes (2 transactions, 0.353 MON):
the receiver now reads the pool itself and trusts the CRE report for the
mainnet price only ([Chainlink CRE](#chainlink-cre-an-orchestration-layer)).
The one it replaced, `0xF825…26D8`, stays on chain with no rounds, and
nothing asks it. The files behind it:

- the record:
  [`packages/contracts/deployments/monad-testnet.json`](packages/contracts/deployments/monad-testnet.json)
- the script's output:
  [`monad-testnet.deploy.txt`](packages/contracts/deployments/monad-testnet.deploy.txt)
- every transaction, decoded:
  [`monad-testnet.transactions.json`](packages/contracts/deployments/monad-testnet.transactions.json)
- the guardian's redeploy:
  [`monad-testnet.redeploy-guardian.txt`](packages/contracts/deployments/monad-testnet.redeploy-guardian.txt)
  (and `redeploys` in the record)
- the read-back after it, 65 of 65 checks:
  [`monad-testnet.check.txt`](packages/contracts/deployments/monad-testnet.check.txt)

Chain 10143; explorer [testnet.monadscan.com](https://testnet.monadscan.com).

| Contract | Address | Deployed in |
|---|---|---|
| Stablecoin: **MockAUSD**, a mock dollar for the testnet demo, labelled "Mock AUSD" (anyone can mint it; the deployer held no testnet AUSD, decision 24) | [`0x3F9554F15f58Bb5900822224f37A05be81eF9723`](https://testnet.monadscan.com/address/0x3F9554F15f58Bb5900822224f37A05be81eF9723) | [`0x117e473e…`](https://testnet.monadscan.com/tx/0x117e473ec59c69168cbd4a3901e140ee2af3d8e4593ca5af2e46b69866367239) |
| ScoreManager | [`0xB3D34eF62Cb64b985C230079D2815787619E6061`](https://testnet.monadscan.com/address/0xB3D34eF62Cb64b985C230079D2815787619E6061) | [`0xef12c071…`](https://testnet.monadscan.com/tx/0xef12c0718ccb1fb7f2552d143e8de507f568a4646627c892caeff017be70854c) |
| PolarisLoanEngine (the credit pool: 10,000 mock dollars) | [`0xDaf74fa6A5cF2e03DF8E12613a8c8BF3A569204a`](https://testnet.monadscan.com/address/0xDaf74fa6A5cF2e03DF8E12613a8c8BF3A569204a) | [`0xe8c4f3bf…`](https://testnet.monadscan.com/tx/0xe8c4f3bf90429faea48931eb0b5c2da008bc691ebe0f9921b865f654d56a374f) |
| PolarisPayments | [`0x7C774CF3E664B10057Cb2dDa66bA298e831292F1`](https://testnet.monadscan.com/address/0x7C774CF3E664B10057Cb2dDa66bA298e831292F1) | [`0x056b4738…`](https://testnet.monadscan.com/tx/0x056b47385754c208dc2d696b9ce4b8fe7c2090dc844c3bc75b8dde194609e18e) |
| MerchantRegistry | [`0x40A351282C9843C49f5Dd788d730a3d9Fe7627B4`](https://testnet.monadscan.com/address/0x40A351282C9843C49f5Dd788d730a3d9Fe7627B4) | [`0x50637e33…`](https://testnet.monadscan.com/tx/0x50637e33dde8b8ba6401ac9c9a0dc1714d0ba0c1e649dc381d18ecabb9c636fa) |
| CollateralVault | [`0xD0e777f8DfA2E62F500054E85F815fC54fae3E72`](https://testnet.monadscan.com/address/0xD0e777f8DfA2E62F500054E85F815fC54fae3E72) | [`0xcbd8ef90…`](https://testnet.monadscan.com/tx/0xcbd8ef906cbdc850f01c534c8610b5dbc29ac63ed84a054ab408a78423a70fb9) |
| BatchSettlement | [`0x4F9478C66a82cEb1e1F8fE0117849e3F330cfc53`](https://testnet.monadscan.com/address/0x4F9478C66a82cEb1e1F8fE0117849e3F330cfc53) | [`0x28d8c131…`](https://testnet.monadscan.com/tx/0x28d8c131cc2b7bb3fe9aa5805e5e9af32274ba17fb04302752a8dbea7f81d083) |
| PolarisSend | [`0x67D336c69881A4f3Fa4aaa2909cfcD95178DfC55`](https://testnet.monadscan.com/address/0x67D336c69881A4f3Fa4aaa2909cfcD95178DfC55) | [`0x9f81549c…`](https://testnet.monadscan.com/tx/0x9f81549cd07cf46f018c77f175f596ab7cf535f484f87bf6079ce57fb84924b9) |
| PolarisCheckout | [`0x3874ef1bcE222755525a96f8284631780b9bC70B`](https://testnet.monadscan.com/address/0x3874ef1bcE222755525a96f8284631780b9bC70B) | [`0x5df03907…`](https://testnet.monadscan.com/tx/0x5df039074ed9a5b6e11c517955b42393a430d369a12c554096316a1d64dc020c) |
| CollectionsReceiver (CRE) | [`0x4201C0837f3bB4e0E1A982C5666BF00b5EE145CC`](https://testnet.monadscan.com/address/0x4201C0837f3bB4e0E1A982C5666BF00b5EE145CC) | [`0x0ac454dd…`](https://testnet.monadscan.com/tx/0x0ac454dd6f28fea4ef998bbf63f0cc72e9d84ecc4cf725b8077dd3cf04bcc379) |
| UnderwritingReceiver (CRE) | [`0x523e9791d0e324525F66F91b21B478C18e284a19`](https://testnet.monadscan.com/address/0x523e9791d0e324525F66F91b21B478C18e284a19) | [`0xf643b392…`](https://testnet.monadscan.com/tx/0xf643b392792f7f2a0c07edbf8e91a469e463fd065a9ef5d40b8bc59862f64c4a) |
| GuardianReceiver (CRE), redeployed with the review's fixes; PolarisCheckout asks it ([`setCreditGuardian` `0xecceaa2a…`](https://testnet.monadscan.com/tx/0xecceaa2ad1f0620c809ec2948cf91e146d75d0875d43b3fbfff72ff4e0ac2d5c)) | [`0x4c99136634F670cd59E73fc284fED164C662e3Df`](https://testnet.monadscan.com/address/0x4c99136634F670cd59E73fc284fED164C662e3Df) | [`0x2be128a3…`](https://testnet.monadscan.com/tx/0x2be128a399ed2034f2fffe8caba46519bc5c6f116625b9cff364977ad27038bf) |

| Also on Monad testnet | Address |
|---|---|
| Chainlink's simulation forwarder, which the receivers trust | [`0xB9F79d863261869B234c481D1f9A7af84AeAd192`](https://testnet.monadscan.com/address/0xB9F79d863261869B234c481D1f9A7af84AeAd192) |
| CRE simulation transmitter (`CRE_ETH_PRIVATE_KEY`, 1 MON) | [`0xBBb420B7e4b0263d053e00bFD363eD7cF21e2EA6`](https://testnet.monadscan.com/address/0xBBb420B7e4b0263d053e00bFD363eD7cF21e2EA6) |
| Dev relayer (the Privy server wallet's stand-in; PolarisPayments and MerchantRegistry operator, BatchSettlement settler) | [`0x5e6934725eBCdfcA2d95D991045Fa813B51E2c69`](https://testnet.monadscan.com/address/0x5e6934725eBCdfcA2d95D991045Fa813B51E2c69) |
| Demo merchant "Polaris Demo Studio" (registered by its own signature, active, $1,000 cap; subscription plans #1 and #2) | [`0xA2672c1BaD9aAa4F1408929C677d58EC0E1aC185`](https://testnet.monadscan.com/address/0xA2672c1BaD9aAa4F1408929C677d58EC0E1aC185) |

**The smoke test** (`pnpm --filter @polaris/business smoke:testnet -- --run`,
10 of 10, every hash in
[`monad-testnet.smoke.json`](packages/contracts/deployments/monad-testnet.smoke.json)):
Polaris for Business ran against this deployment with the dev relayer, and a
fresh buyer signed each step:

- **Pay now** $25: [`0x5d533afe…`](https://testnet.monadscan.com/tx/0x5d533afe3cf9b27adcb7063226baf69925b8834eb7ac32612029212c74e925c2),
  followed by a `payment.succeeded` webhook verified with polarispay-sdk.
- **Pay in 4** $200: [`0x4af42348…`](https://testnet.monadscan.com/tx/0x4af4234818aec669b3974c5c44f0f5cbe900858aa6e1e76bb413720374d2522d),
  plan #1, followed by a `plan.opened` webhook.
- A lost approval **signed again**: [`0xf02c45bd…`](https://testnet.monadscan.com/tx/0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002),
  which emitted `Reauthorized`.

The buyer's Pay in 4 line is secured: the buyer locked $202 in
CollateralVault itself. An unsecured line needs a CRE underwriting report,
which needs provider keys (the workflow runs, and without keys it returns
`incomplete` rather than guess). Apart from those two calls and one approval,
the buyer sent nothing: every Polaris step was a signature the dev relayer
carried.

The SDK presets (`packages/sdk/src/deployments.ts`), the indexer
(`packages/indexer/config.yaml`, from block 66288120), the CRE staging configs
and the apps' `.env.example` files carry these addresses; tests hold each of
them to the record. The guardian's redeploy moved only GuardianReceiver, which
only the record, PolarisCheckout and the guardian's staging config name.

PolarisCheckout on testnet is the deploy commit's: the review's two
`reauthorize` fixes are in the code and its tests, not on chain (a redeploy
would move every address the apps, the indexer and the workflows use, and
the deployer's MON went to the guardian first). `verify:monad` verifies the
deployed one from the deploy commit's sources, rebuilt from git and checked
against the chain.

---

## Bounty evidence

What each sponsor asks for, where this repository meets it, and how to check.
"Local" means the `pnpm demo:local` chain; "testnet" means the
[Monad testnet deployment](#monad-testnet-deployment).

### Monad (Track 02: consumer products and payments)

| Requirement | Where | Verify |
|---|---|---|
| A consumer payments product on Monad | Pay by link, Pay now, Pay in 4, subscriptions, send by link, payouts: `packages/contracts/contracts/PolarisCheckout.sol`, `PolarisSend.sol`, `apps/app`, `apps/business` | `pnpm demo:local`, `docs/demo` |
| Gasless for the user | Every buyer action is an EIP-712 / ERC-3009 signature relayed by `apps/business` `POST /api/relay`; the buyer holds no MON | `pnpm --filter @polarispay/contracts e2e:local` (buyer, sender and freelancer end with 0 MON) |
| Contract addresses on a Monad network | Monad testnet, 28 Sep 2026: [every address and transaction](#monad-testnet-deployment) (`deploy:monad` refuses mainnet) | `pnpm --filter @polarispay/contracts check:deployment:monad` (65 of 65); `pnpm --filter @polaris/business smoke:testnet -- --run` (10 of 10) |

### Agora: AUSD cross-border payments

| Requirement | Where | Verify |
|---|---|---|
| Users send AUSD across borders | `PolarisSend` escrows AUSD by ERC-3009 against a link key; the app's Send and Claim (`apps/app/src/sheets/send.tsx`, `claim.tsx`); AUSD's own EIP-712 domain (`Agora Dollar`, `1`) | contracts `e2e:local` steps 8-9; `apps/app` `check:signatures` |
| Real balances and activity | `apps/app/src/lib/data/live.ts`: `AUSD.balanceOf`, the API's record of chain events; the offline demo is labelled on every screen and never links a made-up hash | `docs/demo/01-app-home-funded.png`, `30-app-home-after.png` |
| Local currency | Shown next to dollars at the live **Chainlink** rate, with its age ("≈ ARS 161.241 · Chainlink rate, 3 min ago · indicative"): `packages/fx` reads Chainlink Data Feeds server-side (EUR, GBP, JPY, CHF, CAD from Monad mainnet; 18 more from Ethereum, Polygon, Base), served by the app's `/api/fx`; no line for the 10 currencies without a feed, or when the rate is older than its own feed allows (twice its heartbeat, or heartbeat plus 10 min: 14 min for Monad's feeds, 26 h at most), in which case the next feed is read | `pnpm --filter @polaris/fx test`; `pnpm --filter @polaris/fx check:live`; `docs/design/fx/` |
| A mobile app | An installable PWA; no Android wrapper (TWA) yet | ask Agora whether a PWA qualifies |

### Mera: the entire account layer

| Requirement | Where | Verify |
|---|---|---|
| Passkey accounts, no seed phrase, no extension, no custody | `apps/app/src/lib/account/mera.ts` (`createPasskeyWithPrfOutput`, `createSecp256k1SigningSession`), key derived in the browser and zeroed (`derive.ts`); the relayer never holds user funds | `apps/app/README.md` "Accounts" |
| Nothing else stands in for it | The dev signer only exists in `next dev` with `NEXT_PUBLIC_DEV_SIGNER=1` (a production build blanks the flag, `apps/app/next.config.ts`) and refuses the production domain. The app also offers **Continue with email** (a Privy embedded wallet) beneath Face ID | ask Mera whether the email option is acceptable, or drop it |

### Privy: beyond authentication

| Requirement | Where | Verify |
|---|---|---|
| Embedded wallets doing real work | The merchant's embedded wallet signs its `MerchantRegistry` registration right after the business is named (`useRegisterMerchant`, `apps/business/src/app/(privy)/login/login-view.tsx`, `components/dashboard/registration.tsx`) and its withdrawals (`useWithdraw`) | `docs/demo/44-dashboard-settings-registered.png` (the same API, signed by the local session's wallet) |
| Policy-controlled server wallets | The relayer is a Privy server wallet (`src/server/relayer/signer.ts`) held to a policy (`src/server/policy/relayer.ts`: deny MON, allow each Polaris function, $0.10 floor); automatic payouts via `addSigners` with a per-merchant policy (`src/server/policy/payout.ts`) | `pnpm --filter @polaris/business test` (policy tests); `privy:prove-policy -- --run` and `privy:smoke -- --run` need your Privy app |
| Shown live | *Not yet*: every run here used `RELAYER_MODE=local` with Privy off | [What only you can do](#what-only-you-can-do), step 4 |

### Chainlink CRE: an orchestration layer

Three CRE workflows (`@chainlink/cre-sdk` 1.22.0, CLI v1.35.0) run Polaris's
credit. Between them they use all three trigger types (HTTP, cron and EVM
log). Each run that has work to do ends in a signed report that Chainlink's
forwarder delivers to a Polaris receiver on Monad (an idle, thin or unchanged
run writes nothing), and every report changes what the product does next:
whether a buyer gets a line, whether an instalment is collected, and whether
a new Pay in 4 plan can open. The full reference is
[`workflows/README.md`](workflows/README.md).

| Workflow | What it orchestrates | Trigger | CRE capabilities used | Code | Receiver on Monad testnet |
|---|---|---|---|---|---|
| `polaris-underwrite` | A buyer's credit line. The API fires it when the buyer taps **Raise your limit**. It checks the buyer's consent and history-wallet proof, gathers wallet facts (Nansen, Zerion, Etherscan, public RPCs), and refuses thin files. It attests the facts, and `ScoreManager` scores them on chain. Unsecured lines open only from these reports (`requireUnderwriting`). | **HTTP** | HTTP trigger; HTTP client with consensus; **Confidential HTTP** (a switch; implemented and unit-tested, not yet run against the real capability); EVM read (`profileOf`, `linkedUserOf`, `balanceOf`); signed report → EVM write | `workflows/src/underwriting/`, `workflows/underwriting/main.ts` | `UnderwritingReceiver` [`0x523e…4a19`](https://testnet.monadscan.com/address/0x523e9791d0e324525F66F91b21B478C18e284a19) |
| `polaris-collections` | Every due Pay in 4 instalment and subscription renewal, plus liquidation past grace. It finds candidates (Envio, or the chain), checks each with `checkTasks`, and backs off along the dunning ladder. Failures are reported to the API through a signed callback. On testnet as committed: candidates from the chain, callback off (`evidence --callback <url>` turns it on for a run). | **Cron** (every minute in staging, daily in production) | Cron trigger; EVM read; HTTP (Envio and the callback, when configured); signed report → EVM write | `workflows/src/collections/workflow.ts`, `tasks.ts`, `backoff.ts` | `CollectionsReceiver` [`0x4201…45CC`](https://testnet.monadscan.com/address/0x4201C0837f3bB4e0E1A982C5666BF00b5EE145CC) |
| `polaris-collections` (instant retry) | A buyer whose approval was lost signs once (`PolarisCheckout.reauthorize`, relayed). The `Reauthorized` log starts a run that collects what that buyer owes (`dueTasksFor`) in the next block, without waiting for the 6-hour rung. | **EVM log** on `PolarisCheckout.Reauthorized` (finalized) | Log trigger; EVM read; signed report → EVM write | `workflows/src/collections/retry.ts`, `PolarisCheckout.reauthorize` | the same `CollectionsReceiver` |
| `polaris-guardian` | The risk guard. It brings **Chainlink AUSD/USD from Monad mainnet** to the pool on Monad testnet, in one run. Its verdict is a depeg (outside $0.995 to $1.005), low free cash (< $1,000), bad debt (> 5%, once $10,000 is lent) or a stale price (> 2 h). `GuardianReceiver` checks the verdict against the thresholds and trusts the DON for the mainnet price only: it reads the pool's cash and bad debt itself on every call, and refuses a report whose pool is not the chain's. `PolarisCheckout.openPlan` refuses new Pay in 4 plans while it says paused; Pay now, Send and Subscribe never ask. A stale price fails open; the pool's checks never do. | **Cron** (every minute in staging, every 10 min in production) | Cron trigger; EVM reads on **two chains** (mainnet feed, testnet pool at one finalized block); signed report → EVM write | `workflows/src/guardian/`, `workflows/guardian/main.ts` | `GuardianReceiver` [`0x4c99…e3Df`](https://testnet.monadscan.com/address/0x4c99136634F670cd59E73fc284fED164C662e3Df) |

Two related pieces use Chainlink but are not CRE workflows:

- **The pool health feed.** `GuardianReceiver` is also an
  `AggregatorV3Interface`. It is labelled "Polaris pool health, computed by
  CRE". It is not a Chainlink feed and not Proof of Reserve.
- **Local currency.** `packages/fx` reads Chainlink FX Data Feeds server-side
  (it does not use CRE); see the Agora table above.

#### On Monad testnet (chain 10143)

The receivers are deployed and wired, and the smoke test drove real
transactions through the checkout that asks them (see
[Monad testnet deployment](#monad-testnet-deployment)); no CRE report has
reached them yet. `pnpm --filter @polarispay/contracts check:deployment:monad`
reads all of it back (65 of 65, after the guardian's redeploy:
[`monad-testnet.check.txt`](packages/contracts/deployments/monad-testnet.check.txt)).

| What | Address or transaction |
|---|---|
| Chainlink simulation forwarder (`cre workflow simulate --broadcast`) | [`0xB9F79d863261869B234c481D1f9A7af84AeAd192`](https://testnet.monadscan.com/address/0xB9F79d863261869B234c481D1f9A7af84AeAd192) (Chainlink's `MockKeystoneForwarder`) |
| Chainlink production forwarder (deployed workflows, not used yet) | [`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`](https://testnet.monadscan.com/address/0xF8344CFd5c43616a4366C34E3EEE75af79a74482) |
| Chainlink AUSD/USD, **Monad mainnet** (143), read by the guardian | [`0xE20751C7B5867bCBef815ffc1b284c3f412a9e13`](https://monadscan.com/address/0xE20751C7B5867bCBef815ffc1b284c3f412a9e13) ("AUSD / USD", 8 decimals; 0.99982777 at 02:17:49 UTC, 28 Sep 2026) |
| The simulation transmitter: the one origin each receiver accepts behind the public forwarder (a dedicated key, never the deployer) | [`0xBBb420B7e4b0263d053e00bFD363eD7cF21e2EA6`](https://testnet.monadscan.com/address/0xBBb420B7e4b0263d053e00bFD363eD7cF21e2EA6), funded with 1 testnet MON: [`0x0497a290…`](https://testnet.monadscan.com/tx/0x0497a2903d8730c2990e1d7384ca62c39a61a4f99b33e3e91dc29650417818d1) |
| `CollectionsReceiver` deployed | [`0x0ac454dd…`](https://testnet.monadscan.com/tx/0x0ac454dd6f28fea4ef998bbf63f0cc72e9d84ecc4cf725b8077dd3cf04bcc379) (block 66288157) |
| `UnderwritingReceiver` deployed; made `ScoreManager`'s only underwriter | [`0xf643b392…`](https://testnet.monadscan.com/tx/0xf643b392792f7f2a0c07edbf8e91a469e463fd065a9ef5d40b8bc59862f64c4a); [`setUnderwriter` `0xe1b8cd62…`](https://testnet.monadscan.com/tx/0xe1b8cd6239b37762715285fde08a0ca771815af2ea8e9250ab44ebaa1b02cfcd) |
| `GuardianReceiver` redeployed with the review's fixes (reads the pool live; $0.995 to $1.005; bad debt from $10,000 lent, acknowledgeable; a forced resume ends); made `PolarisCheckout`'s credit guard | [`0x2be128a3…`](https://testnet.monadscan.com/tx/0x2be128a399ed2034f2fffe8caba46519bc5c6f116625b9cff364977ad27038bf) (block 66309279); [`setCreditGuardian` `0xecceaa2a…`](https://testnet.monadscan.com/tx/0xecceaa2ad1f0620c809ec2948cf91e146d75d0875d43b3fbfff72ff4e0ac2d5c) |
| The first `GuardianReceiver`, replaced (no round was ever written to it) | [`0xe717c54d…`](https://testnet.monadscan.com/tx/0xe717c54d4ce41e4164ded7ddbb31e65a40c666ec94b4d056842d2dd0f35f2369); its [`setCreditGuardian` `0x324d2028…`](https://testnet.monadscan.com/tx/0x324d202836ef5acfaa012eb79c60353e9b6e95066fd9ebb4a7357c19db272664) |
| A Pay in 4 plan opened, with the guardian asked first (no attestation yet, so it failed open by design) | [`0x4af42348…`](https://testnet.monadscan.com/tx/0x4af4234818aec669b3974c5c44f0f5cbe900858aa6e1e76bb413720374d2522d) (plan #1, 4 × $50.00, 60 s apart) |
| A real `Reauthorized` log, the instant retry's trigger input (log 1 of the receipt) | [`0xf02c45bd…`](https://testnet.monadscan.com/tx/0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002) |
| The workflows' staging configs, filled from the deployment | `workflows/{collections,underwriting,guardian}/config.staging.json` (`configure staging`; a test holds them to the record) |

#### CRE runs on Monad testnet (28 Sep 2026)

Each row is one `cre workflow simulate --broadcast` run with the CRE CLI
v1.35.0, logged in as the team's CRE organisation (deploy access is not
enabled yet, so these are simulations, which the bounty accepts). For each
run, the CLI compiled the workflow to WASM, ran it, and sent its signed report
to Monad testnet through Chainlink's forwarder for `monad-testnet`,
`0xB9F79d863261869B234c481D1f9A7af84AeAd192`. `cre workflow supported-chains`
lists that forwarder
([`supported-chains.txt`](workflows/evidence/2026-09-28/supported-chains.txt)).
Every transaction was read back from Monad testnet with status 1, and
"Delivered" is the forwarder's `ReportProcessed` result for the receiver.

| Workflow and trigger | What it orchestrated | Monad testnet transaction | Block | Delivered |
|---|---|---|---:|---|
| `polaris-collections`, **EVM log trigger** on `PolarisCheckout.Reauthorized` | A buyer re-signed ([`0xf02c45bd…`](https://testnet.monadscan.com/tx/0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002)). The workflow read what the buyer owed, signed a report, and `CollectionsReceiver` collected instalment #1 | [`0x1116fbb4…292c4d`](https://testnet.monadscan.com/tx/0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d) | 66359311 | `result=true` |
| `polaris-collections`, **cron trigger** | Found due and overdue plans on chain: collected one instalment and liquidated a plan past its grace period | [`0xd7bcf41e…1a97e4`](https://testnet.monadscan.com/tx/0xd7bcf41e8efa7841c86870689a3c9599c3a960d39f4c28b82c6980dc1f1a97e4) | 66359350 | `result=true` |
| `polaris-guardian`, **cron trigger** | Read **Chainlink AUSD/USD on Monad mainnet** (`0xE20751C7B5867bCBef815ffc1b284c3f412a9e13`: 0.99982194), read the pool on testnet, and attested "healthy, Pay in 4 open" as `GuardianReceiver` round 1 | [`0x015bd95d…3f9080`](https://testnet.monadscan.com/tx/0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080) | 66359401 | `result=true` |
| `polaris-underwrite`, **HTTP trigger** | Ran and correctly wrote nothing. With no provider keys, Zerion and Etherscan answered "unauthorized", so it could not confirm the account's first-seen date and sent count, and returned `incomplete` instead of guessing | none (by design) | | |

The logs of all six runs, the table and `runs.json` are in
[`workflows/evidence/2026-09-28/`](workflows/evidence/2026-09-28/). The first
two underwriting runs stopped before running. They exposed two bugs that the
real CLI and runtime catch and the unit tests could not, both now fixed and
tested:
- The evidence script passed a 100-character `--config` path; the CLI's
  limit is 97 (`cliConfigArg`).
- zod's `.url()` needs the `URL` constructor, which the CRE WASM runtime does
  not have, so every URL in a config failed validation (`httpUrl`).

An underwriting report (and the first live Confidential HTTP call) needs a
free Etherscan API key and a consenting history wallet (see
[What only you can do](#what-only-you-can-do)). To run everything again from
this checkout: `pnpm --filter @polaris/cre-workflows evidence`, adding
`--retry-tx <a Reauthorized transaction>` for the log trigger.

#### The guardian's feed-shaped view

`GuardianReceiver` serves the guardian's verdict as a feed any contract can
read, labelled `description() = "Polaris pool health, computed by CRE"`
(8 decimals, `version() = 1`):

- `latestRoundData()` returns one round per attestation. `answer` is the
  pool's free cash when the report landed (read from the pool, not from the
  report) in dollars at the attested AUSD/USD price, and 0 while paused.
  `startedAt` and `updatedAt` are when the workflow observed it.
  Before the first attestation it returns all zeros, like a new Chainlink
  aggregator.
- `getRoundData(id)` reads past rounds. `isCreditPaused()`, `creditStatus()`
  and `latestAttestation()` give the verdict and its reasons (depeg 1, low
  cash 2, bad debt 4, stale price 8, owner pause 128), `creditStatus()` with
  the pool's reasons and the price's apart. `currentInputs()` is the
  workflow's own read of the pool, the thresholds and the acknowledged bad
  debt.
- On Monad testnet now: `latestRound() = 0` (no CRE run yet), so the price
  fails open, and the pool, read live, passes: free cash $9,800, owed
  $200.000152, no bad debt, $200 lent (under the $10,000 floor). So
  `creditPaused() = (false, 0)`. Thresholds $0.995 to $1.005 / $1,000 /
  500 bps from $10,000 lent / 7,200 s.

#### Confidential HTTP: what it buys and what it costs

**Status: implemented and unit-tested; not yet exercised against the real
capability.** Every call so far ran on the SDK's test runtime with its mocks
and the underwriting package's synthesized fixtures. The first real one is a
CLI run with a provider key (a free Etherscan key is enough): `evidence --only
underwriting` keeps its log.

With `confidentialHttp: true` (staging and local), the paid provider calls
(Nansen, Zerion, Etherscan) go through CRE's Confidential HTTP. The
workflow sends `{{.NANSEN_API_KEY}}`-style placeholders, and the enclave
fills them from the Vault DON, so no node ever holds a provider key. Each
provider is also called once instead of once per node, which Nansen's
10 free credits a day can afford. **The trade-off:** the DON trusts one
enclave's answer. With the switch off, every node calls the provider and the
report carries the median, so one bad response is outvoted. With it on, the
facts are only as good as the one response the enclave got. Production keeps
it off until a deployed run shows Monad's DON serves the capability. Public
RPC calls always stay on the plain HTTP client. Details, including Zerion's
Basic header and Etherscan's POST body:
[`workflows/README.md`](workflows/README.md#confidential-http).

#### Simulated versus deployed, exactly

| | Status |
|---|---|
| The Polaris contracts, including the three CRE receivers | **Deployed on Monad testnet** (28 Sep 2026), every role read back on chain; GuardianReceiver redeployed the same day with the review's fixes. PolarisCheckout's `reauthorize` fixes are in code only (not redeployed) |
| The three workflows | **Built** (WASM, CLI v1.35.0) and **tested**: 209 unit tests on the SDK's test runtime, and `e2e:local` 12 of 12 against real contracts on a local node. **Run by the CLI on Monad testnet** (`simulate --broadcast`, 28 Sep 2026): collections on both triggers and the guardian delivered reports; underwriting ran and returned `incomplete` without provider keys ([the runs](#cre-runs-on-monad-testnet-28-sep-2026)). **Not deployed to a DON**: that needs deploy access (`cre account access`) |
| Where a simulated run's report goes | A real Monad testnet transaction: the CLI signs with the transmitter key and calls Chainlink's `MockKeystoneForwarder`. It carries no DON signatures, so each receiver accepts it only from that transmitter (`tx.origin`) |
| After a DON deploy | `deploy:monad` with `CRE_FORWARDER=production`, or the owner moves the receivers to the production forwarder. Then `lock-receivers:monad` pins the workflow owner, names and ids and clears the simulation transmitter; it refuses Chainlink's MockKeystoneForwarder (or anything that is not Chainlink's KeystoneForwarder) as the production one. Not done: there is no deployment to lock to |
| "Verified by Chainlink CRE" on a credit line | Only for a report delivered through Chainlink's KeystoneForwarder (DON-signed). A simulated run's report reads "Chainlink CRE (simulated)", a local one "CRE workflow, local run" (`apps/business` `src/server/cre/provenance.ts`) |
| AUSD/USD | **Real**: Chainlink's feed on Monad mainnet, read only; nothing writes to mainnet |
| The dollar on testnet | **Mock**: `MockAUSD` ("Mock AUSD"), because the deployer held no testnet AUSD for the pool (decision 24) |
| The relayer on testnet | **The dev adapter** (a generated testnet key, `RELAYER_MODE=local` with `RELAYER_LOCAL_ALLOW_TESTNET=1`), standing in for the Privy server wallet, which does not exist yet |
| The demo's pause | The owner raises the depeg threshold above the real price ("threshold raised for demo"). The price is never faked |

**End to end on a local chain, headless** (`DEMO_FAST_PLANS=1 pnpm demo:local`,
then `pnpm demo:e2e:chainlink`; [`docs/demo/chainlink`](docs/demo/chainlink/README.md)):
**18 of 18 steps passed** (28 Sep 2026, after the review's fixes).

- An Argentine buyer sees the Send amount in pesos at Chainlink's USD / ARS
  rate.
- Raise your limit runs `polaris-underwrite` and opens a $1,000 line on chain.
  The credit screen names the report "CRE workflow, local run" (a local
  forwarder, no DON signature), never "Verified by Chainlink CRE". Pay in 4
  then opens a plan.
- The owner raises the depeg threshold to $1.001 (**threshold raised for
  demo**, captioned on every paused screen). GuardianReceiver judges the last
  attested Chainlink price by it at once, and the guardian's next scheduled
  run reads Chainlink AUSD/USD 0.99978429 on Monad mainnet and attests the
  pause on chain (`creditPaused() = (true, 1)`). The shop, the checkout and
  the dashboard say so, and Pay now still goes through. Once the threshold is
  restored, Pay in 4 resumes, and the next run attests it.
- A buyer who revoked their approval is dunned by the collections cron and
  signs once. The `Reauthorized` log trigger collects the payment **2 s
  later**.

Those runs are each workflow's real handler (the code `cre workflow build`
compiles) on the CRE SDK's test runtime: `trigger:local`,
`collections:local` and `guardian:local`. They are not the CLI or a DON.

| Also | Where | Verify |
|---|---|---|
| The WASM builds | `pnpm --filter @polaris/cre-workflows build` | all three compile (no login needed) |
| Real contracts, every trigger | `pnpm --filter @polaris/cre-workflows e2e:local` | 12 of 12 on a local node |
| `cre workflow simulate --broadcast` on Monad testnet, with hashes | `pnpm --filter @polaris/cre-workflows evidence --retry-tx 0xf02c45bd…` writes logs and hashes to `workflows/evidence/` | **Done** for collections (log and cron triggers) and the guardian: [`0x1116fbb4…`](https://testnet.monadscan.com/tx/0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d), [`0xd7bcf41e…`](https://testnet.monadscan.com/tx/0xd7bcf41e8efa7841c86870689a3c9599c3a960d39f4c28b82c6980dc1f1a97e4), [`0x015bd95d…`](https://testnet.monadscan.com/tx/0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080). Underwriting's report needs provider keys ([the runs](#cre-runs-on-monad-testnet-28-sep-2026)) |
| The receivers' sources on Monadscan | `ETHERSCAN_API_KEY=… pnpm --filter @polarispay/contracts verify:monad` | *Not yet*: needs an Etherscan key (step 1); `VERIFY_DRY_RUN=1` shows all 12 contracts reproduce from source today |
| Receivers locked to the deployed workflows | `pnpm --filter @polarispay/contracts lock-receivers:monad` | after a DON deploy |

### Nansen: a product powered by its data

| Requirement | Where | Verify |
|---|---|---|
| Nansen data behind a product decision | `packages/underwriting/src/core/providers/nansen.ts` (first funder, related wallets) → Facts → the CRE workflow attests them → ScoreManager scores them on chain | `pnpm --filter @polarispay/underwriting test` |
| Beyond raw data | The buyer sees their line and the plain-language reasons behind it, explained by `@polarispay/underwriting` from the facts in the forwarder transaction (`apps/business/src/server/credit/explain.ts`), in the checkout, the credit screen and the dashboard's "Why your buyers got credit" | `docs/demo/20-payin4-6-limit-raised.png`, `41-dashboard-panels.png` |
| Live Nansen calls | *Not yet*: the fixtures are synthesized (and labelled); the local trigger reads them | [What only you can do](#what-only-you-can-do), step 3 |

### Envio: HyperIndex behind a core feature

| Requirement | Where | Verify |
|---|---|---|
| An indexer of the product's events | `packages/indexer` (HyperIndex 3.12, 26 entities, a webhook outbox that emits exactly `polarispay-sdk`'s events) | `packages/indexer/scripts/wsl.sh test` (WSL or CI) |
| Consumed by the product | The dashboard's "Indexed by Envio" feed reads it through `@polarispay/indexer-client` when `POLARIS_INDEXER_URL` is set (`apps/business/src/server/insights.ts`); the CRE collections workflow's candidate list is the client's `DUE_CANDIDATES` query; the chain sync can read logs from Envio's HyperRPC (`POLARIS_LOGS_RPC_URL`) | `pnpm --filter @polaris/business test` (`test/insights.test.ts`); without an indexer the feed shows the server's own chain sync with a "Chain sync" pill (`docs/demo/41-dashboard-panels.png`) |
| Deployed | *Not yet* | [What only you can do](#what-only-you-can-do), step 5 |

### What is simulated or sample

- **Everything on-chain in `docs/demo` is a local Hardhat chain**, deployed by
  the same script as testnet. Receipts there link nowhere (no explorer).
- **On Monad testnet** the contracts are real, but the dollar is `MockAUSD`
  (a labelled mock anyone can mint), and the relayer is the dev adapter's
  generated key, not the Privy server wallet. The smoke test's Pay in 4 line
  is secured by collateral, because no CRE underwriting report has run there
  yet.
- **The dev signer** stands in for Face ID in the demo (a key kept in the
  browser; badge on every screen).
- **The CRE runs** in the demo are the real workflow handlers on the SDK's test
  runtime (`trigger:local`, `collections:local`, `guardian:local`), not a DON
  or the CRE CLI; the guardian's AUSD/USD is Chainlink's real Monad mainnet
  feed, and its demo pause is the owner raising the threshold above that
  price ("threshold raised for demo"), never a faked price. The underwriting
  run's evidence is the
  underwriting package's synthesized fixtures ("fresh-account" for the buyer,
  "strong" for the history wallet), and on chain 31337 with no wallet in the
  browser a stand-in key signs the history wallet's proof (the app says so).
  The credit line there names its report "CRE workflow, local run": only a
  DON-signed report is ever called "Verified by Chainlink CRE".
- **The dashboard's local session** is `pnpm demo:local`'s own; the server
  accepts it only in development, on a local chain, with Privy off.
- **Local-currency rates** are live Chainlink rates read from public RPCs and
  labelled "indicative"; only EUR, GBP, JPY, CHF and CAD come from Monad (the
  rest from Ethereum, Polygon or Base), and 10 currencies have no feed and no line.
- The app's offline demo (no API configured) shows sample data and says so.

## What only you can do

1. **Monad testnet:** done on 28 Sep 2026 ([the deployment](#monad-testnet-deployment)),
   and GuardianReceiver redeployed the same day with the review's fixes. What
   is left:
   - **Source verification on Monadscan** (the judges' explorer links show
     no source today): create a free Etherscan V2 API key, then
     `ETHERSCAN_API_KEY=… pnpm --filter @polarispay/contracts verify:monad`.
     It verifies PolarisCheckout from the deploy commit's sources (reauthorize
     has changed since); `VERIFY_DRY_RUN=1` checks all 12 with no key first.
   - Real AUSD: if Agora sends testnet AUSD, a redeploy with `AUSD_MODE=ausd`
     (or `fund-pool:monad` on a real-AUSD deployment) replaces the mock dollar.
   - Optional: a PolarisCheckout redeploy for the two `reauthorize` fixes
     (it moves every address the apps, the indexer and the workflows use, so
     after the freeze). The deployer has about 0.30 MON left.
2. **Chainlink CRE:** logged in, and the evidence run is done: three CRE
   reports delivered on Monad testnet on 28 Sep 2026
   ([the runs](#cre-runs-on-monad-testnet-28-sep-2026)). Still open: request
   deploy access with `cre account access` (the CLI says it is not enabled).
   Optional:
   - `--callback http://localhost:3100/api/cre/callback` with a running API
     and `POLARIS_CALLBACK_SECRET` in `workflows/.env` equal to the API's
     `POLARIS_CRE_CALLBACK_SECRET`, so collections' HTTP callback shows in its
     log.
   - An **underwriting report** (not `incomplete` or `thin`) needs a free
     Etherscan API key (Zerion's too if possible) in `workflows/.env` and
     `POLARIS_UNDERWRITE_WALLET_KEY` set to a consenting wallet with at least
     90 days and 10 transactions on Ethereum or Base; then
     `evidence --only underwriting`. Its log is also the first real
     Confidential HTTP call.
   - For the demo recording: `collections:loop --broadcast`,
     `guardian:loop --broadcast`, `retry:listen --broadcast`, and point
     `CRE_UNDERWRITING_TRIGGER_URL` at the CLI's trigger.
3. **Nansen, Zerion, Etherscan:** create API keys (ask Nansen for credits) and
   run `pnpm --filter @polarispay/underwriting record --linked <a consenting wallet>`
   to replace the synthesized fixtures.
4. **Privy:** turn on email and Google login and the allowed domains; run
   `pnpm --filter @polaris/business privy:setup-relayer -- --apply --registry-admin`,
   `privy:setup-payouts -- --apply`, `grant-relayer:monad`,
   `privy:prove-policy -- --run` and `privy:smoke -- --run`; set
   `PRIVY_ADMIN_QUORUM_ID`, `REGISTRY_ACTIVATOR=privy` and move the registry
   to the Privy admin (`scripts/transfer-registry-owner.mjs`).
5. **Envio:** log in to Envio Cloud, install its GitHub app, deploy
   `packages/indexer` (see its README), and set `POLARIS_INDEXER_URL` on the
   API and `candidates.indexerUrl` in the CRE configs.
6. **Hosting:** HTTPS for the app, the landing and the shop; Polaris for
   Business as one long-lived Node process with a persistent disk (a VM, Fly
   or Railway with a volume), with `POLARIS_CHECKOUT_ORIGIN`,
   `POLARIS_PUBLIC_URL`, `POLARIS_KEY_PEPPER`, `CRON_SECRET`,
   `POLARIS_TRUSTED_PROXIES` and `NEXT_PUBLIC_DEMO_SHOP_URL`. Never set
   `NEXT_PUBLIC_DEV_SIGNER` for a deployed app: `next build` blanks it (and
   `NEXT_PUBLIC_DEV_SIGNER_PERSIST`) unless `POLARIS_ALLOW_DEV_SIGNER_BUILD=1`,
   so a hosted build only offers Face ID (Mera) and email (Privy).
7. **Ask the sponsors:** Agora, whether a PWA counts as a mobile app; Mera,
   whether the app's email option (Privy) beside Face ID is acceptable.

## What's next

- **One owner key is a single point of failure.** Every receiver, the
  checkout and the loan engine are owned by the deployer EOA. With it one
  could point a receiver at another forwarder or transmitter and forge
  credit facts, or force the guard open or closed. Fine for a testnet
  hackathon build; after the freeze, ownership moves to a multisig, with a
  timelock on `setForwarderAddress`, `setSimulationTransmitter`,
  `setOverride` and `setThresholds`.
- **The CRE workflows on a DON**, once deploy access comes through: deploy
  all three, `lock-receivers:monad` to the production KeystoneForwarder, and
  the credit line's provenance reads "Verified by Chainlink CRE".
- **PolarisCheckout with the `reauthorize` fixes**, redeployed with the
  addresses the apps, the indexer and the workflows use.
- **Real AUSD** on testnet, then mainnet credit after an audit.
- **CCIP** to take Pay in 4 repayments in AUSD from another chain.

---

## Screenshots

### Pay in 4, end to end

Captured from a `pnpm demo:e2e` run against `pnpm demo:local`. A buyer at the
Halcyon demo shop picks Pay in 4, and the Polaris checkout opens in a pop-up.
The CRE underwriting workflow raises their limit with plain-language reasons,
and they confirm. The shop gets a paid order with four payments, and the
merchant sees the sale and the plan. Locally, a dev signer stands in for Face
ID; the badge says so.

![Pay in 4 from the shop to the merchant dashboard](docs/screenshots/demo-pay-in-4-end-to-end.jpg)

### Polaris for Business (merchant web app)

![Reference beside the merchant Overview](docs/screenshots/merchant-web-vs-reference.jpg)

![Merchant Overview](docs/screenshots/merchant-web-overview.jpg)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/merchant-web-payments.jpg" alt="Payments"></td>
    <td width="20%"><img src="docs/screenshots/merchant-web-phone.jpg" alt="Overview on a phone"></td>
    <td width="30%"><img src="docs/screenshots/merchant-web-landing.jpg" alt="Merchant landing page"></td>
  </tr>
  <tr>
    <td>Payments</td>
    <td>Overview on a phone</td>
    <td>Merchant landing page</td>
  </tr>
</table>

### The Polaris app on the web (customers)

On a laptop the customer app has its own layout in the same design system as
the merchant web app: the reference, the merchant web and the customer web,
side by side.

![Reference, merchant web and customer web](docs/screenshots/reference-merchant-customer.jpg)

![Customer Home on the web](docs/screenshots/customer-web-home.jpg)

![Customer web pages](docs/screenshots/customer-web-pages.jpg)

### The Polaris app on a phone (customers)

![The customer app](docs/screenshots/customer-app-screens.jpg)

More desktop captures of the app, from the end-to-end run, are in
[`docs/demo`](docs/demo) (`01`, `30`-`32` and the `x-1440-*` screens).

### Halcyon, the demo shop

![Halcyon product photography](docs/screenshots/demo-shop-photos.jpg)

### Shared components (`packages/ui`)

<table>
  <tr>
    <td width="70%"><img src="docs/screenshots/components-trading.jpg" alt="Candlesticks, checkout and plan details"></td>
    <td width="30%"><img src="docs/screenshots/components-sales.jpg" alt="Sales, customers, donut and payouts"></td>
  </tr>
</table>

---

## Pre-existing components

The Metropolis rules allow pre-existing code as a foundation if it is
identified. Everything below was written before the build window (1 Sep 2026).
It was imported **byte-for-byte** in the first commit of this repository
(`85b29e4`), from
[`nickthelegend/polaris-solana@daca8ca`](https://github.com/nickthelegend/polaris-solana/tree/daca8ca)
(30 Aug 2026). Every git blob ID in that commit matches the source.

| Path | What it is |
|---|---|
| `packages/contracts/contracts/*.sol` (as of `85b29e4`) | `PolarisLoanEngine`, `PolarisPayments`, `ScoreManager`, `CollateralVault`, `MerchantRegistry`, `BatchSettlement`, `MockUSDC` |
| `packages/contracts/test/*` (as of `85b29e4`) | The Hardhat suite for those contracts, including exploit regressions |
| `packages/contracts/scripts/*`, `deployments/*` | Sepolia deployment and end-to-end scripts, and their recorded runs |
| `packages/underwriting` | Underwriting signals and collectors |
| `packages/sdk` | `polarispay-sdk` 0.2.x |
| `packages/keeperhub/src/dunning.ts`, `errors.ts` | The dunning ladder and the failure kinds it branches on |
| `packages/db/src/webhooks.ts` | Webhook signing and verification |
| `apps/gateway/src/score.ts` | Plain-language score explanations |

**Everything after `85b29e4` is new work for Metropolis.** To see it:

```bash
git diff --stat 85b29e4..HEAD
```

The earlier product (a Solana program, Android apps and a merchant platform)
stays in `polaris-solana` as prior work. None of it is part of this submission
unless listed above.

## AI coding tools

As the Metropolis rules require, we disclose that this project is built with
the help of AI coding tools. We use **Claude Code** (Anthropic) for
implementation, tests and review. Commits it co-authored carry a
`Co-Authored-By: Claude` trailer.

The photographs, portraits, the 3D coin and the abstract light streaks in
`apps/landing/public/assets` and `apps/app/public/assets` are AI-generated with
ChatGPT's image generation. The looping background video, where present, is
generated with Gemini. They depict no real people. The Polaris mark and wordmark
in `packages/brand` are the team's own artwork.

## Attribution

*TBD: the full list of external libraries by package.* So far:

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT)
- [Hardhat](https://hardhat.org) (MIT)
- [ethers](https://github.com/ethers-io/ethers.js) (MIT)
- [Chainlink CRE SDK](https://www.npmjs.com/package/@chainlink/cre-sdk) (BUSL-1.1, a dependency of `workflows/`), the CRE CLI and `ReceiverTemplate.sol` (MIT)
- [Envio HyperIndex](https://envio.dev) (the `envio` CLI, in `packages/indexer`)
- [Privy](https://privy.io) (`@privy-io/react-auth`, `@privy-io/node`), [Mera](https://mera.category.xyz) (`@category-labs/mera`)
- [Next.js](https://nextjs.org), [React](https://react.dev), [Tailwind CSS](https://tailwindcss.com) (MIT)
- [viem](https://viem.sh), [zod](https://zod.dev), [@noble/curves and @noble/hashes](https://paulmillr.com/noble/) (MIT)

## License

[MIT](LICENSE)
