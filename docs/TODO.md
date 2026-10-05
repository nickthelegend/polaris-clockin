# Polaris: what's left before the deadline

Updated 6 Oct 2026. **Deadline: Tue 13 Oct 2026, 11:59 PM ET** (portal:
hackathon.monad.xyz). Feature freeze Fri 9 Oct, 18:00. Submit Mon 12 Oct;
Tue 13 is buffer only.

Legend: ✅ done · 🟡 built, a step left · ⬜ not started · 🔑 needs a team
account or key (Claude can't do it) · 🤖 Claude can do it once unblocked.

---

## 1. Where we stand

Everything below is on `main` and pushed. Every test suite is green
(contracts 601, business 276, SDK 157, shop 101, app 47, scripts 38, db 31,
receipts 16).

- ✅ 12 contracts live on **Monad testnet** and read back 65 of 65
  ([deployment](../README.md#monad-testnet-deployment)). All 14 sources
  (including two replaced contracts) are **verified on Monadscan**, exact
  matches.
- ✅ **Gasless for everyone:** the relayer is a policy-locked **Privy server
  wallet**. 14 of 14 buyer and merchant actions ran on testnet with five
  fresh accounts that never held MON
  ([run](demo/testnet/README.md)).
- ✅ **Chainlink CRE:** three workflows; three reports delivered on Monad
  testnet with `cre workflow simulate --broadcast`
  ([evidence](../workflows/evidence/2026-09-28/README.md)).
- ✅ The app (Face ID with Mera), Polaris for Business, the Halcyon demo
  shop, the landing page, SDK 0.3.0, webhooks, Pay now / Pay in 4 /
  Subscribe / Send / Claim / one-tap withdraw.
- ✅ **Android app** (Trusted Web Activity, one-command signed APK).
- ✅ **Receipts only you can read** (Mera *One Passkey, Many Keys*).
- 🟡 **Split the bill:** built and tested on a local chain; **not deployed
  on testnet**.
- 🟡 **Hosting:** fully prepared ([`deploy.md`](deploy.md),
  `pnpm deploy:check`), **not hosted yet**. No public URL.
- ⬜ **Demo video:** not recorded.

---

## 2. Sponsor tracks: aims and what's left

Meeting the sponsor's published requirements is **40% of each bounty score**
(technical 30%, Monad integration 20%, innovation 10%). The per-bounty
answers are ready to paste in
[`submission/bounty-fields.md`](submission/bounty-fields.md).
**Confirm each requirement's wording on the logged-in portal; where it
differs, the portal wins.**

| Bounty | Prize | What they want | What we built | Status | What's left |
|---|---|---|---|---|---|
| **Monad Track 02**: Consumer Products & Payments | $10,000 track · $25,000 overall | Consumer finance using on-chain rails as a design advantage, for non-crypto people. Public repo, licence, ≤ 3 min video, Monad integration with addresses, testnet or mainnet deployment | The whole product; credit scored on chain; merchants paid up front from the pool; claim links no one can redirect; gas never paid by users; Monad-specific gas handling | 🟡 | 🔑 Video. 🔑 Hosting (a judge needs a URL). 🔑 One uncut run on a real phone |
| **Agora**: Cross-Border Payments | $10,000 (Track 02 only) | A **mobile app** sending **AUSD across borders**, **Mera passkey onboarding**, **instant settlement** | AUSD everywhere (a labelled `MockAUSD` on testnet); send by link and claim; local currency from Chainlink FX feeds; Face ID only; installable PWA **and** Android APK; split the bill (local only) | 🟡 | 🔑 Ask Agora: does the PWA/Android app count as "mobile"? 🔑 Ask Agora for testnet AUSD (then a redeploy with `AUSD_MODE=ausd`, optional). 🔑 Install the APK on a real phone. 🤖 Deploy PolarisSplit on testnet once the deployer key is provided (optional) |
| **Privy** | $5,000 | Privy **beyond authentication** | Policy-locked server wallet relays every payment (proof: 3 allowed, 7 refused); a second server wallet administers the merchant registry; embedded merchant payout wallets; automatic payouts through a payout signer | ✅ live | 🔑 Turn on Google login and set allowed domains (after hosting). 🔑 Move `.privy-admin.key` offline and delete the file. Show Privy in the video |
| **Chainlink CRE** | $3,000 | A CRE workflow (build, simulate or deploy) used as an **orchestration layer** | `polaris-collections` (cron + EVM log trigger), `polaris-underwrite` (HTTP, Confidential HTTP), `polaris-guardian` (reads AUSD/USD on Monad mainnet, guards testnet); 3 reports delivered | 🟡 | 🔑 Request deploy access: `cre account access`. 🔑 For a real underwriting report: a Zerion key (Etherscan's is set) and a consenting wallet with ≥ 90 days and ≥ 10 txs on Ethereum or Base as `POLARIS_UNDERWRITE_WALLET_KEY` in `workflows/.env`; then 🤖 `pnpm --filter @polaris/cre-workflows evidence --only underwriting` and docs |
| **Nansen** | $5,000 pool | A product powered by Nansen data that goes **beyond exposing raw data** | Nansen facts (first funder, counterparties, related wallets) become an on-chain credit score with plain-language reasons ("Funded from a major exchange · +10") | 🟡 | 🔑 Nansen API key (ask Nansen for hackathon credits). Then 🤖 `pnpm --filter @polarispay/underwriting record --linked <wallet>` to replace the synthesized fixtures, and rerun underwriting |
| **Mera UX** | $2,500 | Mera is the **entire account layer**: no seed phrase, no extension, no custody backend | Face ID → PRF → key; no server holds a key; the relayer holds only MON for gas | 🟡 | 🔑 Ask Mera: is the optional email login (Privy) acceptable? 🔑 Test Face ID on iOS 18+ and Android Chrome (needs hosting on the passkey domain) |
| **Mera: One Passkey, Many Keys** | $2,500 | Most creative **non-wallet** use of the PRF key material | The same Face ID derives an HPKE inbox key; the server stores what you bought only as ciphertext that only your Face ID opens; zero extra prompts | 🟡 | 🔑 Real-device test after hosting. Put the demo beat in the video (receipt locked, then opened). 🤖 A receipts step in `pnpm demo:e2e` once Playwright is installed |
| **Envio** | $1,000 + hosting | HyperIndex/HyperSync/HyperRPC behind a **core feature** | `packages/indexer` (HyperIndex) feeds the dashboard, webhooks and CRE collection candidates | 🟡 | 🔑 Deploy to Envio Cloud **now** (≥ 5 Oct, so it's still up on 3 Nov). Then 🤖 set `POLARIS_INDEXER_URL`, `candidates.indexerUrl` in the CRE configs, and `<ENVIO_GRAPHQL_URL>` in the kit |

**Not targeting:** Aurora Intents ($5,000; mainnet only with real funds),
Dynamic, Cleanverse, Mercuryo, Alchemy. **Ask** whether we qualify for Best
Community Team Project ($5,000).

---

## 3. The team's checklist, in order

### Now → Thu 8 Oct (everything that needs an account)

- [ ] 🔑 **Host the apps** with [`deploy.md`](deploy.md): the app, landing
      and shop on Vercel (the shop needs Upstash Redis), Polaris for Business
      on Fly.io or Railway (one machine, a volume). Then `pnpm deploy:check`.
      Never set `NEXT_PUBLIC_DEV_SIGNER` on a hosted build
- [ ] 🔑 **Envio Cloud:** log in, install its GitHub app, deploy
      `packages/indexer` (see its README)
- [ ] 🔑 **API keys** into `workflows/.env` (git-ignored): Nansen, Zerion;
      plus a consenting history wallet for underwriting
- [ ] 🔑 **Privy dashboard:** Google login on; allowed domains = the hosted
      URLs
- [ ] 🔑 **Chainlink:** `cre account access` (deploy access)
- [ ] 🔑 **Ask on discord.gg/monaddev:** Agora (PWA / Android app counts as
      mobile?), Mera (Privy email option OK?), Best Community Team eligibility
- [ ] 🔑 **Real phones:** Face ID sign-up, pay, Pay in 4, send and claim on
      an iPhone (iOS 18+) and an Android phone; install the APK
- [ ] 🔑 **Security housekeeping:** move `.privy-admin.key` (in the `live` worktree's `apps/business/`)
      offline and delete it; **rotate the Alchemy key** that is hardcoded in
      the public `polaris-solana` repo (`merchant-web/lib/constants.ts`,
      `merchant-web/components/sdk/PayWithPolaris.tsx`,
      `shopping/components/providers.tsx`). It is in git history, so rotate
      it in the Alchemy dashboard; deleting the code isn't enough
- [ ] 🔑 Optional: hand Claude the deployer key **as an env var for one run**
      (never in a file) to deploy PolarisSplit on testnet
- [ ] 🔑 Optional: claim participant perks (QuickNode, Dwellir RPCs;
      Tenderly; Zerion Builder)

### Fri 9 Oct: feature freeze 18:00

- [ ] Bug bash on an iPhone and an Android phone, on the hosted URLs
- [ ] Zero known bugs on the demo path

### Sat 10 – Sun 11 Oct: the story

- [ ] 🔑 **Record the video** (≤ 3:00, public link) from
      [`submission/video-script.md`](submission/video-script.md): nine
      scenes; show the Privy relayer's transactions, the CRE runs, the
      verified source, the sealed receipt opening
- [ ] Fill the kit's placeholders: `<VIDEO_URL>`, `<APP_URL>`,
      `<PRIVY_APP_ID>`, `<ENVIO_GRAPHQL_URL>`, the team table (`<NAME>`,
      `<ROLE>`, `<CONTACT>`, `<GITHUB>`, city and country), and the `[m:ss]`
      video timestamps in `bounty-fields.md`
- [ ] 🤖 `pnpm docs:diffstat` at the commit being submitted, then
      `pnpm docs:check`
- [ ] Someone who didn't build it follows the README from scratch

### Mon 12 Oct: submit

- [ ] Portal project fields from [`submission/profile.md`](submission/profile.md):
      name, one-liner, description, repository URL, demo URL
- [ ] Track 02 + each bounty, answers from
      [`submission/bounty-fields.md`](submission/bounty-fields.md) (each
      ≤ 4,000 characters), evidence links (repo, demo, video, docs)
- [ ] Confirm the submission shows on the portal

---

## 4. What Claude can do next

Ready now, no accounts needed:

- Add the receipts step to `pnpm demo:e2e` (after
  `pnpm exec playwright install chromium`), and run the full e2e suites
- Polish passes on the demo path with screenshots against the references
- Clean up the ~50 stale worktrees under `.claude/worktrees/`

Once the team unblocks it:

| When you've… | Claude will |
|---|---|
| hosted the apps | run `pnpm deploy:check` against the URLs, smoke-test the hosted flows, fill `<APP_URL>`, recapture screenshots |
| added the Nansen/Zerion keys and a history wallet | record real fixtures, run the CRE underwriting evidence on testnet, update the README and the kit |
| deployed Envio | wire the indexer URL into the API and CRE configs, verify webhooks and candidates come from it, fill `<ENVIO_GRAPHQL_URL>` |
| provided the deployer key for one run | `deploy-split:monad`, `verify:monad`, `check:deployment:monad`, update the record and docs |
| recorded the video | fill `<VIDEO_URL>` and the timestamps, regenerate the diffstat, final `docs:check` |

Not recommended before the freeze (each needs contract changes and a
redeploy that moves every address): per-second subscriptions, platform fees
(Connect-style), earnAUSD yield on the idle pool, a mainnet deployment.
