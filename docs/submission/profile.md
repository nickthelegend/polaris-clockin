# The project profile

Ready to paste into the portal's project fields (`name`, `oneLiner`,
`description`, `repositoryUrl`, `demoUrl`; [`sources.md`](sources.md#the-portal)).
The wording follows the pitch order in
[`docs/plan.md` §2](../plan.md#the-pitch). Placeholders are in `<ANGLE BRACKETS>`.

## Name

Polaris

## One-liner

Payment links with credit built in: Stripe for every app on Monad.

## Description, 50 words

Polaris is Stripe for every app on Monad. A merchant shares one link. The
buyer creates an account with Face ID and pays in dollars: in full, in four
instalments against a credit line, or monthly. Merchants are paid in full,
upfront. Anyone can send dollars across borders by link.

## Description, 150 words

Polaris is Stripe for every app on Monad: payment links with credit built in.
A merchant shares one link. The buyer opens it, creates an account with Face
ID (Mera passkeys) and pays in dollars: in full, in four instalments at 10%
APR against a credit line, or on a subscription. They never see a seed phrase
or pay gas; every step is a signature that our relayer carries. The merchant
is paid in full, up front, and withdraws from a Privy embedded wallet. Three
Chainlink CRE workflows run the credit: one underwrites a buyer from Nansen
and Zerion wallet data for an on-chain score, one collects instalments on
schedule and the moment a buyer signs again, and one pauses new plans if
Chainlink's AUSD/USD depegs. People can also send dollars across borders by
link. The contracts are live on Monad testnet, where the CRE workflows have
delivered signed reports.

## Links

| Field | Value |
|---|---|
| `repositoryUrl` | https://github.com/nickthelegend/polaris-monad |
| `demoUrl` | `<VIDEO_URL>` (the 3-minute video: [`video-script.md`](video-script.md)); a hosted app URL once it exists (not hosted yet: [README, step 6](../../README.md#what-only-you-can-do)) |
| Write-up | [`docs/submission/writeup.md`](writeup.md) (link it as a "document" evidence item) |
| Contracts | [Monad testnet deployment](../../README.md#monad-testnet-deployment); the record is [`monad-testnet.json`](../../packages/contracts/deployments/monad-testnet.json) |

## Track

**Track 02: Consumer Products & Payments** (one track per project;
[`docs/plan.md` §1.1](../plan.md#11-track-02-and-the-judging)).

## Sponsor bounties

Select all six ([`docs/plan.md` §3](../plan.md#3-sponsor-strategy); answers
in [`bounty-fields.md`](bounty-fields.md)):

| Bounty | Prize (plan §3) | Where it is met |
|---|---|---|
| Agora: Cross-Border Payments (AUSD) | $10,000, Track 02 only | [writeup, Agora](writeup.md#agora) |
| Privy | $5,000, all tracks | [writeup, Privy](writeup.md#privy) |
| Chainlink: Best workflow with CRE | $3,000, all tracks | [writeup, Chainlink CRE](writeup.md#chainlink-cre) |
| Nansen | $5,000 pool, all tracks | [writeup, Nansen](writeup.md#nansen) |
| Mera UX | $2,500, all tracks | [writeup, Mera](writeup.md#mera) |
| Envio | $1,000, all tracks | [writeup, Envio](writeup.md#envio) |

## Tech stack

| Layer | What we use | Where |
|---|---|---|
| Chain | **Monad testnet** (EVM, chain 10143); reads of Monad mainnet (143) for Chainlink feeds | [`monad-testnet.json`](../../packages/contracts/deployments/monad-testnet.json) |
| Money | AUSD's signature standards (ERC-2612 permits, ERC-3009 authorizations, EIP-712 intents); `MockAUSD` on testnet | [`packages/contracts`](../../packages/contracts/README.md) |
| Contracts | Solidity 0.8.24, OpenZeppelin Contracts 5, Hardhat 2, ethers 6 | [`packages/contracts`](../../packages/contracts/README.md) |
| Credit orchestration | **Chainlink CRE**: `@chainlink/cre-sdk` 1.22.0, CRE CLI v1.35.0, Bun (the CLI's TypeScript build); HTTP, cron and EVM log triggers; Confidential HTTP | [`workflows`](../../workflows/README.md) |
| Price data | **Chainlink Data Feeds**: AUSD/USD on Monad mainnet (the guardian), FX feeds for the local-currency line | [`packages/fx`](../../packages/fx/README.md) |
| Underwriting data | **Nansen** (Profiler: first funder, related wallets, labels), Zerion, Etherscan, public RPCs | [`packages/underwriting`](../../packages/underwriting/README.md) |
| Consumer accounts | **Mera** (`@category-labs/mera` 0.2.0): Face ID passkeys with PRF | [`apps/app`](../../apps/app/README.md#face-id-mera) |
| Merchant accounts and wallets | **Privy** (`@privy-io/react-auth` 3.45, `@privy-io/node` 0.35): sign-in, embedded wallets, server wallets with policies | [`apps/business`](../../apps/business/README.md#privy-sign-in-and-the-payout-wallet) |
| Indexing | **Envio HyperIndex** (`envio` 3.12.1) on HyperSync; a typed GraphQL client | [`packages/indexer`](../../packages/indexer/README.md) |
| Web apps | Next.js 16, React 19, Tailwind CSS 4, viem 2, TypeScript; a shared component library | [`apps/app`](../../apps/app/README.md), [`apps/business`](../../apps/business/README.md), [`apps/shop`](../../apps/shop/README.md), [`packages/ui`](../../packages/ui/README.md) |
| Developer surface | `polarispay-sdk` 0.3.0: checkout sessions, signed webhooks, the checkout pop-up, React components | [`packages/sdk`](../../packages/sdk/README.md) |
| Storage | SQLite for Polaris for Business (API keys hashed, webhooks signed) | `packages/db` |
| Workspace | pnpm 10 workspace, Node 22 | [README, "Run it"](../../README.md#run-it) |
| AI coding tools | Claude Code, disclosed | [README, "AI coding tools"](../../README.md#ai-coding-tools) |

## Team

Fill in before submitting (the portal's team section; nothing here is known
to the repository beyond the commit author):

| Name | Role | Contact | GitHub |
|---|---|---|---|
| `<NAME>` | `<ROLE, e.g. contracts and CRE>` | `<EMAIL or Telegram>` | `nickthelegend` (the repository's committer) |
| `<NAME>` | `<ROLE>` | `<CONTACT>` | `<GITHUB>` |
| `<NAME>` | `<ROLE>` | `<CONTACT>` | `<GITHUB>` |

Location, for the cross-border story: `<CITY, COUNTRY per member>`.
