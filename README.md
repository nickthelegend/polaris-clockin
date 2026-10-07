# Polaris

**Pay now, or in four, from your phone, on Solana.** Polaris is a mobile
payments app with credit built in: pay a shop in dollars, or split the price
into four instalments against an on-chain credit line that you grow by paying
on time and clocking in every day. Lock SKR to raise your limit, pay
instalments in SKR, and send dollars to anyone by link (they need no SOL to
claim).

Built for the **Solana Mobile CLOCK IN** hackathon: an Android app
(Mobile Wallet Adapter, Seed Vault compatible) and one Anchor program on
Solana **devnet**.

| | |
|---|---|
| The app | [`apps/mobile`](apps/mobile): Expo 57 / React Native 0.86, Android first |
| The program | [`packages/solana`](packages/solana): Anchor 0.32, program `HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA` |
| Coach server (optional) | [`apps/coach`](apps/coach): holds the Anthropic key for the AI coach |
| Android APK | [1.1.0 on the `clockin-v1` release](https://github.com/nickthelegend/polaris-clockin/releases/download/clockin-v1/polaris-clockin.apk), sha256 `d371f69ed942ededcde44e83f6cf3fc40087e7784899b02323ed404eaf2c741e` |
| Hackathon kit | [`clockin/`](clockin): submission, pitch, demo script, screenshots (every screen: [`clockin/screens/all`](clockin/screens/all/INDEX.md)), the port plan |
| Status and what's left | [`HANDOFF.md`](HANDOFF.md) |

## What it does

- **Pay now.** One signature moves pUSD (devnet test dollars) to the shop.
- **Pay in 4.** The program pays the shop in full from a credit pool; you owe
  four weekly instalments at 10% APR pro-rated, nothing due today. Opening
  the plan also gives the program an SPL delegate approval for what you owe,
  so a permissionless crank can collect a due instalment if you forget.
- **A credit score that lives on chain.** Everyone starts at 520. On-time
  instalment +12, late −30, plan repaid +10, Pay now +2 (first 10), daily
  clock-in +1 (first 60). The score sets your line: $50 → $150 → $300 →
  $600 → $1,000.
- **Clock in daily.** One check-in per UTC day builds a streak and pays SKR
  from a rewards vault (base × min(streak, 7)). A local notification nudges
  you at 9:00 and the day before an instalment is due.
- **SKR, three ways.** Earn it by clocking in. **Lock it as collateral**:
  half its dollar value is added to your Pay in 4 limit, and it can't be
  unlocked while it backs what you owe. **Spend it**: any instalment can be
  paid in SKR, which flows back into the rewards vault that pays tomorrow's
  check-ins. On devnet SKR is a stand-in mint, labelled everywhere.
- **Send by link.** Dollars are escrowed under a throwaway key whose secret
  is the link. The sender tops that key up with a little SOL, so the claim
  pays its own fee and the recipient's token account; the change goes back
  to the sender.
- **Coach (AI).** Claude reads your on-chain profile and explains your
  limit, the fastest way to the next tier, or whether a Pay in 4 fits. It
  needs an Anthropic key (yours, in the app, or on the coach server); with
  none, the app says the AI is off and shows a rules-based summary.

## Run it

```bash
# the program: unit tests and 19 end-to-end tests on a local validator
cd packages/solana && npm install
cargo test --manifest-path programs/polaris/Cargo.toml --lib
anchor build && anchor test

# a local validator with the program, mints, pool and demo merchants
solana-test-validator --ledger .anchor/dev-ledger --rpc-port 4270 --gossip-port 4272 \
  --faucet-port 4273 --dynamic-port-range 4274-4299 \
  --upgradeable-program HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA target/deploy/polaris.so keys/deployer.json
NETWORK=localnet SOLANA_URL=http://127.0.0.1:4270 npx ts-node --transpile-only scripts/setup-devnet.ts
NETWORK=localnet SOLANA_URL=http://127.0.0.1:4270 npx ts-node --transpile-only scripts/smoke.ts

# devnet (needs ~4 SOL on keys/deployer.json): deploy, set up, smoke
bash scripts/deploy-devnet.sh && npx ts-node --transpile-only scripts/smoke.ts

# the app
cd ../../apps/mobile && npm install && npm run sync-chain
npx expo run:android                                  # MWA on a device or emulator
EXPO_PUBLIC_CLUSTER=localnet npx expo run:ios         # guest wallet on the simulator
```

`keys/` (the deployer, the program and the demo merchants' keypairs) is
git-ignored. The release keystore lives outside the repo.

## Mapping from the Monad build

Polaris began at Monad Metropolis as "Stripe for every app on Monad" (Solidity
contracts, a relayer, a merchant dashboard, Chainlink CRE workflows). For
CLOCK IN it was rebuilt as a phone-first Solana app; the contract-by-contract
mapping and what was cut is in [`clockin/PORT-PLAN.md`](clockin/PORT-PLAN.md).

## History

The Monad-era code is still in the repo for reference (`packages/contracts`,
`apps/app`, `apps/business`, `apps/shop`, `workflows`, `packages/*`), and its
README, plan and submission index are archived in
[`docs/monad/`](docs/monad). None of it is part of the CLOCK IN build.

MIT licensed.
