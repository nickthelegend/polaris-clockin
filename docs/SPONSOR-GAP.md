# Sponsor gap: each bounty's requirement, what meets it, what's left

Updated 6 Oct 2026. Requirements are from the sponsor research of 5 Oct
(`METROPOLIS-SPONSORS.md`, outside this repository: the portal's bounty
cards, read by participants) and [`submission/sources.md`](submission/sources.md);
**the logged-in portal's wording wins** where it differs. Meeting the stated
requirement is 40% of each bounty's score. The answers to paste are in
[`submission/bounty-fields.md`](submission/bounty-fields.md); the team's
checklist is [`TODO.md`](TODO.md).

Status: **met** (built, tested, and run on Monad testnet or the local chain)
· **partly** (built, one live step left) · **key** (blocked on a team key or
account). Until the team says otherwise, work stays on the local chain: no
new testnet transactions or hosting deploys.

| Bounty | Track | Stated requirement | How Polaris meets it | Status | Left for later |
|---|---|---|---|---|---|
| **Monad Track 02** | T2 | Consumer finance on chain for non-crypto people; public repo, OSI licence, ≤ 3 min video, Monad integration with addresses, testnet or mainnet deployment | The whole product; 12 contracts on testnet, verified; 14 of 14 actions gasless through the Privy relayer; MIT licence; README discloses pre-existing code and AI tools | partly | Video; judges' URL and logins; one uncut real-phone run |
| **Agora Cross-Border Payments** | T2 only | A **mobile app** sending **AUSD across borders**, with **Mera passkey onboarding** and **instant settlement** | Send by link and claim (PolarisSend, ERC-3009); pay by link; split the bill; Face ID (Mera) accounts; local currency from Chainlink feeds; installable PWA and a signed Android app (TWA) | partly | Testnet runs on a labelled MockAUSD; real AUSD needs an `AUSD_MODE=ausd` redeploy (faucet refilled on 5 Oct). Ask Agora whether the PWA/Android app counts as mobile. APK on a real phone |
| **Privy** | All | Privy **beyond authentication**; bonus for several features | Policy-locked server wallet relays every payment (3 allowed, 7 refused); a second server wallet administers the registry; embedded merchant payout wallets; automatic payouts through a payout signer | met (testnet) | Google login and allowed domains on the Privy dashboard; show it in the video |
| **Chainlink CRE** | All | A CRE workflow (build, simulate or deploy) used as an **orchestration layer**; simulation accepted | `polaris-collections`, `polaris-underwrite`, `polaris-guardian`; three reports delivered on testnet with `cre workflow simulate --broadcast`; receivers extend `ReceiverTemplate` | met (simulation) | `cre account access` for deploys; a real underwriting report needs Zerion and a consenting history wallet |
| **Nansen** | All | Nansen data powering a product that goes **beyond exposing raw data** | First funder, related wallets and labels become an on-chain credit score with plain-language reasons; live client behind `NANSEN_API_KEY`, labelled synthesized fixtures without it | key | `NANSEN_API_KEY` (free tier: 100 credits); then `pnpm --filter @polarispay/underwriting record --linked <wallet>` |
| **Mera UX** | All | Mera is the **entire account layer**: one passkey ceremony, no email/OTP, prompt-free signing sessions, the stateless test | Face ID → PRF → key; no server holds a key; sessions; accounts reconstruct from the passkey | partly | The app also offers Privy email login: ask Mera, or hide it for judging. Face ID on a real iPhone/Android needs the app on its passkey domain |
| **Mera: One Passkey, Many Keys** | All | Creative **non-wallet** use of PRF key material, a namespaced salt, a live cross-device test | The same Face ID derives an HPKE inbox key; the server keeps what you bought only as ciphertext only your Face ID opens | partly | Real cross-device test; `demo:e2e` receipts step written (branch `metropolis/receipts-e2e`), not yet run |
| **Envio** | All | HyperIndex/HyperSync/HyperRPC behind a **core feature**; derived entities; deployed or self-hosted; a consumer | `packages/indexer` (HyperIndex) with payments, plans, instalments, subscriptions, payouts, sends, scores and CRE runs; a webhook outbox in polarispay-sdk's event shapes | key | `ENVIO_API_TOKEN` (HyperSync now requires one); run it against the local chain; Envio Cloud or self-host later |

**Not targeting:** Aurora Intents (mainnet only, no AUSD), Dynamic (a second
account layer), Kuru, Perpl and MetaMask (Track 1 only), Cleanverse (Track 4
only), Alchemy, and the AI-credit bounties (Polaris has no model in the loop).

## Keys and accounts the team must supply

| Key or account | Unblocks | Where it goes |
|---|---|---|
| `NANSEN_API_KEY` | Live Nansen underwriting | `workflows/.env` |
| `ZERION_API_KEY` (promo `METROPOLIS100`: a free month of Builder) | Live balances and tenure; a real CRE underwriting report | `workflows/.env` |
| `ENVIO_API_TOKEN` | The indexer's HyperSync | `packages/indexer/.env` |
| `cre account access` | CRE deploys (simulation needs none) | the CRE CLI |
| Privy dashboard: allowed domains, Google login | Hosted sign-in | dashboard.privy.io |
