# The Chainlink scenes, end to end

`pnpm demo:e2e:chainlink` ([`scripts/demo-e2e-chainlink.cjs`](../../../scripts/demo-e2e-chainlink.cjs))
against `DEMO_FAST_PLANS=1 pnpm demo:local`, headless Chrome, 2026-09-28 01:37 UTC.
**18 of 18 steps passed.** Every report on these screens came from a real
Chainlink CRE workflow handler (the code `cre workflow build` compiles to WASM), run
by demo:local's local runners on the CRE SDK's test runtime against a local Hardhat
chain (31337). Nothing was hand-built and nothing in the browser was mocked. What is
local, and what is not, is at the end.

| Step | What happened | Screens |
|---|---|---|
| FX | An Argentine buyer (browser locale es-AR). `/api/fx` read Chainlink's **USD / ARS** feed on ethereum (`0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b`, round 18446744073709551862): 1612.4065 ARS per USD; the Send form shows the amount in pesos, with the rate's age, as indicative | [`01-fx-send-ars`](01-fx-send-ars.png) |
| Underwriting | Halcyon → Pay in 4 → Raise your limit. The API fired the HTTP trigger; `trigger:local` ran `polaris-underwrite` (fixture evidence) and its report reached `UnderwritingReceiver`: score 697, a $1000.00 line, report `0x10d38ddb663b14507d34a5af1e5896202c879155c0998b0329e10587f5f12f11`. The credit screen says "Verified by Chainlink CRE" with that transaction | [`02-payin4-shop-product`](02-payin4-shop-product.png), [`02-payin4-shop-checkout`](02-payin4-shop-checkout.png), [`03-underwrite-raise-your-limit`](03-underwrite-raise-your-limit.png), [`04-underwrite-limit-raised`](04-underwrite-limit-raised.png), [`07-credit-verified-by-chainlink-cre`](07-credit-verified-by-chainlink-cre.png) |
| Pay in 4 | Plan 1 opened through `PolarisCheckout.openPlan` (`0xa40b39a6936c5c8bc9161e00cb25d988773b210cd71d3edf328c2da0f645a00d`), payments 60 s apart | [`05-payin4-checkout-with-line`](05-payin4-checkout-with-line.png), [`06-payin4-shop-order`](06-payin4-shop-order.png) |
| Lost approval | The buyer's own `approve(loanEngine, 0)` (`0x4b048bc28378340663ef4b6666e65c58d9baa8d828ddca812f9b340f136c9ca9`), before payment 1 fell due | |
| Guardian pauses | **Threshold raised for demo**: the owner set the depeg threshold to $1.001. The guardian's next scheduled run read **Chainlink AUSD/USD on Monad mainnet** (0.99983039, round 18446744073709559173, feed `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13`) and the pool on the local chain, and attested a pause (round 2, `0x9dfcb21353bf0486e00a977c64b6b702517d398ba074f8b3e08d88af929376af`). `PolarisCheckout.creditPaused()` = (true, 1). The price was never touched | [`08-dashboard-chainlink-paused`](08-dashboard-chainlink-paused.png), [`09-dashboard-overview-guard-banner`](09-dashboard-overview-guard-banner.png), [`10-paused-shop-product`](10-paused-shop-product.png), [`10-paused-shop-checkout`](10-paused-shop-checkout.png), [`10-paused-app-checkout`](10-paused-app-checkout.png) |
| Pay now still works | Halcyon → Pay now → paid, while Pay in 4 was paused | [`11-paused-pay-now-still-works`](11-paused-pay-now-still-works.png) |
| Guardian resumes | The owner restored $0.995; the next run attested healthy (round 3, `0x40fbf0da383b8e433a6faa0d62f92d1d8b33896650e042df54b0ac2f836d098c`); Pay in 4 is offered again | [`12-dashboard-chainlink-resumed`](12-dashboard-chainlink-resumed.png), [`13-shop-pay-in-4-resumed`](13-shop-pay-in-4-resumed.png) |
| Dunned | The collections cron's run could not take payment 1 (`InsufficientAllowance`): `allowance_lost`, next chain-ladder attempt in 6 h; the app asks the buyer to sign again | [`14-app-home-sign-again`](14-app-home-sign-again.png), [`15-app-plan-sign-again`](15-app-plan-sign-again.png) |
| Instant retry | One Face ID: the relayer sent `PolarisCheckout.reauthorize` (`0xd75c78f2eeca8853a0329f6e26dc7ab5a84d4360e05bfee3bda63c868f132a5a`); its `Reauthorized` log fired the collections workflow's **EVM log trigger**, which collected payment 1 (`0xaeec70eeed3da08cda71e96ca872ccfcba535c41466a4d64dbbb074d7f900619`), **2 s after signing** | [`16-app-sign-again-confirm`](16-app-sign-again-confirm.png), [`17-app-plan-collected`](17-app-plan-collected.png) |
| The merchant's view | The dashboard's Chainlink page: the three workflows, their triggers and reports, the guard and its thresholds, the pool health feed | [`18-dashboard-chainlink-workflows`](18-dashboard-chainlink-workflows.png), [`19-dashboard-chainlink-runs`](19-dashboard-chainlink-runs.png) |

The collections log for the retry (`.demo/logs/cre-collections.log`):

```
2026-09-28T01:33:54.875Z [cre collections] log trigger on PolarisCheckout 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6 Reauthorized (0xd76c9fffb0eee17b94b2c5c485c1dcadfb48e50f9089e879e50c163b8ce02d73)
2026-09-28T01:37:00.557Z [cre collections] cron written: 2 checked, 0 collected, 1 skipped collect #1 tx 0x0716a5ce4e8ec3f1840632c96ec760983aa49c17e9d6ec091c7430300c049f15
2026-09-28T01:37:30.882Z [cre collections] log trigger: Reauthorized from 0xcf7f5f324fd074c1b530c35bf9fb2bcd755a9b20 in 0xd75c78f2eeca8853a0329f6e26dc7ab5a84d4360e05bfee3bda63c868f132a5a
2026-09-28T01:37:31.463Z [cre collections] log written: 1 checked, 1 collected, 0 skipped collect #1 tx 0xaeec70eeed3da08cda71e96ca872ccfcba535c41466a4d64dbbb074d7f900619
```

## Every step

| | Step | Evidence |
|---|---|---|
| PASS | a buyer account (the dev signer standing in for Face ID) | 0xCf7F5F324fD074C1b530C35bF9Fb2Bcd755A9B20 |
| PASS | FX: /api/fx reads Chainlink's USD / ARS feed | 1612.4065 ARS per USD, USD / ARS on ethereum 0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b, round 18446744073709551862 |
| PASS | FX: the Send form shows the amount in pesos at the Chainlink rate | About ≈ ARS 161.241 · Chainlink rate, 4 h ago · indicative |
| PASS | Underwriting: Raise your limit ran the CRE underwriting workflow and opened a line on chain | score 697, line $1000.00, report tx 0x10d38ddb663b14507d34a5af1e5896202c879155c0998b0329e10587f5f12f11 |
| PASS | Pay in 4: a plan opened on chain through PolarisCheckout.openPlan | plan 1, tx 0xa40b39a6936c5c8bc9161e00cb25d988773b210cd71d3edf328c2da0f645a00d |
| PASS | The buyer revoked the loan engine's approval (their own transaction) | 0x4b048bc28378340663ef4b6666e65c58d9baa8d828ddca812f9b340f136c9ca9 |
| PASS | Credit: the line says Verified by Chainlink CRE, with the report's transaction |  |
| PASS | Guardian: its next scheduled run paused Pay in 4 on chain (depeg, threshold raised for demo) | Chainlink AUSD/USD 0.99983039 < $1.001; attestation round 2, tx 0x9dfcb21353bf0486e00a977c64b6b702517d398ba074f8b3e08d88af929376af |
| PASS | On chain: PolarisCheckout.creditPaused() is (true, depeg), so openPlan refuses new plans | creditPaused() = (true, 1) |
| PASS | Shop: Pay in 4 says it is paused by the risk guard; Pay now is offered |  |
| PASS | Pay now still works while Pay in 4 is paused | /orders/hc_jzzufhoje77g2f4venf2?via=polaris |
| PASS | Checkout: on a session that offers Pay in 4, the app shows it paused with the guard's words, and the API refuses it | payIn4.available=false, reason "Pay in 4 is paused by our risk guard; pay now works as usual." |
| PASS | Guardian: after the owner restored the threshold, the next run resumed Pay in 4 | round 3, tx 0x40fbf0da383b8e433a6faa0d62f92d1d8b33896650e042df54b0ac2f836d098c |
| PASS | Shop: Pay in 4 is offered again |  |
| PASS | Collections: the cron's run could not take payment 1 (lost approval); the plan asks the buyer to sign again | lastFailure {"reason":"allowance_lost","at":"2026-09-28T01:37:42.000Z","nextAttemptAt":"2026-09-28T07:37:42.000Z"} |
| PASS | Instant retry: Reauthorized fired the collections workflow's log trigger, and payment 1 was collected | 2 s after signing; reauthorize 0xd75c78f2eeca8853a0329f6e26dc7ab5a84d4360e05bfee3bda63c868f132a5a, collection 0xaeec70eeed3da08cda71e96ca872ccfcba535c41466a4d64dbbb074d7f900619 |
| PASS | The collections log shows the log-triggered run that collected | 2026-09-28T01:37:31.463Z [cre collections] log written: 1 checked, 1 collected, 0 skipped collect #1 tx 0xaeec70eeed3da08cda71e96ca872ccfcba535c41466a4d64dbbb074d7f900619 |
| PASS | Dashboard: the Chainlink page lists the collections run that followed the re-sign as an instant retry |  |

`results.json` has the same, with the guardian's full results (the price, the pool,
the thresholds, the verdict) and the FX read.

## What is local, and what is not

- **Local:** the chain (Hardhat 31337, receipts link nowhere), the DON (the runners
  are the SDK's test runtime, not the CRE CLI or a DON; the forwarder is the
  deployment's MockKeystoneForwarder, called by the local simulation transmitter),
  the underwriting evidence (synthesized fixtures, not live Nansen, Zerion or
  Etherscan), Face ID (the dev signer).
- **Real:** the workflow code, the contracts and every on-chain effect on that
  chain; Chainlink's AUSD/USD read from Monad mainnet by the guardian
  (Chainlink AUSD / USD on Monad mainnet via https://rpc.monad.xyz); Chainlink's USD / ARS read by the API.
- **The pause is staged, the price is not:** the owner raised the depeg threshold
  above the live price, as a real owner could; every paused screen is captioned
  "Threshold raised for demo".
- **"Instant retry" on the dashboard** is the API's reading of the chain: a
  collection of a buyer within 15 minutes after their `Reauthorized`. The chain
  does not record which trigger fired a report; the runner's log does.
- No Monad testnet transaction is here: `cre workflow simulate --broadcast` needs
  `cre login` and a testnet deployment (the root README, "What only you can do").
