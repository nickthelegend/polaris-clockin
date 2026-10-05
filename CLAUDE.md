# CLAUDE.md

Context for Claude Code sessions in this repository. The team's checklist is
[`docs/TODO.md`](docs/TODO.md); the plan is [`docs/plan.md`](docs/plan.md);
the README is the reference for everything that runs.

## What this is

**Polaris: Stripe for every app on Monad.** Payment links with credit built
in: Pay now, Pay in 4 against an on-chain credit line, Subscribe; send money
by link; split the bill. Buyers sign up with Face ID (Mera passkeys) and never
hold MON: every action is a signature a relayer carries.

Built for **Monad Metropolis**, Track 02 (Consumer Products & Payments), plus
sponsor bounties (Agora, Privy, Chainlink CRE, Nansen, Mera, Envio).
**Deadline: Tue 13 Oct 2026, 11:59 PM ET.** Feature freeze Fri 9 Oct, 18:00.

- Repo: https://github.com/nickthelegend/polaris-monad (**public**)
- Working copy: `/Volumes/Extreme SSD/Projects/polaris` on a Mac (moved from
  a Windows PC on 6 Oct). The Solana port (remote `polaris-solana`) is a
  different, older product, not this one.
- Network: Monad testnet, chain 10143. The deployment record is
  `packages/contracts/deployments/monad-testnet.json`.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Solidity (Hardhat): PolarisCheckout, PolarisPayments, PolarisLoanEngine, ScoreManager, CollateralVault, MerchantRegistry, BatchSettlement, PolarisSend, PolarisSplit, the CRE receivers (`contracts/cre/`), MockAUSD. ABIs exported to `abi/` (`pnpm --filter @polarispay/contracts abi`) |
| `apps/app` | The buyer's app (Next.js PWA): Mera Face ID accounts, checkout, send/claim, split, credit line, Activity. Email login via Privy is a secondary path |
| `apps/business` | Polaris for Business: merchant dashboard, the API (checkout sessions, webhooks, keys), the relayer (`POST /api/relay`) on a Privy server wallet, the CRE callback, sealed receipts |
| `apps/shop` | Halcyon, the demo storefront paying through `polarispay-sdk` |
| `apps/landing` | The marketing site |
| `apps/android` | The app as an Android Trusted Web Activity (Bubblewrap) |
| `apps/gateway` | The underwriting API wrapper |
| `packages/sdk` | `polarispay-sdk` 0.3.0 (sessions, webhooks, splits) |
| `packages/receipts` | "Receipts only you can read": HKDF + HPKE keys from the passkey's PRF output |
| `packages/db`, `fx`, `ui`, `brand`, `underwriting`, `indexer` (Envio HyperIndex), `keeperhub` (legacy reference) | Shared pieces |
| `workflows` | Chainlink CRE workflows: `polaris-collections`, `polaris-underwrite`, `polaris-guardian`; evidence under `workflows/evidence/` |
| `docs` | `plan.md`, `deploy.md`, `submission/` (the submission kit), `research/`, `demo/` (screenshots and evidence) |

## Commands

```bash
CI=true pnpm install --prefer-offline        # under a minute on the Mac
pnpm --filter @polarispay/contracts test     # Hardhat, ~600 tests
pnpm --filter @polaris/business test         # vitest; also typecheck, lint
pnpm --filter @polaris/app test              # node:test; also typecheck, lint, check:signatures
pnpm --filter @polaris/shop test
pnpm --filter polarispay-sdk test
pnpm test:scripts                            # deploy-check and docs tooling
pnpm docs:check                              # every link, hash and address in the docs against the evidence
pnpm demo:local && pnpm demo:e2e             # the whole product on a local chain (needs Playwright for e2e)
pnpm --filter @polarispay/contracts check:deployment:monad   # read-only, 65 checks against testnet
```

Before calling work done: the touched packages' `test`, `typecheck` and
`lint`, plus `pnpm docs:check` if any doc changed.

## Rules

- **Never commit secrets.** Keys live only in git-ignored files:
  `apps/business/.env.local`, `.env.privy`, `.privy-admin.key`,
  `workflows/.env`, `apps/app/.env.local`. The repo is public; scan the
  outgoing diff before every push.
- **Ask before pushing** to `origin`, and before any testnet transaction
  (deploys, redeploys, funding). Read-only chain checks are fine.
- **The testnet deployment is frozen.** No contract changes that need a
  redeploy unless the team decides so: a redeploy moves addresses the apps,
  indexer, workflows and docs all pin. After any redeploy: update the record,
  `check:deployment:monad`, `verify:monad`, and the docs.
- **Never change `apps/app/src/lib/account/derive.ts`** (it decides every
  account's address).
- **Docs are evidence.** The README and `docs/submission/` say exactly what
  ran, with hashes, and what has not. Keep that tone: plain, precise, no hype,
  an honest "not done yet". `pnpm docs:check` rejects hashes that aren't in
  committed evidence.
- **UI:** match the reference designs exactly, reuse `packages/ui`
  components, dark premium look shared by web and mobile, Satoshi font. No
  generated imagery that isn't the product.
- **Commits:** plain-English sentence subjects (see `git log`); work on
  `metropolis/<topic>` branches in worktrees under `.claude/worktrees/`,
  merged into `main` with `--no-ff`.

## Environment (Mac)

- The repo is on an external SSD (`/Volumes/Extreme SSD`); the path has a
  space, so quote it in shell commands.
- Node 22.6+ and pnpm 10. Some packages run TypeScript directly.
- `node_modules` is per worktree; a new worktree needs its own install. If
  the repo moves, `git worktree repair <new paths>`.
- The Android build reads the JDK from `apps/android/.env`
  (`POLARIS_ANDROID_JDK`, Homebrew's OpenJDK 17 here).
- Local Envio needs Docker.
