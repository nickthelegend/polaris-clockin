# Polaris: CLOCK IN submission

**Name:** Polaris

**One-liner:** Pay now or in four from your phone, with a credit line you grow
on chain every day, and SKR that unlocks more of it.

**Repository:** https://github.com/nickthelegend/polaris-clockin

**Team:** `<TEAM>` (fill in before submitting)

## Problem

Paying with crypto on a phone means paying the full price, now. There is no
credit, and there's no reason to open a payments app unless you're paying.
Credit apps elsewhere are black boxes: you can't see why your limit is what it
is or what would raise it. And Seeker owners hold SKR with little to do with
it beyond staking.

## Solution

Polaris is a Solana Mobile app with Pay in 4 built in:

- **Pay now** in dollars, or **Pay in 4**: the shop is paid in full up front
  from a credit pool; you owe four weekly instalments (10% APR pro-rated),
  nothing due today.
- **A credit score that lives on chain**, moved only by what you do: +12 per
  on-time instalment, −30 per late one, +10 per plan repaid, +1 per daily
  clock-in. The score sets your line, from $50 up to $1,000.
- **Send dollars by link**: the link pays its own claim fee, so the recipient
  needs no SOL.

## Why Seeker users come back every day

**Clock in.** One tap a day builds a streak, pays an SKR reward that grows to
7× with the streak, and adds a point to your credit score, so the daily habit
literally raises your Pay in 4 limit. Home shows the streak, the next reward,
the countdown to tomorrow and what's due. After a clock-in the app offers a
9:00 reminder for the next day, and it reminds you the day before each
instalment. Paying early always counts as on time (+12), which is another
reason to come back before every due date.

## How it uses Solana, MWA, SKR and AI

- **Solana:** one Anchor program (`packages/solana`) holds every rule: the
  credit pool, plans, the score, the SKR vaults and send links. Pay in 4 sets
  an **SPL delegate approval** for what's owed, so a **permissionless crank**
  can collect a due instalment; send-by-link uses an **ephemeral keypair**
  that escrows the dollars and pays the claim's fee itself.
- **Mobile Wallet Adapter:** the primary wallet path on Android (Seed Vault
  on Seeker; Phantom, Solflare or Mock MWA Wallet elsewhere), with a cached
  authorization token. A guest wallet (a devnet-only key in SecureStore,
  labelled as such) exists for the iOS simulator and for trying the app
  without a wallet. A read-only Seeker Genesis Token check shows a "Seeker
  verified" badge.
- **SKR (three ways, all enforced by the program):** *earn* it by clocking in
  (from a rewards vault); *lock* it as credit collateral (half its value is
  added to your Pay in 4 limit, and the program refuses to unlock SKR that
  backs what you owe); *spend* it on any instalment, which refills the
  rewards vault that pays tomorrow's check-ins. On devnet SKR is a
  **stand-in mint** (6 decimals, classic SPL Token, like mainnet SKR
  `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`), labelled "SKR (devnet
  stand-in)" in the app; its price ($0.05) is an admin-set stand-in for an
  oracle.
- **AI:** *Coach* sends Claude your on-chain profile (score, record, limit,
  streak, plans; nothing else) and answers "why is my limit this?", "fastest
  way to the next tier?" and, at checkout, "can I afford this on Pay in 4?".
  It needs an Anthropic key, either on the coach server (`apps/coach`) or the
  user's own key pasted in Me. Without one, the app says the AI is off and
  shows a rules-based summary instead. (The Claude path has not been run
  with a real key yet; see HANDOFF.md.)

## Devnet deployment

DEVNET_SECTION

## Install the APK

APK_SECTION

## Porting note (for the portal's "porting" question)

Polaris started at Monad Metropolis as a web checkout for merchants
(Solidity, a relayer, a merchant dashboard). For CLOCK IN it was rebuilt as a
native mobile app on Solana: a new Anchor program (Pay in 4 with delegate
approvals and a crank, the on-chain score, SKR collateral and SKR payments,
the daily check-in, send-by-link with self-paying links), and a new Expo app
with MWA, the daily clock-in loop, notifications, haptics and the AI coach.
The mapping and what was cut: [`PORT-PLAN.md`](PORT-PLAN.md).
