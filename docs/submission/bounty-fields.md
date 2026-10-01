# Per-bounty fields, ready to paste

Each bounty on the portal asks its own questions, and their wording can only
be read after logging in. What is known: every answer takes up to 4,000
characters, and evidence items are a repository, a demo, a video, a document
or a file ([`sources.md`](sources.md#the-portal)). So this page gives, for
each bounty, the answers a sponsor is most likely to ask for: a short
description, how the sponsor's technology is used, links to the code,
contract addresses, transaction hashes and the video's timestamps.

Every answer is a plain-text block with full URLs, because a form will not
follow relative links. `pnpm docs:check` checks that each block fits in 4,000
characters, that every GitHub URL names a file in this repository, and that
every hash and address is in the committed evidence.

**Before you paste:**

1. Merge this branch into `main` and push: the URLs below point at `main`.
2. Log in, read each bounty's questions, and match them to the blocks below.
   Where the portal's wording of a requirement differs from
   [`docs/plan.md` §3](../plan.md#3-sponsor-strategy), the portal wins; adjust
   the answer and [`writeup.md`](writeup.md).
3. Replace `<VIDEO_URL>`, `<APP_URL>` and `<PRIVY_APP_ID>`, and turn the
   `[m:ss]` timestamps (this script's plan, from
   [`video-script.md`](video-script.md#the-timeline)) into the cut's real ones.
4. If a "not done yet" item gets done before the deadline (hosting, Envio
   Cloud, a live underwriting report, `PolarisSplit` on testnet, the Android
   app on a real phone), update its answer here and in the write-up, with the
   new transaction hashes.
5. At the commit you submit, run `pnpm docs:diffstat` and paste the table it
   prints into [`writeup.md` §5](writeup.md#5-whats-new-in-metropolis) with
   the new totals (the committed figures stop at `ae2ce19`, 28 Sep 2026), then
   `pnpm docs:check`.

## Evidence items (every bounty)

| Kind | Value |
|---|---|
| repository | https://github.com/nickthelegend/polaris-monad |
| video | `<VIDEO_URL>` |
| document | https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md |
| demo | `<APP_URL>` once the app is hosted (it is not yet; the steps are in [`docs/deploy.md`](../deploy.md), [README, step 6](../../README.md#what-only-you-can-do)); until then, the video |

## Monad Track 02

The track's own fields: the project description is in
[`profile.md`](profile.md). If the portal asks how the project uses Monad:

```text
Polaris runs on Monad testnet (chain 10143). Twelve contracts, deployed 28 Sep 2026 and read back on chain (65 of 65 checks), carry every payment: PolarisCheckout (Pay now, Pay in 4, Subscribe, sign again), PolarisLoanEngine (the Pay in 4 pool that pays the merchant in full up front), ScoreManager (the credit score, computed on chain), PolarisSend (send by link), MerchantRegistry, PolarisPayments, CollateralVault (redeployed the same day with lockWithPermit, so even collateral is gasless), BatchSettlement, three Chainlink CRE receivers, and the labelled mock dollar. Every contract's source is verified on Monadscan: 14 of 14 exact matches, including the two the redeploys replaced.

Why Monad: Pay in 4 is many small writes (an origination, four collections, retries), which only pays where each write is cheap and final; checkout and cross-border sends need instant finality; our Solidity deploys unchanged on an EVM chain; and dollars on Monad take signature approvals (ERC-2612, ERC-3009), so every buyer action is a signature and our relayer pays the gas. The buyer never holds MON.

Monad-specific engineering: Monad charges for the gas limit, not gas used, so the relayer and every CRE write set the limit to the estimate plus 15%. Our Chainlink CRE guardian reads Chainlink's AUSD/USD feed on Monad mainnet and writes its verdict to Monad testnet in one run.

On testnet, our smoke test ran every buyer and merchant action through our API and a policy-locked Privy server wallet as the relayer, 14 of 14: registration, Pay now, collateral, Pay in 4, a subscription and its cancellation, an early instalment, a re-signed approval, a send by link and its claim, and a withdrawal. Five fresh accounts signed every step and ended as they began, with 0 MON and nonce 0. Three Chainlink CRE workflow runs delivered signed reports. The dollar on testnet is a clearly labelled mock (MockAUSD), because we held no testnet AUSD.

Also built, on our local chain only so far: split the bill (Track 02's third example idea): one link, each friend pays exactly their share straight to whoever paid. PolarisSplit is not deployed on testnet yet.

Deployment record: https://github.com/nickthelegend/polaris-monad/blob/main/packages/contracts/deployments/monad-testnet.json
Source verification: https://github.com/nickthelegend/polaris-monad/blob/main/packages/contracts/deployments/monad-testnet.verification.json
The gasless run, every hash: https://github.com/nickthelegend/polaris-monad/blob/main/docs/demo/testnet/README.md
Every address and transaction: https://github.com/nickthelegend/polaris-monad/blob/main/README.md#monad-testnet-deployment
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#monad-track-02
```

**Contract addresses** (chain 10143):

```text
PolarisCheckout      0x3874ef1bcE222755525a96f8284631780b9bC70B
PolarisLoanEngine    0xDaf74fa6A5cF2e03DF8E12613a8c8BF3A569204a
ScoreManager         0xB3D34eF62Cb64b985C230079D2815787619E6061
PolarisPayments      0x7C774CF3E664B10057Cb2dDa66bA298e831292F1
PolarisSend          0x67D336c69881A4f3Fa4aaa2909cfcD95178DfC55
MerchantRegistry     0x40A351282C9843C49f5Dd788d730a3d9Fe7627B4
CollateralVault      0xC2F006aE9836a700CE8F1e457d11346cc42e23dc
BatchSettlement      0x4F9478C66a82cEb1e1F8fE0117849e3F330cfc53
CollectionsReceiver  0x4201C0837f3bB4e0E1A982C5666BF00b5EE145CC
UnderwritingReceiver 0x523e9791d0e324525F66F91b21B478C18e284a19
GuardianReceiver     0x4c99136634F670cd59E73fc284fED164C662e3Df
MockAUSD (labelled mock dollar) 0x3F9554F15f58Bb5900822224f37A05be81eF9723
Relayer (Privy server wallet)        0x8366916019bc5452e62A0D36418ABebB45396aE2
Registry admin (Privy server wallet) 0xa089EeEA5B1625C586380596bde502aB46F3e45F
Every contract's source is verified (the Contract tab).
Explorer: https://testnet.monadscan.com
```

**Transaction hashes:**

```text
Sent by the Privy relayer; the user only signed:
Merchant registers: 0x576f4ead74715bfc8038e9d9d6ea87e4f1dd8f5f934d5efa2380fa7e8e833c74
Pay now $25: 0xedc91c93521bec8bb5ade52c2de7f0bdb654f2176aeb685b6ac73d2b28c22e6e
Collateral locked by permit: 0x2efc674a32e4c3403288aa83f99ea5913a80ab10a796dfbe4a510d6f2d04d5fc
Pay in 4 $200, plan #2: 0x70cd0468cb0eeeb95fe5c9854e50dd6810f87c8412399b72955858a68dabdf06
Subscribe $5 a month: 0xda41c41fc87de25b27c9c9413ecd612f4ad7645ddc3790b9a77bb2634a3f9224
Instalment paid early: 0x557e6f997e8aa028e85860cb7073d6fa84c98fc2477ad7ee799c251654f9504d
A lost approval signed again (Reauthorized): 0xc34da0c3d6f2744e04f1ffb46e3cc73694947be4c20ccf9bd86604cc17b7fd19
Send $10 by link: 0xc262b2838ea22630eff5873d0907ec88eb4240a333f07be77122262d619f5913
Claimed: 0x30ee00250e065a8081da4360c5c18ed9a123d2bc57d65413d8ae8e6030c8119a
Merchant withdraws $100: 0x5ab0ecc02861ca4354f74d7d9dfac42792d72207de3c15158136cf8d540b7f48
Earlier, by the dev relayer: plan #1 0x4af4234818aec669b3974c5c44f0f5cbe900858aa6e1e76bb413720374d2522d and its re-signed approval 0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002, which fired the CRE log trigger below
Chainlink CRE report, instant collection (EVM log trigger): 0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d
Chainlink CRE report, scheduled collection (cron): 0xd7bcf41e8efa7841c86870689a3c9599c3a960d39f4c28b82c6980dc1f1a97e4
Chainlink CRE report, guardian attestation (cron): 0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080
PolarisCheckout deployed: 0x5df039074ed9a5b6e11c517955b42393a430d369a12c554096316a1d64dc020c
```

**Video:** [2:30] Monad testnet on Monadscan: the CRE reports and the gasless
run through the Privy relayer; [0:10]–[1:40] the product (on a local chain,
labelled).

## Agora

**Short description:**

```text
Polaris lets anyone send dollars across borders by link, pay any merchant by link (in full or in four instalments), and split a bill with friends abroad by link. Face ID creates the account (Mera), every step is a signature our relayer carries, settlement is final on Monad in under a second, and the app comes as an Android app and a phone PWA.
```

**How AUSD and cross-border payments are used:**

```text
Send by link: the sender types an amount and gets a link to share (WhatsApp, anywhere). The link carries a one-time key in its URL fragment, which never reaches our server. PolarisSend escrows the dollars against that key using the sender's ERC-3009 signature; to claim, the key signs the recipient's address, so nobody watching the transaction can redirect it, and a link pays out once. The recipient abroad opens it, taps Face ID, and the dollars have arrived: no account needed first, no fee. The sender can cancel, and an expired link returns only to the sender.

Pay by link: a merchant's payment link is the same mechanism pointed at a business, with Pay now, Pay in 4 (10% APR; $200 is 4 x $50.38) and subscriptions.

Split the bill: one link, and each friend, wherever they are, pays exactly their share in dollars straight to whoever paid, with one signature (PolarisSplit, no custody); a friend with no account makes one with Face ID in the same step.

AUSD everywhere: balances, payments, the Pay in 4 pool, credit lines and payouts are all one dollar, and the app signs AUSD's own EIP-712 domain ("Agora Dollar", version 1) for ERC-2612 permits and ERC-3009 authorizations, checked against the Solidity typehashes (53 checks). The buyer's home screen names it once, as "USD" and "AUSD"; everywhere else it is dollars.

Local currency: under every amount, the viewer's currency at the live Chainlink rate with its age ("ARS 161.241, Chainlink rate, 7 h ago, indicative"), read server-side from Chainlink Data Feeds; no feed, no line.

Mobile app: an Android app (a Trusted Web Activity built with Bubblewrap, package app.polarispay.twa, signed APK) around the same app, so Face ID is Chrome's own passkey ceremony and one account works in Chrome, the installed PWA and the Android app; plus Send and Receive shortcuts.

Honest status: on Monad testnet, a $10 send by link and its claim ran through our API and a Privy server wallet relayer, with sender and recipient holding 0 MON before and after; that run was scripted, and the app itself has run send and claim end to end on our local chain (same contracts, same deploy script), because it is not hosted yet. The dollar on testnet is a labelled mock (MockAUSD) because we held no testnet AUSD; a redeploy with AUSD_MODE=ausd switches to real AUSD. Split the bill runs on our local chain only; PolarisSplit is not on testnet yet. The Android APK is built and signed but not yet tried on a real phone or published to Google Play.

PolarisSend: https://github.com/nickthelegend/polaris-monad/blob/main/packages/contracts/contracts/PolarisSend.sol
Its tests (watched claims, replays, expiry): https://github.com/nickthelegend/polaris-monad/blob/main/packages/contracts/test/metropolis/PolarisSend.test.js
Send and claim in the app: https://github.com/nickthelegend/polaris-monad/blob/main/apps/app/src/sheets/send.tsx and https://github.com/nickthelegend/polaris-monad/blob/main/apps/app/src/sheets/claim.tsx
Send and claim on testnet: https://github.com/nickthelegend/polaris-monad/blob/main/docs/demo/testnet/README.md
Split the bill: https://github.com/nickthelegend/polaris-monad/blob/main/docs/design/split/README.md
Android app: https://github.com/nickthelegend/polaris-monad/blob/main/apps/android/README.md
Chainlink rates: https://github.com/nickthelegend/polaris-monad/blob/main/packages/fx/README.md
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#agora
```

**Contract addresses:**

```text
PolarisSend (send by link)  0x67D336c69881A4f3Fa4aaa2909cfcD95178DfC55
PolarisCheckout (pay by link) 0x3874ef1bcE222755525a96f8284631780b9bC70B
MockAUSD (labelled mock of AUSD, same EIP-712 domain) 0x3F9554F15f58Bb5900822224f37A05be81eF9723
```

**Transaction hashes:**

```text
PolarisSend deployed: 0x9f81549cd07cf46f018c77f175f596ab7cf535f484f87bf6079ce57fb84924b9
Send $10 by link (sender holds no MON; Privy relayer): 0xc262b2838ea22630eff5873d0907ec88eb4240a333f07be77122262d619f5913
The link claimed (recipient holds no MON; Privy relayer): 0x30ee00250e065a8081da4360c5c18ed9a123d2bc57d65413d8ae8e6030c8119a
Pay now by link, relayed: 0xedc91c93521bec8bb5ade52c2de7f0bdb654f2176aeb685b6ac73d2b28c22e6e
Pay in 4 by link, relayed: 0x70cd0468cb0eeeb95fe5c9854e50dd6810f87c8412399b72955858a68dabdf06
```

**Video:** [1:10] send by link, the amount in pesos at Chainlink's rate;
[1:25] the claim on a phone, "Arrived."; [0:25] the account created in one
tap.

**Android APK:** if the portal takes a file, attach
`apps/android/dist/polaris-1.0.0-debug.apk` from `pnpm --filter
@polaris/android build` (git-ignored, so build it first; [`apps/android`](../../apps/android/README.md#build-it)).

**Questions for Agora** (ask before submitting): does the Android app (a
Trusted Web Activity) or the PWA meet "a mobile app", and can we get testnet
AUSD for the pool?

## Privy

**Short description:**

```text
Polaris for Business runs on Privy beyond login: the relayer that carries every payment on Monad testnet is a Privy server wallet locked by a policy (live, 14 of 14 actions gasless for users who never held MON), a second policy-locked server wallet administers the merchant registry, every merchant gets an embedded wallet that signs its on-chain registration and its payouts, and automatic payouts run through a per-merchant policy.
```

**How Privy is used:**

```text
1. Sign-in: Privy (email) for merchants; every dashboard route verifies the Privy access token server-side with @privy-io/node, so nothing a client sends can name a merchant or a wallet.

2. Embedded wallets that do real work: every merchant gets one at sign-in (createOnLogin: all-users). It signs the merchant's MerchantRegistry registration right after the business is named, and every withdrawal (an ERC-3009 authorization); our relayer submits both, so the merchant never holds MON.

3. Policy-locked server wallets, live on Monad testnet: the relayer that carries every payment is a Privy server wallet (0x8366916019bc5452e62A0D36418ABebB45396aE2). Its 17-rule policy is built from one allow-list: one DENY for any transaction carrying MON, then one ALLOW per Polaris function (chain, contract, function, a $0.10 floor where an amount is signed); anything else matches no rule and Privy refuses it in its enclave. The wallet and the policy are owned by an admin key quorum; the server's key is a separate quorum held to the same policy, so a stolen server key cannot change it. A second server wallet, the registry admin (0xa089EeEA5B1625C586380596bde502aB46F3e45F), owns MerchantRegistry and may only activate a merchant and cap it at up to $1,000. The same allow-list is enforced in our code before anything is signed.

4. Automatic payouts, Stripe-style: turning them on creates the merchant's own policy (only the dollar, only this chain, only from their wallet, only to their payout address, at most $10,000 a payout), and the browser adds our payout signer under it with addSigners. The daily sweep refuses to run if the wallet no longer lists our signer with that exact policy.

Proof, on Monad testnet: privy:prove-policy had Privy sign the 3 allowed calls and refuse all 7 others with policy_violation (a $0 collateral lock, the vault's seize, a $0 transfer, the same call carrying 1 wei of MON, the same call to another contract, approve(attacker, max), a plain MON transfer). Our smoke test ran every buyer and merchant action through the Privy relayer, 14 of 14: 15 transactions from the relayer and 2 from the registry admin, for five fresh accounts that stayed at 0 MON and nonce 0. 264 tests in apps/business.

Honest status: in those runs the merchant was a generated key signing the same typed data its embedded wallet signs; no merchant has signed in through Privy on a hosted dashboard yet, and no automatic payout has run live, because the apps are not hosted yet.

Live setup (every id, address and rule): https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/privy-live.md
What Privy refused: https://github.com/nickthelegend/polaris-monad/blob/main/docs/demo/testnet/privy-prove-policy.txt
The gasless run: https://github.com/nickthelegend/polaris-monad/blob/main/docs/demo/testnet/README.md
Relayer policy: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/server/policy/relayer.ts
Server wallet signer: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/server/relayer/signer.ts
Setup script: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/scripts/privy/setup-relayer.mjs
Payout policy: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/server/policy/payout.ts
Embedded wallet, registration and withdrawals: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/lib/payouts.ts
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#privy
```

**Privy app ID:** `<PRIVY_APP_ID>` (the public client id,
`NEXT_PUBLIC_PRIVY_APP_ID` in `apps/business/.env.local`; never the app
secret).

**Server-wallet policy JSON:** attach
[`docs/demo/testnet/privy-live.json`](../demo/testnet/privy-live.json) (both
live policies rule by rule, read back from Privy with `privy:show`) and
[`privy-prove-policy.txt`](../demo/testnet/privy-prove-policy.txt) (what
Privy signed and refused). `pnpm --filter @polaris/business
privy:setup-relayer` (a dry run) prints the same policy as the code builds it.

**Relayer transactions** (the Privy server wallet
[`0x8366916019bc5452e62A0D36418ABebB45396aE2`](https://testnet.monadscan.com/address/0x8366916019bc5452e62A0D36418ABebB45396aE2)):

```text
Privy relayer (server wallet y8sa671n804anaxznbeneh2q): 0x8366916019bc5452e62A0D36418ABebB45396aE2
privy:smoke, a $0.50 Pay now, buyer at 0 MON: 0x5ef22fced32a6c4d2192a25691caddbf604700934bd505a35830e77922c4f983
Pay in 4 $200: 0x70cd0468cb0eeeb95fe5c9854e50dd6810f87c8412399b72955858a68dabdf06
Send by link: 0xc262b2838ea22630eff5873d0907ec88eb4240a333f07be77122262d619f5913
Merchant registers (its Registration signature, relayed): 0x576f4ead74715bfc8038e9d9d6ea87e4f1dd8f5f934d5efa2380fa7e8e833c74
Merchant withdraws $100: 0x5ab0ecc02861ca4354f74d7d9dfac42792d72207de3c15158136cf8d540b7f48
Registry admin (server wallet jznn8nzfi7xuc2ywij67ktld) activates the merchant: 0x0b9e45ffe03c3bea14d1b4866473f7dfb9f62dbd1cfac95628de3e5884bb1cb1
Every transaction of the run (15 by the Privy relayer, 2 by the registry admin, 2 by the labelled harness): https://github.com/nickthelegend/polaris-monad/blob/main/docs/demo/testnet/README.md
```

**Video:** [0:55] the merchant dashboard (in the demo it runs on a local
session with Privy off; record a Privy sign-in insert if the dashboard is
hosted before recording); [2:30] the Privy relayer's transactions on
Monadscan.

## Chainlink CRE

**Short description:**

```text
Three Chainlink CRE workflows are Polaris's credit engine on Monad: one underwrites a buyer when they ask for Pay in 4 (HTTP trigger), one collects instalments on schedule and the moment a dunned buyer signs again (cron and EVM log triggers), and one pauses new plans when Chainlink's AUSD/USD on Monad mainnet depegs or the pool runs short (cron).
```

**How CRE is used as an orchestration layer:**

```text
Polaris is Stripe for every app on Monad, with Pay in 4 built into checkout. Chainlink CRE runs its credit, with all three trigger types, and every report changes what the product does next.

polaris-underwrite (HTTP trigger): when a buyer taps Raise your limit, our API fires it. It verifies the buyer's signed consent and their history wallet's proof, reads what the chain would refuse, calls Nansen, Zerion and Etherscan (through Confidential HTTP when switched on), and attests facts, never a score. ScoreManager computes the score on chain and caps the opening line at $1,000. Without a report, no unsecured credit opens.

polaris-collections (cron): finds due Pay in 4 instalments, subscription renewals and plans past grace, checks them at a finalized block, and collects, charges or liquidates in one signed report; failures feed the dunning ladder and a signed callback to our API.

polaris-collections (EVM log trigger on PolarisCheckout.Reauthorized): a buyer whose approval was lost signs once, and the log starts a run that collects what they owe in the next block instead of 6 hours later. In our local demo: 2 seconds after signing.

polaris-guardian (cron): reads Chainlink's AUSD/USD feed on Monad mainnet and the pool on Monad testnet in one run, and attests a verdict (depeg outside $0.995 to $1.005, low free cash, bad debt, stale price). PolarisCheckout.openPlan asks GuardianReceiver before every new plan; Pay now, Send and Subscribe never ask. The receiver reads the pool itself and trusts the report only for the mainnet price.

Evidence on Monad testnet, 28 Sep 2026: cre workflow simulate --broadcast (CLI v1.35.0, SDK 1.22.0) delivered three reports through Chainlink's monad-testnet forwarder, each read back with ReportProcessed result=true: the log-triggered collection, the cron collection, and the guardian's first attestation (AUSD/USD 0.99982194 from Monad mainnet). The underwriting run correctly wrote nothing: without provider keys it returned "incomplete" instead of guessing. Logs and hashes are committed.

Tests: 209 unit tests on the SDK's test runtime; e2e:local 12 of 12 against real contracts; all three compile to WASM.

Not done yet: deployment to a DON (deploy access is not enabled for our organisation yet; simulated reports are accepted only from our dedicated transmitter until the receivers are locked to the production forwarder); an underwriting report on testnet and a live Confidential HTTP call (both need provider API keys).

Workflows: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/README.md
Evidence: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/README.md
Receivers: https://github.com/nickthelegend/polaris-monad/tree/main/packages/contracts/contracts/cre
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#chainlink-cre
```

**Workflow source:**

```text
polaris-underwrite: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/underwriting/main.ts and https://github.com/nickthelegend/polaris-monad/tree/main/workflows/src/underwriting
polaris-collections: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/collections/main.ts, https://github.com/nickthelegend/polaris-monad/blob/main/workflows/src/collections/workflow.ts and the log trigger https://github.com/nickthelegend/polaris-monad/blob/main/workflows/src/collections/retry.ts
polaris-guardian: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/guardian/main.ts and https://github.com/nickthelegend/polaris-monad/blob/main/workflows/src/guardian/workflow.ts
Project settings (Monad testnet and mainnet targets): https://github.com/nickthelegend/polaris-monad/blob/main/workflows/project.yaml
```

**Simulation logs and transactions** (Monad testnet, 28 Sep 2026):

```text
Log trigger, instant collection: 0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d (block 66359311)
  log: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/collections-retry-081620.log
  fired by the buyer re-signing: 0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002
Cron, collected one instalment and liquidated a plan past grace: 0xd7bcf41e8efa7841c86870689a3c9599c3a960d39f4c28b82c6980dc1f1a97e4 (block 66359350)
  log: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/collections-081643.log
Guardian, Chainlink AUSD/USD from Monad mainnet, attested healthy (round 1): 0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080 (block 66359401)
  log: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/guardian-081657.log
Underwriting: ran, returned "incomplete" without provider keys, wrote nothing (by design)
  log: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/underwriting-082225.log
All runs: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/evidence/2026-09-28/runs.json
```

**Receivers and Chainlink addresses:**

```text
CollectionsReceiver  0x4201C0837f3bB4e0E1A982C5666BF00b5EE145CC (deployed 0x0ac454dd6f28fea4ef998bbf63f0cc72e9d84ecc4cf725b8077dd3cf04bcc379)
UnderwritingReceiver 0x523e9791d0e324525F66F91b21B478C18e284a19 (deployed 0xf643b392792f7f2a0c07edbf8e91a469e463fd065a9ef5d40b8bc59862f64c4a)
GuardianReceiver     0x4c99136634F670cd59E73fc284fED164C662e3Df (deployed 0x2be128a399ed2034f2fffe8caba46519bc5c6f116625b9cff364977ad27038bf)
Chainlink simulation forwarder, Monad testnet: 0xB9F79d863261869B234c481D1f9A7af84AeAd192
Chainlink AUSD/USD, Monad mainnet (read by the guardian): 0xE20751C7B5867bCBef815ffc1b284c3f412a9e13
```

**Video:** [0:25] *Raise your limit* runs `polaris-underwrite` (a local run,
labelled); [1:40] the guardian pauses and resumes Pay in 4; [2:10] the
instant retry; [2:30] the three reports on Monad testnet.

## Nansen

**Short description:**

```text
Nansen's data decides how much Pay in 4 credit a Polaris buyer gets. It never reaches the buyer as a table: it becomes facts a Chainlink CRE workflow attests, a score computed on chain, and plain-language reasons in the checkout.
```

**How Nansen is used:**

```text
When a buyer asks to raise their Pay in 4 limit, they can link a wallet they already use. Our Chainlink CRE underwriting workflow asks Nansen's Profiler about it:

- first-funder: dates the wallet (its age earns up to 60 points), names the exchange it was first topped up from (+10, shown to the buyer as "First topped up from a major exchange, from Nansen"), and names the funder the sybil check runs on.
- related-wallets on that funder: the sybil check. 4 to 24 accounts from one non-exchange funder cost up to 80 points; 25 or more decline the line.
- the funder's label: a wallet first funded through a mixer or by an exploiter is not counted as history.
- current balance and transactions: fallbacks when Zerion cannot answer.

The facts go into a signed CRE report; ScoreManager computes the score on chain and caps the opening line at $1,000 (higher lines come only from repaying). The buyer then sees their line and the reasons behind it, explained from the facts in that report, in the checkout, on their credit screen, and on the merchant's dashboard ("Why your buyers got credit"). Every reason Nansen backs carries provider "nansen", so the app credits it. Take Nansen away and a linked wallet cannot be underwritten: it is a credit decision, not a data view.

Honest status: we had no Nansen API key while building, so every run so far read synthesized fixtures in Nansen's documented response shapes, each labelled "FIXTURE: synthesized". With a key, one command records real responses. Nansen covers Monad mainnet, so it scores the buyer's linked history wallet; a new testnet account goes through Zerion.

Nansen client: https://github.com/nickthelegend/polaris-monad/blob/main/packages/underwriting/src/core/providers/nansen.ts
Why Nansen is load-bearing: https://github.com/nickthelegend/polaris-monad/blob/main/packages/underwriting/README.md#why-nansen-is-load-bearing
The reasons the buyer sees: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/server/credit/explain.ts
The score on chain: https://github.com/nickthelegend/polaris-monad/blob/main/packages/contracts/contracts/ScoreManager.sol
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#nansen
```

**Contract addresses:** `ScoreManager`
`0xB3D34eF62Cb64b985C230079D2815787619E6061`, `UnderwritingReceiver`
`0x523e9791d0e324525F66F91b21B478C18e284a19` (Monad testnet).

**Video:** [0:25] the limit and its reasons, "from Nansen" (sample history in
the local run, captioned).

**Ask Nansen** for hackathon credits: the free plan is 100 one-time credits
plus 10 a day ([`docs/plan.md` §3.4](../plan.md#34-stack-ons-small-extra-work-real-money)).

## Mera

**Short description:**

```text
Mera is the whole account layer of the Polaris consumer app: Face ID creates a normal account from a passkey, with no seed phrase, no extension and no custody backend. Creating an account and paying is one Face ID.
```

**How Mera is used:**

```text
The Polaris app's accounts are Mera passkeys. Continue with Face ID calls createPasskeyWithPrfOutput; the passkey's PRF output becomes the account's key in the browser (Face ID, PRF, BIP-39 entropy, m/44'/60'/0'/0/0), and createSecp256k1SigningSession gives a viem account that signs every payment. The key is zeroed after use and never stored: only public metadata (the credential id, the rpId, the address) is kept, and every sign-in recomputes the key. The same passkey gives the same account on every device it syncs to.

No seed phrase, no extension: a plain web page, installable as a PWA, and an Android app that is a Trusted Web Activity around the same page, so Face ID there is Chrome's own passkey ceremony and the same passkey opens the same account. No custody backend: every money movement is the account's own EIP-712 or ERC-3009 signature; our relayer only pays gas and holds no user funds. Unsupported browsers get "Open Polaris on your phone" with a QR code, and in-app browsers are told to open Safari or Chrome.

A new buyer at a shop meets Face ID inside the checkout: Pay in 4, Raise your limit, Continue with Face ID, and one tap creates the account and asks for the line.

Honest status: our recorded demo runs on a local chain with a dev signer standing in for Face ID (a badge on every screen says so), because Face ID on a phone needs the app on an HTTPS domain inside its passkey domain, and it is not hosted yet. The dev signer only exists in development; a production build removes it. The app also offers Continue with email (a Privy embedded wallet) beneath Face ID; if that conflicts with "the entire account layer", tell us and we remove it.

Mera accounts: https://github.com/nickthelegend/polaris-monad/blob/main/apps/app/src/lib/account/mera.ts
Key derivation: https://github.com/nickthelegend/polaris-monad/blob/main/apps/app/src/lib/account/derive.ts
Supported devices: https://github.com/nickthelegend/polaris-monad/blob/main/apps/app/README.md#supported-devices
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#mera
```

**Supported devices** (from the app's README): iPhone on iOS 18+ (Safari or
Chrome, iCloud Keychain); Android with Chrome or Edge (Google Password
Manager); Mac on macOS 15+; Windows 11 25H2+; 1Password, Proton Pass,
YubiKey 5. Not supported: desktop Chrome's local profile, Bitwarden,
Dashlane, in-app browsers.

**Video:** [0:25] the account created in one tap (the dev signer stands in
for Face ID in the local demo; captioned).

**Question for Mera** (ask before submitting): is the email option beside
Face ID acceptable?

## Envio

**Short description:**

```text
An Envio HyperIndex indexer turns every Polaris event on Monad into the rows the product reads: the Chainlink CRE collections workflow's list of what is due, the merchant dashboard's feed, and the webhooks that tell a merchant they were paid.
```

**How Envio is used:**

```text
packages/indexer is an Envio HyperIndex indexer (envio 3.12.1, HyperSync on Monad testnet) for every Polaris contract, configured with our deployed testnet addresses from block 66288120. It has a GraphQL schema of payments, plans, instalments, subscriptions, payouts, sends, credit scores and CRE collection runs, typed handlers, and a webhook outbox that emits exactly polarispay-sdk's events (payment.succeeded, plan.opened, installment.collected and so on). Handler tests run in CI.

Behind core features:
- Collections: the Chainlink CRE collections workflow takes its candidate list (due instalments, retries on the dunning ladder, plans past grace, renewals) from the indexer's DUE_CANDIDATES query; the chain then disposes. Without it, the workflow scans the chain's own counts.
- The merchant dashboard: its "Indexed by Envio" feed reads the indexer through our typed client (@polarispay/indexer-client) when POLARIS_INDEXER_URL is set, and the chain sync can read logs from Envio's HyperRPC.

Honest status: the indexer is not deployed to Envio Cloud yet (that needs our team's login, and the free plan's deployments expire, so we deploy close to judging). Until then the dashboard shows its own chain sync, labelled "Chain sync", and our Monad testnet CRE runs took their candidates from the chain. envio dev needs Docker, so the handler tests run in WSL or CI.

Indexer: https://github.com/nickthelegend/polaris-monad/blob/main/packages/indexer/README.md
Config: https://github.com/nickthelegend/polaris-monad/blob/main/packages/indexer/config.yaml
Schema: https://github.com/nickthelegend/polaris-monad/blob/main/packages/indexer/schema.graphql
Queries: https://github.com/nickthelegend/polaris-monad/blob/main/packages/indexer/client/src/documents.ts
The CRE candidate query in use: https://github.com/nickthelegend/polaris-monad/blob/main/workflows/src/collections/candidates.ts
The dashboard's reader: https://github.com/nickthelegend/polaris-monad/blob/main/apps/business/src/server/insights.ts
Write-up: https://github.com/nickthelegend/polaris-monad/blob/main/docs/submission/writeup.md#envio
```

**Deployed endpoint:** `<ENVIO_GRAPHQL_URL>` once deployed ([README,
step 5](../../README.md#what-only-you-can-do)).

**Video:** not shown; the indexer is not deployed. If it is before
recording, add an insert of the dashboard's "Indexed by Envio" feed.
