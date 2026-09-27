# @polaris/cre-workflows

**Chainlink CRE is Polaris's credit engine.** Two workflows, written with the
official TypeScript SDK (`@chainlink/cre-sdk` 1.22.0), orchestrate Pay in 4 on
Monad: one decides who gets credit, the other collects what is owed.

```
                         ┌────────────────────── Chainlink DON ──────────────────────┐
 app asks for Pay in 4 ──▶ polaris-underwrite (HTTP trigger)                          │
                         │  verify the account's own consent and the history         │
                         │  wallet's signature, both fresh (no network)              │
                         │  EVM reads: what the chain would refuse (underwritten,    │
                         │    history already lent or linked), the AUSD balance      │
                         │  Confidential HTTP (switch): Nansen, Zerion, Etherscan    │──▶ UnderwritingReceiver
                         │    once, from an enclave that holds the keys; public RPC  │      └▶ ScoreManager.underwrite
                         │    plain. Switch off: every node calls, counts by median  │         (score computed on chain,
                         │  facts derived by @polarispay/underwriting; report =      │          line capped at $1,000)
                         │    facts, never a score; a thin file gets none            │
                         │                                                           │
 every minute (demo) ────▶ polaris-collections (cron trigger)                        │
 daily (production)      │  candidates: Envio GraphQL, else the chain's own counts,  │
                         │    both on the dunning ladder (6h, 24h, 72h, 168h)        │
                         │  EVM read: CollectionsReceiver.checkTasks (the chain       │──▶ CollectionsReceiver
                         │            disposes: only what is due at a final block)   │      ├▶ collectInstallment
                         │  one signed report, gas = its own estimate + 15%          │      ├▶ chargeDue
                         │  receipt read back: skip reasons → dunning events         │      └▶ liquidate
                         └───────────────────────────────┬───────────────────────────┘
                                                         └──▶ signed callback to the Polaris API
                                                              (POST /api/cre/callback in apps/business)
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
  So the workflow attests only facts with the history `ScoreManager.isThinFile`
  requires on chain: at least 90 days of age and 10 transactions, over the
  account and its linked wallet (dollars do not count, they can be passed
  from account to account). A thin
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
| Used as an orchestration layer | Cron + HTTP triggers; EVM reads (`checkTasks`, `profileOf`, `linkedUserOf`, `balanceOf`, gas estimates, receipts); HTTP with consensus (Envio, Nansen, Zerion, Etherscan, RPC); signed reports written through the forwarder; a signed callback the Polaris API verifies and acts on (`apps/business` `POST /api/cre/callback`) |
| Simulate or deploy | `cre workflow simulate … --broadcast` against the local Monad stand-in or Monad testnet (needs `cre login`, see below); `pnpm --filter @polaris/cre-workflows evidence` runs each workflow once on Monad testnet and keeps its log and transaction hashes in [`evidence/`](evidence/); `cre workflow build` compiles both to WASM without a login |
| Monad | Writes to Monad testnet (10143) through Chainlink's forwarder; every target in `project.yaml` can also read Monad mainnet (143), where Chainlink's AUSD/USD and FX feeds are, without writing there |
| Chainlink privacy | The paid provider calls go through CRE's Confidential HTTP (a switch, on in simulation): see [Confidential HTTP](#confidential-http) |

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

Cron does not schedule under simulation: each `simulate` fires once, at the
schedule's next tick (the simulator waits for it and stamps that exact time).
For the demo's "every minute", keep it running:

```bash
pnpm --filter @polaris/cre-workflows collections:loop               # dry runs: nothing is sent
pnpm --filter @polaris/cre-workflows collections:loop --broadcast   # real transactions (or CRE_LOOP_BROADCAST=1)
```

`scripts/collections-loop.mjs` builds the WASM once, then starts `simulate
--wasm` again as soon as a run ends, so every minute's tick gets a run. Each
run's output (secrets redacted) is appended to
`evidence/loop/<UTC date>.log`, and one JSON line to `<date>.jsonl`: the
outcome, the tasks, what the dunning ladder held back, the transaction hash.
`--target local-settings` runs it against the local stand-in, `--runs <n>`
stops after n runs. It refuses to start when you are not logged in, when
`collections/config.<target>.json` has no addresses, or when `--broadcast` has
no `CRE_ETH_PRIVATE_KEY`.

### The evidence, in one command

```bash
pnpm --filter @polaris/cre-workflows evidence                       # every workflow, once, on Monad testnet
pnpm --filter @polaris/cre-workflows evidence --only collections    # or some of them
```

`scripts/evidence.mjs` refuses, before anything is sent, unless: `cre whoami`
says you are logged in; `packages/contracts/deployments/monad-testnet.json`
(or `--deployment <file>`) exists, is on Monad testnet, and has every address
the workflows need; `CRE_ETH_PRIVATE_KEY` is set, holds testnet MON, and is
UnderwritingReceiver's `simulationTransmitter()` (read on chain; only its
address is printed). Then it fills `config.staging.json` from the record
(`configure staging`), keeps `cre workflow supported-chains`, and runs each
workflow with `simulate --broadcast` (underwriting with a freshly signed
payload). Every hash in a result or a log is read back from Monad testnet:
landed or reverted, the block, and the forwarder's `ReportProcessed` result
for the receiver. It writes `evidence/<UTC date>/<workflow>-<time>.log`,
`runs.json` and a `README.md` table, and prints the table. A run that wrote
nothing (nothing due, a thin file) is recorded as such: no hash is invented.

Every script that starts `cre workflow simulate` here (`cre`, the
`simulate:*` scripts, `collections:loop`, `evidence`) also sets
`ZERION_BASIC_AUTH = base64("<ZERION_API_KEY>:")` for the CLI when
`ZERION_API_KEY` is set and it is not: the credential Confidential HTTP
templates into Zerion's header ([Confidential HTTP](#confidential-http)).

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

## Deploy (once deploy access is granted)

1. `cre account access` until `cre whoami` shows deploy access.
2. Point both receivers at the production forwarder and lock them to the
   workflows (`packages/contracts/README.md`, "Forwarders on Monad testnet"):
   `setForwarderAddress(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`,
   `UnderwritingReceiver.setSimulationTransmitter(0)`,
   `setExpectedAuthor(<workflow owner>)`, `setExpectedWorkflowName("polaris-collections" | "polaris-underwrite")`,
   and `setExpectedWorkflowId(<id>)` with the id `cre workflow hash <dir> -T production-settings` prints.
3. `pnpm --filter @polaris/cre-workflows configure production --authorized-key <address the API signs trigger requests with>`
4. `pnpm --filter @polaris/cre-workflows cre secrets create ./secrets.yaml -T production-settings --secrets-auth=browser`
5. `pnpm --filter @polaris/cre-workflows cre workflow deploy ./collections -T production-settings` and the same for `./underwriting`.

The private registry allows three workflows per organisation: deploy these
two, not staging copies.

## Anyone can run the collections

There is no fallback keeper. Every action a collections report carries is
permissionless on its target: `PolarisLoanEngine.collectInstallment(id)` and
`liquidate(id)`, `PolarisPayments.chargeDue(id)`. The schedule the buyer
signed decides what moves and when, so a stranger calling them can only do
what the buyer already agreed to, and `CollectionsReceiver.checkTasks` (a
view) says which are due. If CRE is down, anyone (us, a merchant, a bot) can
call them directly; `packages/contracts/lib/cre.js` builds the same task list.

## Layout

| Path | What |
|---|---|
| `project.yaml` | CRE targets: `local-settings` (the node on :8620), `staging-settings` (Monad testnet, simulation forwarder), `production-settings` (Monad testnet, deployed DON); each also reads `monad-mainnet` (https://rpc.monad.xyz) |
| `secrets.yaml`, `.env.example` | Secret ids → environment variables for simulation; the Vault DON once deployed |
| `collections/`, `underwriting/` | `main.ts` (the WASM entry), `workflow.yaml`, `config.<target>.json`, a strict `tsconfig.json` with no Node/DOM/Bun types |
| `src/collections/` | `workflow.ts` (the handler), `candidates.ts` (Envio query, chain window), `backoff.ts` (the dunning ladder when the chain proposes), `tasks.ts` (report encoding, batching), `outcomes.ts` (receipt → dunning events) |
| `src/underwriting/` | `workflow.ts`, `consent.ts` (the account's consent), `thin.ts` (facts it will not attest), `link.ts` (the history wallet's proof; both verified synchronously with @noble/curves), `evidence.ts` (the recipe over CRE's HTTP client in node mode, or over Confidential HTTP), `report.ts`, `payload.ts` |
| `src/shared/` | Config schemas, EVM helpers (reads, gas, write, receipt), the signed callback |
| `src/trigger.ts` | `triggerSimulatedUnderwriting` for the API (`underwriteConsentMessage` is `@polaris/cre-workflows/consent`) |
| `scripts/` | `install-cre.mjs`, `cre.mjs`, `bun.mjs`, `configure.mjs`, `underwriting-payload.mjs`, `local-chain.mjs`, `e2e-local.mjs`, `hardhat.cre-local.config.cjs`, `evidence.mjs`, `collections-loop.mjs`, `sim.mjs` (what those two share) |
| `evidence/` | What real CLI runs left: `<date>/` from `evidence`, `loop/` from `collections:loop` |
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
   fallback is never silent: the result's `indexerError` names the failure,
   and the run posts its callback even when nothing else happened, with
   `candidates: { source: "chain", indexerError }`, for the API to raise.
   **The dunning ladder holds there too** (`candidates.chainBackoff`,
   [`src/collections/backoff.ts`](src/collections/backoff.ts)). The chain
   keeps no failure history, and CRE reads logs 100 blocks at a time, so the
   ladder is counted from each task's due time, which the chain does know
   (one `getLoan` / `getSubscription` read per due task): rungs at the due
   time, then 6 h, 24 h, 72 h and 168 h after the one before (the indexer's
   `dunningRetrySeconds`), the last repeating. A task is tried only by a run
   within `windowSeconds` of a rung: 120 s in staging (a run every minute),
   86,400 s in production (a run a day), 30 s locally. A loan past grace is
   always tried (collection, then liquidation if that fails), and so is a
   renewal past its 7-day charge window (the charge then records the miss).
   Held-back tasks and their next attempt are in the result's `heldBack`.
   Limits, stated: a run that misses a rung's window (a simulate loop that
   skipped a minute) leaves that task for the next rung, and a task whose due
   time the read quota leaves unread waits for a later run.
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
| `Error("…allowance…")`, `Error("…balance…")` (a token that reverts with a message) | `allowance_lost`, `insufficient_funds` | as above |
| anything else | `…failed`, `reason: "other"` | (a person looks) |

The reasons are polarispay-sdk's `InstallmentFailureReason`, word for word
(`test/dunning.test.ts` holds them to `packages/sdk/src/events.ts`), so the
API forwards them to the merchant's `installment.failed` webhook unchanged.
The Envio indexer records the same words in `reasonAction` (plus `stale`), and
the same test holds every revert it decodes to the workflow's classification.
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
`onChainScore`), `refused` (with the reason, decoded against every error in
ScoreManager's and UnderwritingReceiver's ABIs: `ThinFile(days, txs)`,
`StaleEvidence`, `AlreadyHasRecord`, `WalletAlreadyLinked`,
`UserIsLinkedHistory`, `WalletAlreadyUnderwritten`, …; the last three are also
checked before any provider call, with `linkedUserOf` and
`profileOf(wallet).underwritten`, and refused with no report and a signed
`credit.refused` callback), `incomplete` (evidence missing,
no report, retry later: missing data is never attested as zero), `thin`
(final, but nothing a new account could not show: no report, and a signed
`credit.thin` callback, see `src/underwriting/thin.ts`), `skipped`
(already underwritten; no provider call spent), or `rejected` (no consent
from the account, a bad proof or payload; nothing read or spent).

With `confidentialHttp: false`, node mode sends each request with
`cacheSettings: { store: true, maxAge }`, so one node's paid Nansen call
serves the DON (best effort), and adds each node's key only there: Nansen
`apikey` header, Zerion `Authorization: Basic`, Etherscan `&apikey=`. With it
on, see the next section.

#### Confidential HTTP

`confidentialHttp: true` (staging and local; production keeps `false` until a
deployed run shows Monad's DON serves the capability) sends the paid calls,
Nansen, Zerion and Etherscan, through CRE's Confidential HTTP capability
(`confidential-http@1.0.0-alpha`, `cre.capabilities.ConfidentialHTTPClient` in
SDK 1.22.0). The public RPC calls (send counts on Ethereum and Base) stay on
the plain HTTP client, agreed by identical consensus.

- **Keys never leave the enclave.** The workflow never calls `getSecret` for a
  provider: it sends `{{.NANSEN_API_KEY}}`-style placeholders and names the
  secret in `vaultDonSecrets`; the enclave resolves them from the Vault DON
  (from `secrets.yaml` and the environment under simulation). With the switch
  off, every node reads every key into its own memory.
- **Each provider is called once.** One request leaves the enclave after the
  nodes agree on its parameters, instead of one per node, which is what
  Nansen's 10 free credits a day can afford.
- **The trade-off:** the DON trusts one enclave's answer. With the switch off,
  every node calls the provider and the report carries the median of their
  counts, so one bad response is outvoted; with it on, the facts are only as
  good as the one response the enclave got (its attestation is what vouches
  for it). The response is not encrypted (`encryptOutput: false`), because the
  report needs the facts in the clear.
- **What changes on the wire:** Zerion's header needs the ready credential,
  `ZERION_BASIC_AUTH = base64("<key>:")`, because a placeholder cannot be
  base64-encoded inside the enclave (the scripts derive it). Etherscan takes
  its key in the query string, which the enclave does not template (it fills
  headers and a POST body: chainlink `core/capabilities/fakes/confidential_http_action.go`,
  the simulator's implementation), so the request becomes a POST with the
  parameters still in the URL and `apikey={{.ETHERSCAN_API_KEY}}` as the form
  body. Etherscan reads a key from a POST body (checked 28 Sep 2026 with an
  invalid key: "Invalid API Key (#err2)", as from the query string); a real
  key's first run is the proof that it reads the rest the same way.
- A request that already contains `{{` is refused rather than templated, so
  no input can name a secret. The same 15-call budget covers both clients.

#### Reading Monad mainnet

Every target in `project.yaml` also lists `monad-mainnet` with the public RPC
`https://rpc.monad.xyz`. Chainlink's AUSD/USD, MON/USD and EUR/GBP/JPY/CAD/CHF
feeds exist only on Monad mainnet, so a workflow that writes to testnet reads
them there with an EVM client for the `monad-mainnet` selector. Nothing here
holds a mainnet key or writes to mainnet; the reads are free.

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
with the command that fills them (`configure`, which `evidence` runs for
you). Everything else is real: the forwarders (verified on chain,
docs/research/cre.md §4), AUSD and USDC on Monad testnet, the provider
endpoints, gas bounds and schedules.

| Key | Workflow | What it does |
|---|---|---|
| `candidates.chainBackoff` | collections | `{ ladderSeconds, windowSeconds }`, or `null` to try every due task every run: the dunning ladder when the chain proposes |
| `confidentialHttp` | underwriting | `true`: the paid calls through Confidential HTTP; `false`: every node calls them with its own key |
| `secrets.zerionBasicAuth` | underwriting | The secret id of `base64("<Zerion key>:")`, used only under `confidentialHttp` |
| `secrets.nansen`, `.zerion`, `.etherscan` | underwriting | Secret ids of the provider keys; `null` leaves a provider out |

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
- `test/backoff.test.ts` and the ladder cases in
  `test/collections.workflow.test.ts`: the rungs (due, +6 h, +24 h, +72 h,
  +168 h, repeating) are the indexer's `dunningRetrySeconds`; a run per window
  tries each rung once; a task between rungs is held back with its next
  attempt; a loan past grace and a renewal past its charge window never wait;
  the reads stay inside the quota; the indexer's candidates are not read twice.
- `test/underwriting.workflow.test.ts`, Confidential HTTP: the same facts as
  every node calling the providers, from one enclave call per paid request;
  only placeholders leave the workflow (no key value, one listed secret per
  request, Etherscan's in a POST body); no provider key is read; the thin-file
  gate and the 15-call budget hold. Pre-checks: `UserIsLinkedHistory`,
  `WalletAlreadyLinked` and `WalletAlreadyUnderwritten` are refused before any
  provider or enclave call, with a signed `credit.refused`; every refusal the
  contracts can record is named.
- `test/evidence-script.test.ts`: the evidence and loop scripts read a run
  from the CLI's own output format, find its transaction, read the receipt's
  `ReportProcessed`, refuse (logged out, no deployment, a missing address,
  another chain, no transmitter key) before sending anything, and redact every
  secret.
- `test/thin.test.ts` and the thin-file cases in
  `test/underwriting.workflow.test.ts`: an account with no history (or only
  dollars) gets no report and no $200 line; it opens once a history wallet
  is brought; a declined file is still reported.
- `test/payload-script.test.ts`: what `simulate:underwriting` writes
  (`scripts/underwriting-payload.mjs`) is a payload the workflow accepts,
  with and without a history wallet.
- `test/consent.test.ts`: the consent text byte for byte, bound to the
  account, the wallet (or none), the chain and 15 minutes, and checked the
  way viem's own verifier checks it.
- `e2e/local-chain.e2e.test.ts` (`e2e:local`): on real contracts, the
  account's consent and a proof become facts and ScoreManager opens a line at
  the mirror's score, while a brand-new account alone is a thin file: no
  report, and `creditLimitOf` stays 0; a Pay in
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
| `cre workflow simulate --broadcast` on Monad testnet | ready (`evidence`, `collections:loop`); needs `cre login` and a funded `CRE_ETH_PRIVATE_KEY`. Its runs land in [`evidence/`](evidence/) |
| Monad testnet | waits for `deploy:monad`; `evidence` then fills `config.staging.json` from the record |
| Monad mainnet reads | every target reads `monad-mainnet` (public RPC); nothing writes there |
| Confidential HTTP | on in staging and local; production off until a deployed run shows Monad's DON serves it |
| Deploy to the DON | waits for deploy access (`cre account access`) |
| The Polaris API side of the callback | done: `apps/business` `POST /api/cre/callback` verifies the HMAC (`POLARIS_CRE_CALLBACK_SECRET`), records `credit.underwritten` / `credit.refused` / `credit.thin` for the app, and runs the chain sync on `collections.run`. The committed configs keep `callback: null` until a deployment has an API URL to put there |
| Firing `polaris-underwrite` from the product | done: the app's **Raise your limit** (Bring your history) signs the consent and the history wallet's proof; `apps/business` `POST /api/credit/underwrite` verifies both and fires the HTTP trigger at most once per 30 s (`CRE_UNDERWRITING_TRIGGER_URL`) |
| Without a CRE login | `pnpm --filter @polaris/cre-workflows trigger:local` (`scripts/local-trigger.mjs`) serves the same trigger URL on a local chain: each request runs this `polaris-underwrite` handler on the SDK's test runtime (fixture evidence, the local forwarder) and posts its signed callback. It is not the CLI or a DON. `pnpm demo:local` starts it |
| The indexer schema | `DUE_CANDIDATES_QUERY` is the indexer client's `DUE_CANDIDATES`, validated against `packages/indexer/schema.graphql` |
| Dunning backoff without the indexer | done: the ladder from each task's due time (`candidates.chainBackoff`) |
| Provider calls | Nansen, Zerion and Etherscan have only answered from synthesized fixtures here; a live run needs their keys in `workflows/.env` |

## Limits that shaped this (docs/research/cre.md §8)

15 EVM reads and 15 HTTP calls per execution; 5 KB per read request; 10M gas
and 50 KB per report; cron no faster than 30 s; the HTTP trigger once per 30 s.

## Attribution

`@chainlink/cre-sdk` (BUSL-1.1, a dependency, not vendored; it converts to MIT
on 20 May 2029), the CRE CLI (MIT, downloaded from Chainlink's GitHub
releases, not committed), viem, zod and @noble/curves / @noble/hashes (MIT).
Written with Claude Code.
