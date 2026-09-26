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
- **The credit engine**: undercollateralized pay-in-4 on Monad. The merchant
  is paid in full up front. Instalments are collected and credit is
  underwritten by [Chainlink CRE](https://docs.chain.link/cre) workflows, using
  [Nansen](https://nansen.ai) and Zerion wallet data, and indexed by
  [Envio](https://envio.dev).

Built for [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis),
Track 02: Consumer Products & Payments. The plan is in
[`docs/plan.md`](docs/plan.md).

> **Status:** under construction during the build window (26 Sep – 13 Oct
> 2026). Sections marked *TBD* are filled in as each piece lands.

---

## Layout

| Path | What it is |
|---|---|
| `apps/app` | The Polaris app: the buyer's PWA (Face ID accounts with Mera, checkout, send by link). See its [README](apps/app/README.md) |
| `packages/contracts` | Solidity: loan engine, payments, score manager, collateral vault, merchant registry, batch settlement, plus the Metropolis additions |
| `packages/underwriting` | Nansen-powered underwriting: provider clients, the Facts the DON attests, the score and Pay in 4 decision, plain-language reasons. See its [README](packages/underwriting/README.md) |
| `apps/gateway` | Serves the underwriting API on port 3510. See its [README](apps/gateway/README.md) |
| `packages/sdk` | `polarispay-sdk` |
| `docs/plan.md` | The hackathon plan: positioning, sponsors, scope, schedule |

## Setup

Node 22.6+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm contracts:test
pnpm --filter @polarispay/underwriting test   # runs on labelled fixtures; no keys needed
pnpm --filter @polarispay/gateway start       # the underwriting API on :3510
```

*TBD: deployment to Monad testnet, the apps and services.*

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

## License

[MIT](LICENSE)
