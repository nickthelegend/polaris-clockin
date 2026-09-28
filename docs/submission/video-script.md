# The demo video: three minutes

The rules ask for a public video of 3 minutes or less that shows the product
working and its Monad integration ([`sources.md`](sources.md#the-rules)).
This is [`docs/plan.md` §8](../plan.md#8-demo-three-minutes) rewritten for
what the repository does today: the Halcyon shop, the Polaris checkout, Pay in
4 with Chainlink CRE underwriting, the merchant dashboard, send by link and
claim with the local-currency line, the Chainlink guardian and the instant
retry, and the CRE reports on Monad testnet.

**Total: 3:00.** Nine scenes, recorded in three takes, cut together.

## Rules for the recording

These keep the video honest; each one matches a label the product already
shows.

1. **Keep the "Dev signer · not Face ID" badge on screen** in every app shot
   from `pnpm demo:local`, and show the caption *Local demo chain · a dev
   signer stands in for Face ID* the first time it appears. If the app is
   hosted on HTTPS by then ([README, step 6](../../README.md#what-only-you-can-do)),
   record scene 3 on an iPhone with real Face ID instead and drop the caption.
2. **Say which chain each shot is on.** Scenes 2 to 7 are the local Hardhat
   chain; scene 8 is Monad testnet. Local receipts link nowhere; never show a
   local hash as if it were on an explorer.
3. **The guardian's pause is a moved threshold, never a faked price.** Every
   paused shot carries *Threshold raised for demo*.
4. **The credit line says who delivered its report.** On the local chain it
   reads "CRE workflow, local run"; do not caption it "Verified by Chainlink
   CRE".
5. **The underwriting evidence is sample data** on the local chain (the
   underwriting package's synthesized fixtures): say "sample history" if the
   reasons are read aloud.
6. **Local currency is indicative**, as the line itself says.
7. **The buyer's scenes use the buyer's words**: account, Face ID, confirm,
   dollars. Monad, Chainlink and CRE are named only in captions and in the
   scenes for judges (6 to 8).

## Before recording

```bash
pnpm install
# once, for scene 8 only, if you record live runs (see Take C)
pnpm --filter @polaris/cre-workflows cre:install
pnpm --filter @polaris/cre-workflows cre login
```

- **Screen:** 1440×900 for the shop, the app on desktop and the dashboard;
  a phone-sized window (390×844: Chrome DevTools device mode, or a narrow
  window) for the claim.
- **Browsers:** profile 1 is the buyer and sender (the shop, the app, the
  dashboard in tabs). A fresh incognito window is the person who claims, so
  they arrive with no account.
- **Local currency:** in profile 1, open the app's Settings and pick the
  Argentine peso, or start Chrome with `--lang=es-AR` (the app follows the
  browser's language: [`apps/app` README, "Local currency"](../../apps/app/README.md#local-currency)).
- **A clock** in a screen corner for scenes 2 to 4, so the first-five-minutes
  claim is timed on camera rather than asserted.

### The three takes

| Take | Start with | For scenes | Why a separate take |
|---|---|---|---|
| **A** | `pnpm demo:local` | 1 to 5 | Real weekly terms: Pay in 4 at 10% APR, $349 as 4 × $87.92 ([`apps/shop/README.md`](../../apps/shop/README.md#run-it-against-the-real-polaris-backend)) |
| **B** | `DEMO_FAST_PLANS=1 pnpm demo:local` | 6 and 7 | Instalments a minute apart, so a collection, a lost approval and the instant retry happen on camera. Interest pro-rated over minutes shows as $0.00; do not show this take's checkout as the pricing |
| **C** | Monad testnet: the committed CRE runs, or live CLI loops | 8 | The Monad testnet evidence |

`pnpm demo:local` ([`scripts/demo-local.mjs`](../../scripts/demo-local.mjs))
prints its URLs when every page has compiled: the shop at
http://127.0.0.1:3600, the app at http://localhost:3000, the dashboard at
http://localhost:3100/dashboard (signed in for Halcyon). Stop one take with
Ctrl+C before starting the next; each run starts fresh.

## The timeline

| Time | Length | Scene | Take |
|---|---:|---|---|
| 0:00–0:10 | 0:10 | 1. The problem | A |
| 0:10–0:25 | 0:15 | 2. Halcyon: check out with Polaris | A |
| 0:25–0:55 | 0:30 | 3. The Polaris checkout: a new buyer, Pay in 4, the limit | A |
| 0:55–1:10 | 0:15 | 4. The merchant: paid in full, the plan on the dashboard | A |
| 1:10–1:40 | 0:30 | 5. Send by link and claim, in pesos | A |
| 1:40–2:10 | 0:30 | 6. The Chainlink guardian pauses and resumes Pay in 4 | B |
| 2:10–2:30 | 0:20 | 7. Sign again: the instant retry | B |
| 2:30–2:50 | 0:20 | 8. On Monad testnet: the CRE reports | C |
| 2:50–3:00 | 0:10 | 9. For developers, and the close | any |
| | **3:00** | | |

## The scenes

Each scene lists the shots, the exact on-screen text (captions we add are in
*italics*; words the product shows are in quotes, as they read in the
reference captures), the voiceover, the command that sets it up, and a
reference capture of the frame to aim for.

### 1. The problem (0:00–0:10)

| | |
|---|---|
| Shots | Title card on black, then the Polaris landing page |
| On screen | *Every app that sells something needs Stripe.* then *Polaris: Stripe for every app on Monad.* |
| Voiceover | "Every app that sells something needs Stripe. On Monad, a buyer still needs a wallet, gas and the full price up front. Polaris fixes all three." |
| Command | Take A running; the landing page is `pnpm --filter @polaris/landing dev` (port 3200) |
| Reference | [`x-1280-landing.png`](../demo/x-1280-landing.png) |

### 2. Halcyon: check out with Polaris (0:10–0:25)

| | |
|---|---|
| Shots | Halcyon home → Halcyon One ($349, "or 4 × $87.92") → Add to bag → Check out → Payment: Polaris, **Pay in 4** → "Pay $349.00 with Polaris" → the Polaris pop-up opens |
| On screen | *Halcyon: a demo store. It takes payment through polarispay-sdk.* |
| Voiceover | "Halcyon sells headphones. It added Polaris with our SDK. Lena, in Berlin, wants to pay in four." |
| Command | Take A; open http://127.0.0.1:3600 |
| Reference | [`25-newbuyer-1-shop-product.png`](../demo/25-newbuyer-1-shop-product.png), [`25-newbuyer-3-shop-checkout.png`](../demo/25-newbuyer-3-shop-checkout.png) |

### 3. The Polaris checkout: a new buyer, Pay in 4, the limit (0:25–0:55)

| | |
|---|---|
| Shots | The pop-up on Pay in 4 → "Raise your limit" ("We read the history of a wallet you already use. Nothing moves from it.") → "Continue with Face ID" → "Your limit went up" "$1,000", with its reasons ("First topped up from a major exchange · from Nansen") → back on the checkout: "Pay in 4" "$87.92 × 4", "Due today" "$0.00" → Confirm → the receipt |
| On screen | *Local demo chain · a dev signer stands in for Face ID* (with the badge visible). *One tap creates the account: no password, no seed phrase, nothing to install.* *The limit comes from a Chainlink CRE workflow; the chain computes the score. Sample history in this local run.* |
| Voiceover | "One tap and she has an account. Polaris reads the history of a wallet she already uses, and gives her a thousand-dollar limit, with the reasons. Four payments, nothing today. Confirm." |
| Command | Take A (the underwriting runs through `trigger:local`, started by `demo:local`) |
| Reference | [`25-newbuyer-4-app-checkout-popup.png`](../demo/25-newbuyer-4-app-checkout-popup.png), [`25-newbuyer-5-raise-your-limit.png`](../demo/25-newbuyer-5-raise-your-limit.png), [`20-payin4-6-limit-raised.png`](../demo/20-payin4-6-limit-raised.png), [`20-payin4-8-app-confirm.png`](../demo/20-payin4-8-app-confirm.png), [`20-payin4-8b-app-receipt.png`](../demo/20-payin4-8b-app-receipt.png) |

The captures show $87.25 × 4 and $0.00 interest because they came from a
`DEMO_FAST_PLANS=1` run; take A shows the weekly $87.92.

### 4. The merchant: paid in full, the plan on the dashboard (0:55–1:10)

| | |
|---|---|
| Shots | The pop-up closes; Halcyon's order page: "Thank you, Lena." with "Polaris · Pay in 4" "Paid" and four payments → the dashboard's Pay in 4 page: "Paid to you up front", "100% at checkout", the plan's four tick marks, and "How Pay in 4 works": "A $200.00 order" "4 × $50.38" "10% APR" |
| On screen | *Halcyon is paid in full, up front. Polaris carries the credit and collects the four payments.* |
| Voiceover | "Halcyon is paid in full, right away. Polaris carries the credit, and collects the four payments." |
| Command | Take A; the dashboard at http://localhost:3100/dashboard, **Pay in 4** |
| Reference | [`20-payin4-9-shop-order-plan.png`](../demo/20-payin4-9-shop-order-plan.png), [`43-dashboard-pay-in-4.png`](../demo/43-dashboard-pay-in-4.png) |

### 5. Send by link and claim, in pesos (1:10–1:40)

| | |
|---|---|
| Shots | The app on desktop (profile 1, pesos): Home → Send → type 12.50 → the line under the amount: "≈ ARS … · Chainlink rate, … · indicative" → Send (the name is asked once: "Maya") → "Link ready." "Whoever opens it gets $12.50." → Copy → the incognito phone window opens the link: "You've got dollars" "$12.50" "from Maya" → "Claim $12.50" → "Arrived." "Fee" "None" → back in profile 1: "Your link was claimed" |
| On screen | *Maya, in Buenos Aires, sends $12.50 by link. The pesos are at Chainlink's USD/ARS rate, for reference only.* *Whoever opens the link gets the dollars: no account needed first, no fee.* |
| Voiceover | "Maya sends twelve dollars fifty to a friend abroad. She sees it in pesos, and shares a link. Her friend opens it, taps once, and it has arrived. No bank, no fee." |
| Command | Take A; profile 1's buyer has dollars from the checkout scenes (or **Add money**, which uses the local faucet) |
| Reference | [`01-fx-send-ars.png`](../demo/chainlink/01-fx-send-ars.png), [`x-1440-send-link-ready.png`](../demo/x-1440-send-link-ready.png), [`x-390-claim-open.png`](../demo/x-390-claim-open.png), [`x-390-claim-arrived.png`](../demo/x-390-claim-arrived.png), [`x-1440-notifications.png`](../demo/x-1440-notifications.png) |

### 6. The Chainlink guardian pauses and resumes Pay in 4 (1:40–2:10)

| | |
|---|---|
| Shots | The dashboard's **Chainlink** page: "Risk guard", "Pay in 4 is open", "AUSD/USD (CRE attestation)" at about $0.9998 → a terminal: `guard raise` → (cut the wait for the next guardian run) → "Pay in 4 is paused" "AUSD/USD left its band" → Halcyon's checkout: "Pay in 4" "Paused", "Pay in 4 is paused by our risk guard; pay now works as usual." → **Pay now** goes through → terminal: `guard restore` → the dashboard: "Pay in 4 is open" again |
| On screen | *polaris-guardian, a Chainlink CRE workflow, reads Chainlink's AUSD/USD on Monad mainnet every minute.* *Threshold raised for demo: the owner moves the depeg bar to $1.001. The price is real.* *Only new Pay in 4 plans pause. Pay now keeps working.* |
| Voiceover | "Credit only opens while the dollar holds its peg. A Chainlink CRE workflow reads the real AUSD price on Monad mainnet and reports to our contracts. For the demo we move the bar above today's price: new Pay in 4 plans pause, and Pay now keeps working. Put it back, and credit reopens." |
| Command | Take B: `DEMO_FAST_PLANS=1 pnpm demo:local`, then `node scripts/demo-chainlink.mjs guard raise` (it waits for the guardian's attestation) and, after the Pay now shot, `node scripts/demo-chainlink.mjs guard restore`. `guard status` prints the guard's state at any time ([`scripts/demo-chainlink.mjs`](../../scripts/demo-chainlink.mjs)) |
| Reference | [`18-dashboard-chainlink-workflows.png`](../demo/chainlink/18-dashboard-chainlink-workflows.png), [`08-dashboard-chainlink-paused.png`](../demo/chainlink/08-dashboard-chainlink-paused.png), [`10-paused-shop-checkout.png`](../demo/chainlink/10-paused-shop-checkout.png), [`11-paused-pay-now-still-works.png`](../demo/chainlink/11-paused-pay-now-still-works.png), [`12-dashboard-chainlink-resumed.png`](../demo/chainlink/12-dashboard-chainlink-resumed.png) |

### 7. Sign again: the instant retry (2:10–2:30)

Set up off camera, in take B, before scene 6's pause (a paused guard refuses
new plans):

1. In profile 1, buy at Halcyon with Pay in 4 (as in scenes 2 and 3). With
   `DEMO_FAST_PLANS=1` the first payment falls due about a minute later.
2. Within that minute, revoke the buyer's approval (the buyer's own
   transaction, as a wallet's "revoke" would):
   `DEMO_BUYER_KEY=<the app's dev signer key> node scripts/demo-chainlink.mjs lose-approval`.
   The key is the local dev signer's, in profile 1's DevTools → Application →
   Local Storage → `polaris.dev-signer.v1`. Do this off camera; never show it.
3. The collections cron's next run cannot collect ("allowance_lost"), and the
   app asks the buyer to sign again.
4. Record scene 7 within 15 minutes of that missed payment:
   `DEMO_FAST_PLANS=1` sets a 15-minute grace, after which the collections run
   liquidates the plan. Scene 6 fits in between (Pay now, and signing again,
   work while Pay in 4 is paused).

| | |
|---|---|
| Shots | The app's Home: "Sign again to pay your instalment" → "Sign again" → Confirm → the plan: "Collected" "Your payment went through 2 s after you signed." → the terminal tailing `.demo/logs/cre-collections.log`: the "log trigger: Reauthorized" line, then "log written: 1 checked, 1 collected" → the dashboard's Chainlink page listing it as an instant retry |
| On screen | *A payment failed because an approval was reset. One confirm, and a Chainlink CRE log trigger collects it in about 2 seconds, not at the next retry 6 hours later.* |
| Voiceover | "If a payment can't be taken, the buyer signs once, and the collection runs on the next block, instead of hours later." |
| Command | Take B, after the three steps above. The log: `tail -f .demo/logs/cre-collections.log` |
| Reference | [`14-app-home-sign-again.png`](../demo/chainlink/14-app-home-sign-again.png), [`16-app-sign-again-confirm.png`](../demo/chainlink/16-app-sign-again-confirm.png), [`17-app-plan-collected.png`](../demo/chainlink/17-app-plan-collected.png), [`19-dashboard-chainlink-runs.png`](../demo/chainlink/19-dashboard-chainlink-runs.png) |

### 8. On Monad testnet: the CRE reports (2:30–2:50)

| | |
|---|---|
| Shots | A terminal with the CRE CLI's run of the log trigger ("Reauthorized: … re-signed", "wrote 1 tasks, gas limit 326965 (estimate 284318)", "collect #1 ok") → Monadscan: the report transaction [`0x1116fbb4…292c4d`](https://testnet.monadscan.com/tx/0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d) (to Chainlink's forwarder, `ReportProcessed` for `CollectionsReceiver`) → the guardian's run ("Chainlink AUSD / USD on monad-mainnet: 0.99982194", "GuardianReceiver accepted it: feed round 1, Pay in 4 open") → Monadscan [`0x015bd95d…3f9080`](https://testnet.monadscan.com/tx/0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080) → the PolarisCheckout contract page [`0x3874…C70B`](https://testnet.monadscan.com/address/0x3874ef1bcE222755525a96f8284631780b9bC70B) |
| On screen | *Monad testnet, 28 Sep 2026: `cre workflow simulate --broadcast`, three reports delivered through Chainlink's forwarder.* *Gas limit = estimate + 15%: Monad charges for the limit.* *Every buyer action was a signature; the relayer paid the gas.* |
| Voiceover | "This is the same code on Monad testnet. The CRE CLI ran our workflows and delivered three signed reports: an instant collection, a scheduled one, and the guardian's price check from Monad mainnet." |
| Command | Take C: see below |
| Reference | [`collections-retry-081620.log`](../../workflows/evidence/2026-09-28/collections-retry-081620.log), [`guardian-081657.log`](../../workflows/evidence/2026-09-28/guardian-081657.log), [`workflows/evidence/2026-09-28/README.md`](../../workflows/evidence/2026-09-28/README.md) |

**Take C, recorded (costs nothing, recommended).** Show the committed runs
from 28 Sep 2026 and open their transactions on Monadscan:

```bash
cat workflows/evidence/2026-09-28/collections-retry-081620.log
cat workflows/evidence/2026-09-28/guardian-081657.log
```

Caption the date. The CLI's own log lines are stamped 5 h 30 min ahead of
the UTC times the evidence script recorded (they appear to be the machine's
local time, marked "Z"), so quote times from
[`runs.json`](../../workflows/evidence/2026-09-28/runs.json), not the log.

**Take C, live (only if the team decides to).** These send real
transactions to Monad testnet from the CRE transmitter key in
`workflows/.env` (`CRE_ETH_PRIVATE_KEY`, funded with 1 testnet MON on 28 Sep), and
need `cre login` ([`workflows/README.md`, "Simulate"](../../workflows/README.md#simulate)):

```bash
pnpm --filter @polaris/cre-workflows collections:loop --broadcast   # polaris-collections every minute
pnpm --filter @polaris/cre-workflows guardian:loop --broadcast      # polaris-guardian every minute
pnpm --filter @polaris/cre-workflows retry:listen --broadcast       # collections' log trigger, live
```

Each run is appended to `workflows/evidence/loop/`. Plan #1 on testnet was
already collected and liquidated on 28 Sep, so a live collections run
finds nothing due unless a new testnet plan is opened first
(`pnpm --filter @polaris/business smoke:testnet -- --run`, which spends the
relayer's and deployer's testnet MON); and the guardian writes only when
something changed or its heartbeat is due. An idle run writes nothing, which
is correct but not much to film.

### 9. For developers, and the close (2:50–3:00)

| | |
|---|---|
| Shots | The integration code from [`packages/sdk/README.md`](../../packages/sdk/README.md) (a checkout session and a webhook check) → end card |
| On screen | End card: **Polaris** · *Stripe for every app on Monad.* · *github.com/nickthelegend/polaris-monad* · *Built on Monad with Agora AUSD, Privy, Chainlink CRE, Nansen, Mera and Envio.* |
| Voiceover | "Ten lines to take payments. Polaris: Stripe for every app on Monad." |
| Command | none |

Sponsor names on the end card are plain text unless each sponsor's logo
guidelines allow their use.

## After recording

1. Upload publicly (YouTube, Loom or Vimeo) and put the link in
   [`writeup.md`](writeup.md) (`<VIDEO_URL>`), [`profile.md`](profile.md) and
   [`bounty-fields.md`](bounty-fields.md).
2. Replace the `[m:ss]` timestamps in [`bounty-fields.md`](bounty-fields.md)
   with the cut's real ones. They are this script's timeline until then.
3. Keep the source takes: if a judge asks, each claim in the video maps to a
   file or transaction in [`writeup.md`](writeup.md).
