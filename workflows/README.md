# @polaris/cre-workflows

**Chainlink CRE is Polaris's credit engine.** Two workflows, written with the
official TypeScript SDK (`@chainlink/cre-sdk` 1.22.0), orchestrate Pay in 4 on
Monad: one decides who gets credit, the other collects what is owed.

```
                         ┌────────────────────── Chainlink DON ──────────────────────┐
 app asks for Pay in 4 ──▶ polaris-underwrite (HTTP trigger)                          │
                         │  verify the account's own consent and the history         │
                         │  wallet's signature, both fresh (no network)              │
                         │  EVM reads: already underwritten? wallet already linked?  │
                         │            the account's AUSD balance                     │
                         │  node mode: Nansen → Zerion → Etherscan → RPC, per node,  │──▶ UnderwritingReceiver
                         │             facts derived by @polarispay/underwriting     │      └▶ ScoreManager.underwrite
                         │  consensus: counts by median, verdicts by identical       │         (score computed on chain,
                         │  report = facts, never a score; a thin file (nothing      │          line capped at $1,000)
                         │    a new account could not show) gets none                │
                         │                                                           │
 every minute (demo) ────▶ polaris-collections (cron trigger)                        │
 daily (production)      │  candidates: Envio GraphQL, else the chain's own counts   │
                         │  EVM read: CollectionsReceiver.checkTasks (the chain       │──▶ CollectionsReceiver
                         │            disposes: only what is due at a final block)   │      ├▶ collectInstallment
                         │  one signed report, gas = its own estimate + 15%          │      ├▶ chargeDue
                         │  receipt read back: skip reasons → dunning events         │      └▶ liquidate
                         └───────────────────────────────┬───────────────────────────┘
                                                         └──▶ signed callback for the Polaris API
                                                              (no API route receives it yet, see Status)
                                                              installment.failed (allowance_lost | insufficient_funds) …
```

## Why it is load-bearing

- **No CRE report, no credit.** `ScoreManager.underwrite` is callable only by
  its underwriter, `UnderwritingReceiver`, and the deployment turns on
  `requireUnderwriting`. A new Polaris account has no line until the
  `polaris-underwrite` workflow's report lands, so `PolarisCheckout.openPlan`
  refuses Pay in 4 (`ExceedsCreditLimit`) without it.
- **No CRE run, no collections.** Instalments, subscription renewals and
  liquidations happen when a `polaris-collections` report is delivered to
  `CollectionsReceiver`. The dunning ladder hears about failures from the
  same run.
- **No history, no report.** `ScoreManager` opens any underwritten account
  at the $200 floor, and an account with no history costs nothing to make.
  So the workflow attests only facts with at least one point from time or
  identity (30 days of age, 25 sends, 30 days of DeFi, or exchange funding;
  dollars do not count, they can be passed from account to account). A thin
  file gets no report: no unsecured line, collateral still works, and the
  buyer can come back with a history wallet. A declined file is always
  reported.
- **The DON attests facts; the chain does the arithmetic.** No single key can
  hand out credit: the report carries Nansen/Zerion facts, `ScoreManager`
  scores them, caps the opening line and refuses evidence older than 15
  minutes. The workflow verifies the account's own consent and the
  Bring-your-history signature itself before it spends a provider call, so
  whoever fires the trigger cannot underwrite an account that did not ask.

| Bounty requirement (Chainlink CRE, plan §3) | Where it is met |
|---|---|
| Build a CRE workflow | [`collections/main.ts`](collections/main.ts) → [`src/collections/workflow.ts`](src/collections/workflow.ts), [`underwriting/main.ts`](underwriting/main.ts) → [`src/underwriting/workflow.ts`](src/underwriting/workflow.ts); `project.yaml`, `workflow.yaml`, `secrets.yaml`, per-target configs |
| Used as an orchestration layer | Cron + HTTP triggers; EVM reads (`checkTasks`, `profileOf`, `linkedUserOf`, `balanceOf`, gas estimates, receipts); HTTP with consensus (Envio, Nansen, Zerion, Etherscan, RPC); signed reports written through the forwarder; a signed callback for the Polaris API (sent and verifiable; the API route that consumes it is not written yet) |
| Simulate or deploy | `cre workflow simulate … --broadcast` against the local Monad stand-in or Monad testnet (needs `cre login`, see below); `cre workflow build` compiles both to WASM without a login |

## One command

```bash
pnpm install
pnpm --filter @polaris/cre-workflows test        # unit tests on the CRE SDK's test runtime
pnpm --filter @polaris/cre-workflows e2e:local   # both workflows against real contracts on a local node
```

`e2e:local` starts a Hardhat node on `127.0.0.1:8620` with chain id 10143,
deploys every Polaris contract with `packages/contracts`' own deploy script,
plants the mock forwarder at Chainlink's simulation-forwarder address, and
runs the workflows' handlers (the code `cre workflow build` compiles) with
their EVM capability bridged to that node. See [What the tests prove](#what-the-tests-prove).

To build the WASM and simulate with the real CLI:

```bash
pnpm --filter @polaris/cre-workflows cre:install   # CRE CLI v1.35.0 from GitHub releases: SHA-256 + Authenticode checked, into workflows/.tools
pnpm --filter @polaris/cre-workflows build         # both workflows → WASM (no login needed)
```

`pnpm --filter @polaris/cre-workflows cre <args>` runs the CLI from this
folder (the CRE project root) with the pinned Bun on PATH, which
`cre workflow build` needs.

## Simulate

`cre workflow simulate` needs a CRE account and one browser login
(`cre login`; docs/research/cre.md §6.1). Nothing else here logs in to
anything.

**Against the local stand-in** (nothing touches a public chain):

```bash
pnpm --filter @polaris/cre-workflows chain:local          # terminal 1: node on :8620, contracts deployed, config.local.json written
cp workflows/.env.example workflows/.env                  # set CRE_ETH_PRIVATE_KEY to the public Hardhat key chain:local prints
pnpm --filter @polaris/cre-workflows cre login
pnpm --filter @polaris/cre-workflows simulate:collections local-settings
pnpm --filter @polaris/cre-workflows simulate:underwriting local-settings
```

`simulate:underwriting` first writes `underwriting/payload.json`
(`payload:underwriting` does only that): the trigger input with a fresh
consent, good for 15 minutes, signed by `POLARIS_UNDERWRITE_ACCOUNT_KEY` or,
when that is unset, by a throwaway key. `POLARIS_UNDERWRITE_WALLET_KEY` adds a
history wallet's link proof. Both come from the environment or
`workflows/.env`; the script prints addresses, never keys. No static example
payload can work, since the workflow rejects a consent older than 15 minutes.

**Against Monad testnet**, after `pnpm --filter @polarispay/contracts deploy:monad`
(with `CRE_SIMULATION_TRANSMITTER` = the address of `CRE_ETH_PRIVATE_KEY`,
funded with testnet MON):

```bash
pnpm --filter @polaris/cre-workflows configure staging    # addresses from packages/contracts/deployments/monad-testnet.json
pnpm --filter @polaris/cre-workflows simulate:collections staging-settings
pnpm --filter @polaris/cre-workflows simulate:underwriting staging-settings
```

Cron does not schedule under simulation: each run fires once. For the demo's
"every minute", loop it on the built WASM:

```powershell
while ($true) { pnpm --filter @polaris/cre-workflows cre workflow simulate ./collections -T staging-settings --non-interactive --trigger-index 0 --broadcast --wasm ./collections/binary.wasm; Start-Sleep 60 }
```

For live underwriting, keep the simulator listening and let the API queue
requests (the HTTP trigger fires at most once per 30 s):

```bash
pnpm --filter @polaris/cre-workflows cre workflow simulate ./underwriting -T staging-settings --listen --broadcast
# the API: triggerSimulatedUnderwriting({ user, consent, linked }) from @polaris/cre-workflows/trigger
```

**Under simulation a reverted receiver still reads as success** (the mock
forwarder swallows the revert). Both workflows therefore read their own
receipt and fail the run when the forwarder's `ReportProcessed` says
`result = false`; judge a run by `TaskExecuted` / `TaskSkipped` /
`UnderwritingApplied` / `UnderwritingRefused`, never by the CLI's status.

## Deploy (after Early Access)

1. `cre account access` until `cre whoami` shows deploy access.
2. Point both receivers at the production forwarder and lock them to the
   workflows (`packages/contracts/README.md`, "Forwarders on Monad testnet"):
   `setForwarderAddress(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`,
   `UnderwritingReceiver.setSimulationTransmitter(0)`,
   `setExpectedAuthor(<workflow owner>)`, `setExpectedWorkflowName("polaris-collections" | "polaris-underwrite")`.
3. `pnpm --filter @polaris/cre-workflows configure production --authorized-key <address the API signs trigger requests with>`
4. `pnpm --filter @polaris/cre-workflows cre secrets create ./secrets.yaml -T production-settings --secrets-auth=browser`
5. `pnpm --filter @polaris/cre-workflows cre workflow deploy ./collections -T production-settings` and the same for `./underwriting`.

The private registry allows three workflows per organisation: deploy these
two, not staging copies.

## Layout

| Path | What |
|---|---|
| `project.yaml` | CRE targets: `local-settings` (the node on :8620), `staging-settings` (Monad testnet, simulation forwarder), `production-settings` (Monad testnet, deployed DON) |
| `secrets.yaml`, `.env.example` | Secret ids → environment variables for simulation; the Vault DON once deployed |
| `collections/`, `underwriting/` | `main.ts` (the WASM entry), `workflow.yaml`, `config.<target>.json`, a strict `tsconfig.json` with no Node/DOM/Bun types |
| `src/collections/` | `workflow.ts` (the handler), `candidates.ts` (Envio query, chain window), `tasks.ts` (report encoding, batching), `outcomes.ts` (receipt → dunning events) |
| `src/underwriting/` | `workflow.ts`, `consent.ts` (the account's consent), `thin.ts` (facts it will not attest), `link.ts` (the history wallet's proof; both verified synchronously with @noble/curves), `evidence.ts` (node mode: the recipe over CRE's HTTP client), `report.ts`, `payload.ts` |
| `src/shared/` | Config schemas, EVM helpers (reads, gas, write, receipt), the signed callback |
| `src/trigger.ts` | `triggerSimulatedUnderwriting` for the API (`underwriteConsentMessage` is `@polaris/cre-workflows/consent`) |
| `scripts/` | `install-cre.mjs`, `cre.mjs`, `bun.mjs`, `configure.mjs`, `underwriting-payload.mjs`, `local-chain.mjs`, `e2e-local.mjs`, `hardhat.cre-local.config.cjs` |
| `test/` | Unit tests (`bun test`, `@chainlink/cre-sdk/test`) |
| `e2e/` | The local-chain round trip |

## Reference

### `polaris-collections`

Report: `abi.encode(uint8 kind = 1, (uint8 action, uint256 id)[] tasks)`;
action 1 collects an instalment, 2 charges a subscription, 3 liquidates.

1. **Candidates.** With `candidates.indexerUrl`, one GraphQL POST agreed by
   identical consensus on the ids. The default query, `DUE_CANDIDATES_QUERY`,
   is `DUE_CANDIDATES` from `@polarispay/indexer-client`, character for
   character: `Loan: Plan(...)` and `Subscription(...)` whose `nextAttemptAt`
   has come. The indexer moves `nextAttemptAt` up the dunning ladder after a
   shortfall, so a buyer who is short is retried on the ladder's schedule, not
   every tick. `test/indexer-schema.test.ts` validates the query against a
   Hasura-shaped schema built from `packages/indexer/schema.graphql` (a
   snapshot in `test/fixtures/indexer/` until that package is on this branch)
   and runs it over rows; the e2e's indexer does the same. An indexer with
   another schema sets `candidates.indexerQuery` (any query returning `Loan {
   loanId }` and `Subscription { subId }` lists); `configure --indexer <url>`
   clears it, `--indexer-query <file>` sets it. Without an indexer, or if it
   fails, the chain proposes: `loanCount()` and `subscriptionCount()`, the
   newest `recentWindow` ids of each, plus a `sweepWindow` slice of older ids
   that rotates with the cron's scheduled time so every id is revisited. The
   chain keeps no failure history, so this fallback has no dunning backoff: a
   buyer who is short is tried on every run until the indexer is back. So the
   fallback is never silent: the result's `indexerError` names the failure,
   and the run posts its callback even when nothing else happened, with
   `candidates: { source: "chain", indexerError }`, for the API to raise.
2. **The chain disposes.** `CollectionsReceiver.checkTasks` at the last
   finalized block, 72 tasks per read (CRE caps a read request at 5 KB).
   Liquidation is checked only on loans that are due.
3. **One report,** at most `maxTasksPerReport` tasks: each due loan's
   collection, then its liquidation if past grace (the receiver runs them in
   order, so a buyer who can pay is collected and only one who cannot is
   liquidated), then charges. A loan's pair is never split.
4. **Gas:** Monad bills the gas *limit*, so never the 10M cap. The report is
   signed first, then `onReport` is estimated from the forwarder's address
   with that report's own metadata (so a production receiver's author and
   name checks pass in the estimate too), plus `gas.overhead` for the
   forwarder's work, plus `gas.headroomBps`, clamped to `[gas.min, gas.max]`.
   It is estimated at the receiver, not at the forwarder: a forwarder catches
   the receiver's revert, so an estimate of the whole delivery can settle on
   a limit where the receiver ran out of gas inside the catch; the receivers
   revert a whole report when a task runs out of gas, so this estimate cannot
   undershoot that way.
5. **Outcome:** the receipt's `TaskExecuted` / `TaskSkipped` become events,
   posted to `callback.url` when set (and on every run whose indexer failed).

| `TaskSkipped` reason | Event | The buyer should |
|---|---|---|
| `InsufficientAllowance(have, need)`, `ERC20InsufficientAllowance` | `installment.failed` / `subscription.charge_failed`, `reason: "allowance_lost"` | sign again |
| `InsufficientBalance(have, need)`, `ERC20InsufficientBalance` | `…failed`, `reason: "insufficient_funds"` | add money |
| `NotDue`, `LoanNotActive`, `InvalidLoan`, `NotLiquidatable`, `SubscriptionNotActive` | none (a stale candidate is nobody's fault) | nothing |
| anything else | `…failed`, `reason: "other"` | (a person looks) |

The reasons are polarispay-sdk's `InstallmentFailureReason`, word for word
(`test/dunning.test.ts` holds them to `packages/sdk/src/events.ts`), so the
API forwards them to the merchant's `installment.failed` webhook unchanged.
`subscription.charge_failed` is for the API alone, to dun the subscriber: the
SDK's nine webhook types have no failed renewal, and a merchant hears of a
subscription that stays unpaid as `subscription.canceled` (`lapsed`).

Executed tasks become `installment.collected`, `subscription.charged` and
`plan.liquidated`.

The run uses at most 15 EVM reads (CRE's quota): 2 counts (chain mode), the
`checkTasks` batches, the estimate and the receipt; it checks fewer
candidates, and says so, rather than exceed it.

### `polaris-underwrite`

Trigger input:

```json
{ "user": "0x…",
  "consent": { "issuedAt": 1790000000, "nonce": "c0nsentN0nce", "signature": "0x…" },
  "linked": { "wallet": "0x…", "issuedAt": 1790000000, "nonce": "k3J9xq2LmN", "signature": "0x…" } }
```

`consent` is required: the account's own EIP-191 signature over
`underwriteConsentMessage({ account: user, wallet: linked?.wallet ?? null,
chainId, issuedAt, nonce })` from `@polaris/cre-workflows/consent`. It names
the history wallet (or none) and the chain, and is good for 15 minutes.
`ScoreManager.underwrite` runs once per account, so without it whoever can
fire the trigger (a compromised API, anyone who reaches it) could fix a
victim's opening line for good: underwrite them alone before they bring
their history, or link a wallet with liquidations to get them declined. The
DON checks it before any read or paid call. The API still authenticates the
buyer before it queues a run, but it cannot speak for them.

`linked` is optional; its signature is the history wallet's EIP-191 signature
over `linkMessage({ account: user, wallet, issuedAt, nonce })` from
`@polarispay/underwriting` (the gateway's `GET /v1/link-message` returns the
exact text).

Report (the deployed `UnderwritingReceiver`'s batch format):

```
abi.encode(uint8 kind = 2, (address user, address linkedWallet, Facts facts)[] items)
Facts = (uint32 walletAgeDays, uint32 txCount, uint64 stableBalance, uint32 defiTenureDays,
         uint16 priorLiquidations, uint16 relatedWallets, bool exchangeFunded, uint64 observedAt)
```

`@polarispay/underwriting`'s own `encodeUnderwriteReport` encodes the
single-item `(uint8, address, Facts)` of the research sketch; the receiver
that shipped takes this batch, so the workflow uses `src/underwriting/report.ts`.
The Facts words are the package's.

Result (the handler's return value, JSON): `status` is `applied` (with
`onChainScore`), `refused` (with ScoreManager's reason: `StaleEvidence`,
`AlreadyHasRecord`, `WalletAlreadyLinked`), `incomplete` (evidence missing,
no report, retry later: missing data is never attested as zero), `thin`
(final, but nothing a new account could not show: no report, and a signed
`credit.thin` callback, see `src/underwriting/thin.ts`), `skipped`
(already underwritten; no provider call spent), or `rejected` (no consent
from the account, a bad proof or payload; nothing read or spent).

Node mode sends each request with `cacheSettings: { store: true, maxAge }`,
so one node's paid Nansen call serves the DON, and adds keys only there:
Nansen `apikey` header, Zerion `Authorization: Basic`, Etherscan `&apikey=`.

**The call budget.** CRE allows 15 HTTP calls per execution and the recipe's
worst case is more, so the staging recipe counts sends on Ethereum and Base
(not Monad mainnet) and liquidations on all three allowlisted Aave pools
(Ethereum, Arbitrum, Polygon): the risk signal is kept whole, the activity
signal is trimmed. Every fixture persona pair then fits except a busy
account (dated with probes) plus a wallet Nansen has no first funder for;
that run stops at call 15 and returns `incomplete` with no report, rather
than attest evidence it could not read (both are tests).

While simulating, `UnderwritingReceiver` also requires the transaction's
origin to be its simulation transmitter, which an estimate from the
forwarder's address cannot be; the workflow reads `simulationTransmitter()`
and, when it is set, estimates the whole delivery from that key instead
(safe for a one-item report). On the production forwarder it estimates
`onReport` like collections.

### Config

Addresses in the committed `config.staging.json` and `config.production.json`
are `null` until the contracts are deployed; the workflow refuses to start
with the command that fills them (`configure`). Everything else is real:
the forwarders (verified on chain, docs/research/cre.md §4), AUSD and USDC on
Monad testnet, the provider endpoints, gas bounds and schedules.

### Callback (`callback.url`)

`POST` JSON with `Polaris-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
(the scheme `packages/db/src/webhooks.ts` signs merchant webhooks with) and
`Idempotency-Key`. Verify with `verifyCallback(secret, rawBody, header, now)`
from `@polaris/cre-workflows/callback`; event types are in
`@polaris/cre-workflows/events`. Every node may send it; key on `id`.

`collections.run` carries `txHash` (null for a run that wrote nothing),
`candidates: { source, indexerError }`, `tally` and `events`; its `id` is the
transaction hash, or `collections:<scheduled tick>` for a run that wrote
nothing. `polaris-underwrite` sends `credit.underwritten`, `credit.refused`
and `credit.thin`.

## What the tests prove

- `test/encoding.test.ts`: both reports are byte-identical to
  `packages/contracts/lib/cre.js` (what the Hardhat suite drives the receivers
  with); workflow names hash to the receivers' bytes10; a full `checkTasks`
  batch fits 5 KB; gas sizing; the chain window revisits every id.
- `test/indexer-schema.test.ts`: the default candidate query is valid
  against the indexer's Hasura schema (and equal to the indexer client's
  `DUE_CANDIDATES` once that package is here); run over rows, it returns the
  plans and subscriptions whose attempt has come and skips those the dunning
  ladder holds back; `configure --indexer` yields a request the indexer
  accepts.
- `test/collections.workflow.test.ts`, `test/underwriting.workflow.test.ts`:
  the handlers on `@chainlink/cre-sdk/test`'s runtime and mocks: reports,
  gas limits, the indexer and its fallback (never silent: the failure is in
  the result and the callback), the read quota, the simulator's
  masked revert, dunning events and their signature; facts equal to what
  the underwriting package derives for the same persona, keys only in
  headers, every response cached, refusals before any paid call; a run
  the account did not sign for (no consent, another key's, a consent to be
  underwritten alone replayed with a wallet, a stale one) is rejected before
  anything is read.
- `test/thin.test.ts` and the thin-file cases in
  `test/underwriting.workflow.test.ts`: an account with no history (or only
  dollars) gets no report and no $200 line; it opens once a history wallet
  is brought; a declined file is still reported.
- `test/consent.test.ts`: the consent text byte for byte, bound to the
  account, the wallet (or none), the chain and 15 minutes, and checked the
  way viem's own verifier checks it.
- `e2e/local-chain.e2e.test.ts` (`e2e:local`): on real contracts, a proof
  becomes facts and ScoreManager opens a line at the mirror's score; a Pay in
  4 plan opens on it; instalment 1 is collected from indexer candidates (the
  workflow's own query run against the indexer's schema); a
  revoked allowance and an empty balance become `allowance_lost` and
  `insufficient_funds`;
  past grace the plan is liquidated in the same report; an unknown action is
  skipped, not fatal.

Gas on the local node (Hardhat, chain 10143), the limit each report was sent
with against what it used:

| Report | Gas used | Limit sent |
|---|---:|---:|
| Underwriting, one buyer with a history wallet | 136,222 | 156,655 |
| Collections, one instalment collected | 150,161 | 193,810 |
| Collections, one instalment skipped (dunning) | 77,281 | 150,000 (the floor) |
| Collections, a skip plus a liquidation | 161,813 | 216,110 |

## Status

| | |
|---|---|
| Both workflows compile to WASM with `cre workflow build` (CLI v1.35.0, SDK 1.22.0) | done, no login needed |
| Unit tests on the SDK's test runtime; the on-chain round trip on a local node | done (`test`, `e2e:local`) |
| `cre workflow simulate` | needs `cre login` (a CRE account): not run here. The commands are above; `local-settings` keeps `--broadcast` off public chains |
| Monad testnet | waits for `deploy:monad` (the deployer is unfunded), then `configure staging` |
| Deploy to the DON | waits for Early Access |
| The Polaris API side of the callback | **not written**: no route in `apps/business` receives it yet. `verifyCallback` and the event types are exported for one (`POST /api/cre/callback` on the API's branch, verifying with the secret the workflows hold as `POLARIS_CALLBACK_SECRET`). Until it exists, the committed configs set `callback: null`; dunning runs on the business app's own chain sync of `TaskSkipped`, and a new credit line reaches the app as `UnderwritingApplied` on chain |
| Firing `polaris-underwrite` from the product | not wired: `triggerSimulatedUnderwriting` and `underwriteConsentMessage` are exported, but no API route calls them yet (an authenticated `POST /api/credit/underwrite` on the API's branch: the app has the buyer's account sign the consent, the route queues one run per 30 s) |
| The indexer schema | `DUE_CANDIDATES_QUERY` is the indexer client's `DUE_CANDIDATES`, validated against `packages/indexer/schema.graphql` (snapshot at metropolis/indexer 3987062 until that branch merges; then delete `test/fixtures/indexer/`) |
| Dunning backoff without the indexer | not applied: the chain fallback has no failure history, so it retries a short buyer every run. Keep the indexer configured in production |

## Limits that shaped this (docs/research/cre.md §8)

15 EVM reads and 15 HTTP calls per execution; 5 KB per read request; 10M gas
and 50 KB per report; cron no faster than 30 s; the HTTP trigger once per 30 s.

## Attribution

`@chainlink/cre-sdk` (BUSL-1.1, a dependency, not vendored; it converts to MIT
on 20 May 2029), the CRE CLI (MIT, downloaded from Chainlink's GitHub
releases, not committed), viem, zod and @noble/curves / @noble/hashes (MIT).
Written with Claude Code.
