# The Chainlink scenes, end to end

`pnpm demo:e2e:chainlink` ([`scripts/demo-e2e-chainlink.cjs`](../../../scripts/demo-e2e-chainlink.cjs))
against `DEMO_FAST_PLANS=1 pnpm demo:local`, headless Chrome, 2026-09-28 04:20 UTC, after the
review's fixes (the guardian reads the pool itself; the credit line names who
delivered its report). **18 of 18 steps passed.** Every report on these
screens came from a real Chainlink CRE workflow handler (the code `cre workflow
build` compiles to WASM), run by demo:local's local runners on the CRE SDK's test
runtime against a local Hardhat chain (31337). Nothing was hand-built and nothing
in the browser was mocked. What is local, and what is not, is at the end.

| Step | What happened | Screens |
|---|---|---|
| FX | An Argentine buyer (browser locale es-AR). `/api/fx` read Chainlink's **USD / ARS** feed on ethereum (`0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b`, round 18446744073709551862): 1612.4065 ARS per USD; the Send form shows the amount in pesos, with the rate's age, as indicative | [`01-fx-send-ars`](01-fx-send-ars.png) |
| Underwriting | Halcyon → Pay in 4 → Raise your limit. The API fired the HTTP trigger; `trigger:local` ran `polaris-underwrite` (fixture evidence) and its report reached `UnderwritingReceiver`: score 697, a $1000.00 line, report `0x8e13ccc8ac792bef9f56ec438ad854a1ae121c48ce65be393246da0b5965b8a0`. The credit screen names it **"CRE workflow, local run"**: it came through the local chain's forwarder, with no DON signature, so it is never called "Verified by Chainlink CRE" (only a report through Chainlink's KeystoneForwarder is) | [`02-payin4-shop-product`](02-payin4-shop-product.png), [`02-payin4-shop-checkout`](02-payin4-shop-checkout.png), [`03-underwrite-raise-your-limit`](03-underwrite-raise-your-limit.png), [`04-underwrite-limit-raised`](04-underwrite-limit-raised.png), [`07-credit-cre-local-run`](07-credit-cre-local-run.png) |
| Pay in 4 | Plan 3 opened through `PolarisCheckout.openPlan` (`0xfb0ea755e2e226bab291c2291a801720e82cead5136519ebacc0630fd9d8568d`), payments 60 s apart | [`05-payin4-checkout-with-line`](05-payin4-checkout-with-line.png), [`06-payin4-shop-order`](06-payin4-shop-order.png) |
| Lost approval | The buyer's own `approve(loanEngine, 0)` (`0x164a8db2e191b1bd20159d2003f5fed9888f5c68380ae2365571667ff41799da`), before payment 1 fell due | |
| Guardian pauses | **Threshold raised for demo**: the owner set the depeg threshold to $1.001 (`0xda5d65c921e649f687f2a62fef0ed9a5689148269aadd2d6226737742321f987`). GuardianReceiver judged the last attested price by it at once (the API read the pause before any new report: round 4); the guardian's next scheduled run read **Chainlink AUSD/USD on Monad mainnet** (0.99978429, round 18446744073709559176, feed `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13`) and the pool on the local chain, and attested the pause (round 5, `0xd39701c398b077b2bfe5727a79a162dc5652f46eed186152d8e9e30af6a73de8`). `PolarisCheckout.creditPaused()` = (true, 1). The price was never touched | [`08-dashboard-chainlink-paused`](08-dashboard-chainlink-paused.png), [`09-dashboard-overview-guard-banner`](09-dashboard-overview-guard-banner.png), [`10-paused-shop-product`](10-paused-shop-product.png), [`10-paused-shop-checkout`](10-paused-shop-checkout.png), [`10-paused-app-checkout`](10-paused-app-checkout.png) |
| Pay now still works | Halcyon → Pay now → paid, while Pay in 4 was paused | [`11-paused-pay-now-still-works`](11-paused-pay-now-still-works.png) |
| Guardian resumes | The owner restored $0.995 (`0x194c1b3ff948694061de18e244c582a8ff6628c0db08babbc03d9191f8f11fc4`); Pay in 4 opened again at once, and the next run attested healthy (round 6, `0x187a38cac9fd6e05e3aa2a71cb8c1aea851f2dd657c63e004271924388c3387b`) | [`12-dashboard-chainlink-resumed`](12-dashboard-chainlink-resumed.png), [`13-shop-pay-in-4-resumed`](13-shop-pay-in-4-resumed.png) |
| Dunned | The collections cron's run could not take payment 1 (`InsufficientAllowance`): `allowance_lost`, next chain-ladder attempt in 6 h; the app asks the buyer to sign again | [`14-app-home-sign-again`](14-app-home-sign-again.png), [`15-app-plan-sign-again`](15-app-plan-sign-again.png) |
| Instant retry | One Face ID: the relayer sent `PolarisCheckout.reauthorize` (`0xc5bc8910c5d87ea82f7d6e72950eec49d2894616de193ad059183884bba6a97d`); its `Reauthorized` log fired the collections workflow's **EVM log trigger**, which collected payment 1 (`0x47d6845243bee16fee6474d714704a2adae2f8ee67211d5142fb088550a908c6`), **2 s after signing** | [`16-app-sign-again-confirm`](16-app-sign-again-confirm.png), [`17-app-plan-collected`](17-app-plan-collected.png) |
| The merchant's view | The dashboard's Chainlink page: the three workflows, their triggers and reports, the guard with each check's source (the price from the attestation, the cash and bad debt from the pool, live) and its thresholds, the pool health feed | [`18-dashboard-chainlink-workflows`](18-dashboard-chainlink-workflows.png), [`19-dashboard-chainlink-runs`](19-dashboard-chainlink-runs.png) |

The collections log around the retry (`.demo/logs/cre-collections.log`):

```
2026-09-28T04:14:30.863Z [cre collections] log trigger: Reauthorized from 0x91678bd4cf2390da645b0e7956e6006048659e95 in 0x497503f688fb879a0d7104598ed65a0beb506088afb9deccc86883d1e1b28b81
2026-09-28T04:14:30.863Z [cre collections] log trigger: Reauthorized from 0x3bcfb1f6efa8abf95c5137681d9f165c15ced519 in 0x6e6d1c8d154fd0be2f992fe3089c57254bb7f05acfd32a06c11d478217b74a53
2026-09-28T04:20:00.677Z [cre collections] cron written: 6 checked, 0 collected, 1 skipped collect #3 tx 0xb5395fc40dcbe922e4a8a12491288dd2bd5a2768dc536d20279ebc5732ca8ebb
2026-09-28T04:20:29.935Z [cre collections] log trigger: Reauthorized from 0xbf168dd3bfeb5cc333d3b3849cb62537186438b0 in 0xc5bc8910c5d87ea82f7d6e72950eec49d2894616de193ad059183884bba6a97d
```

## Every step

| | Step | Evidence |
|---|---|---|
| PASS | a buyer account (the dev signer standing in for Face ID) | 0xBf168dd3Bfeb5CC333D3b3849CB62537186438B0 |
| PASS | FX: /api/fx reads Chainlink's USD / ARS feed | 1612.4065 ARS per USD, USD / ARS on ethereum 0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b, round 18446744073709551862 |
| PASS | FX: the Send form shows the amount in pesos at the Chainlink rate | About ≈ ARS 161.241 · Chainlink rate, 7 h ago · indicative |
| PASS | Underwriting: Raise your limit ran the CRE underwriting workflow and opened a line on chain | score 697, line $1000.00, report tx 0x8e13ccc8ac792bef9f56ec438ad854a1ae121c48ce65be393246da0b5965b8a0 |
| PASS | Pay in 4: a plan opened on chain through PolarisCheckout.openPlan | plan 3, tx 0xfb0ea755e2e226bab291c2291a801720e82cead5136519ebacc0630fd9d8568d |
| PASS | The buyer revoked the loan engine's approval (their own transaction) | 0x164a8db2e191b1bd20159d2003f5fed9888f5c68380ae2365571667ff41799da |
| PASS | Credit: the line names its report a CRE local run, with its transaction, and does not claim Chainlink verification |  |
| PASS | Guardian: its next scheduled run paused Pay in 4 on chain (depeg, threshold raised for demo) | Chainlink AUSD/USD 0.99978429 < $1.001; attestation round 5, tx 0xd39701c398b077b2bfe5727a79a162dc5652f46eed186152d8e9e30af6a73de8 |
| PASS | On chain: PolarisCheckout.creditPaused() is (true, depeg), so openPlan refuses new plans | creditPaused() = (true, 1) |
| PASS | Shop: Pay in 4 says it is paused by the risk guard; Pay now is offered |  |
| PASS | Pay now still works while Pay in 4 is paused | /orders/hc_qocbgy7new6fjo2rh4gk?via=polaris |
| PASS | Checkout: on a session that offers Pay in 4, the app shows it paused with the guard's words, and the API refuses it | payIn4.available=false, reason "Pay in 4 is paused by our risk guard; pay now works as usual." |
| PASS | Guardian: after the owner restored the threshold, the next run resumed Pay in 4 | round 6, tx 0x187a38cac9fd6e05e3aa2a71cb8c1aea851f2dd657c63e004271924388c3387b |
| PASS | Shop: Pay in 4 is offered again |  |
| PASS | Collections: the cron's run could not take payment 1 (lost approval); the plan asks the buyer to sign again | lastFailure {"reason":"allowance_lost","at":"2026-09-28T04:21:07.000Z","nextAttemptAt":"2026-09-28T10:21:07.000Z"} |
| PASS | Instant retry: Reauthorized fired the collections workflow's log trigger, and payment 1 was collected | 2 s after signing; reauthorize 0xc5bc8910c5d87ea82f7d6e72950eec49d2894616de193ad059183884bba6a97d, collection 0x47d6845243bee16fee6474d714704a2adae2f8ee67211d5142fb088550a908c6 |
| PASS | The collections log shows the log-triggered run that collected | 2026-09-28T04:20:30.378Z [cre collections] log written: 1 checked, 1 collected, 0 skipped collect #3 tx 0x47d6845243bee16fee6474d714704a2adae2f8ee67211d5142fb088550a908c6 |
| PASS | Dashboard: the Chainlink page lists the collections run that followed the re-sign as an instant retry |  |

`results.json` has the same, with the guardian's full results (the price, the pool,
the thresholds, the verdict) and the FX read.

## What is local, and what is not

- **Local:** the chain (Hardhat 31337, receipts link nowhere), the DON (the runners
  are the SDK's test runtime, not the CRE CLI or a DON; the forwarder is the
  deployment's MockKeystoneForwarder, called by the local simulation transmitter,
  which is why the credit line says "CRE workflow, local run"), the underwriting
  evidence (synthesized fixtures, not live Nansen, Zerion or Etherscan), Face ID
  (the dev signer).
- **Real:** the workflow code, the contracts and every on-chain effect on that
  chain; Chainlink's AUSD/USD read from Monad mainnet by the guardian
  (Chainlink AUSD / USD on Monad mainnet via https://rpc.monad.xyz); Chainlink's USD / ARS read by the API.
- **The pause is staged, the price is not:** the owner raised the depeg threshold
  above the live price, as a real owner could; every paused screen is captioned
  "Threshold raised for demo". GuardianReceiver applies a threshold change to the
  last attested price at once, so the pause shows before the next run attests it.
- **"Instant retry" on the dashboard** is the API's reading of the chain: a
  collection of a buyer within 15 minutes after their `Reauthorized`. The chain
  does not record which trigger fired a report; the runner's log does.
- **ARS comes from Ethereum:** Monad has no USD / ARS feed (its FX feeds are EUR,
  GBP, JPY, CHF and CAD), so the peso line reads Chainlink's USD / ARS on
  Ethereum (the line shows the rate's age; Ethereum's FX feeds update daily).
