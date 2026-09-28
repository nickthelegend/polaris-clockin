# The Chainlink states, as the product shows them

> **Superseded for the collections and guardian scenes by
> [`docs/demo/chainlink`](../../demo/chainlink/README.md)**, where every report
> comes from a real workflow handler (`pnpm demo:e2e:chainlink`). The
> screens below were captured earlier with hand-built collections and
> guardian reports; `scripts/demo-chainlink.mjs` no longer has the
> `collect`, `watch-retry` and `guard healthy|depeg|stale` steps that built
> them. They still show every state the product can be in (the stale guard
> is only here).

Captured on 28 Sep 2026 from `pnpm demo:local` (branch `metropolis/cl-apps`)
at 1440×900 and 402×877 for the customer app and the shop, and 1440×900 for
the merchant dashboard. Headless Chrome, reduced motion. Every figure on
these screens came from the local chain through the API; nothing was mocked
in the browser.

How the states were reached (`scripts/demo-chainlink.mjs`, on a demo run
started with `DEMO_PAY_IN_4_INTERVAL_SECONDS=120` so an instalment falls due
in two minutes without moving the chain's clock):

| Step | What ran |
|---|---|
| `buyer` | A test buyer key with test dollars; the local chain mines a block a second from then on. |
| `underwrite` | The buyer's consent and a history wallet's link proof to `POST /api/credit/underwrite`. The API fired `trigger:local`, which ran the **real `polaris-underwrite` handler** on the CRE SDK's test runtime (fixture personas, not Nansen) and wrote the report through the local forwarder: score 697, line opened. |
| `plan` | A Halcyon order for Pay in 4 (`POST /api/checkout` on the shop), signed as the app signs it, carried by `POST /api/relay`. |
| `lose-approval`, `collect` | The buyer's own `approve(loanEngine, 0)`, then a collections report: TaskSkipped with InsufficientAllowance, so the plan is dunned and asks to sign again. |
| Sign again (in the app) | The app's "Sign again with Face ID" (the dev signer stands in for Face ID) signed the permit; the relayer sent `PolarisCheckout.reauthorize`. `watch-retry` saw `Reauthorized` and delivered the collections report, as the workflow's EVM log trigger does. |
| `guard healthy / depeg` | Guardian attestations from the local stand-in AUSD/USD feed and `poolState()`. The depeg paused credit. |
| `guard max-age 120` | The owner shortened the staleness window (default 3600 s) so the late guard could be shown within minutes: the page says "Stale after 2 min". A back-dated attestation sent before it was refused (`AttestationOutOfOrder`), and the page lists that refusal. |

**The collections and guardian reports here are hand-built.** On this local
chain `demo-chainlink.mjs` builds them with `packages/contracts/lib/cre.js`
(the encoders the contract tests hold the workflows to) and delivers them
through the local MockKeystoneForwarder; no CRE workflow, DON or Chainlink
feed produced them, and the pages say so ("Local chain", "local stand-in
feed … not Chainlink"). The underwriting report is the real handler's. On
Monad testnet the same reports come from `cre workflow simulate --broadcast`.
The dashboard page also shows a second buyer (0xd1eB…6528) that another
client created on the same local stack.

## Customer app

| File | State |
|---|---|
| `app-sign-again-home-1440.png`, `app-sign-again-home-402.png` | Home: "Sign again to pay your instalment" |
| `app-sign-again-plan-1440.png`, `app-sign-again-plan-402.png` | The plan drawer and sheet with the Sign again card |
| `app-sign-again-fx-es-AR-1440.png`, `app-sign-again-fx-es-AR-402.png` | The same in es-AR: the instalment with its Chainlink ARS line |
| `app-sign-again-confirm-1440.png` | Confirm with Face ID |
| `app-collecting-plan-1440.png`, `app-collecting-plan-402.png` | Signed, collecting (the app polls the API) |
| `app-collected-plan-1440.png`, `app-collected-plan-402.png`, `app-collected-after-retry-402.png` | Collected, with the collection's transaction (1 s after signing with the watcher running) |
| `app-credit-verified-1440.png`, `app-credit-verified-402.png`, `app-score-verified-1440.png`, `app-score-verified-402.png` | "Verified by Chainlink CRE" on the credit line and score (no explorer on a local chain, so the report's hash is shown unlinked) |
| `app-checkout-paused-1440.png`, `app-checkout-paused-402.png` | Checkout while the risk guard has paused credit: Pay in 4 shown as paused, Pay now offered |
| `app-credit-paused-1440.png`, `app-credit-paused-402.png` | The credit line while paused |
| `app-checkout-stale-1440.png`, `app-checkout-stale-402.png`, `app-credit-stale-1440.png`, `app-credit-stale-402.png` | A late guard: "Risk guard last checked 3 min ago · Pay in 4 stays on" (the buyer was over their limit for this order, which the checkout also says) |

## Merchant dashboard

| File | State |
|---|---|
| `merchant-chainlink-1440.png`, `merchant-chainlink-full-1440.png` | The Chainlink page: guard healthy, a dunned collections run, two underwriting reports |
| `merchant-chainlink-instant-retry-1440.png` | The collections run that followed the buyer's Reauthorized ("Instant retry") |
| `merchant-overview-paused-1440.png`, `merchant-chainlink-paused-1440.png` | The risk-guard banner on every page, and the paused guard with its failed check |
| `merchant-chainlink-stale-1440.png`, `merchant-chainlink-stale-full-1440.png` | The late guard failing open, the refused attestation in the guardian's runs |
| `merchant-chainlink-healthy-1440.png` | Healthy again after a fresh attestation |

## Halcyon (the demo shop)

| File | State |
|---|---|
| `shop-product-paused-1440.png`, `shop-product-paused-402.png` | The product line: "Polaris Pay in 4 is paused by our risk guard; pay now works as usual." |
| `shop-checkout-paused-1440.png`, `shop-checkout-paused-402.png` | Checkout opens on Pay now; Pay in 4 marked Paused with the same sentence |
