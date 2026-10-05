# @polaris/cre-workflows

**Chainlink CRE is Polaris's credit engine.** Three workflows, written with
the official TypeScript SDK (`@chainlink/cre-sdk` 1.22.0), orchestrate Pay in 4
on Monad with all three CRE trigger types: one decides who gets credit (HTTP),
one collects what is owed (cron, plus an EVM log trigger that collects the
moment a dunned buyer re-signs), and one guards the pool (cron), bringing
Chainlink's AUSD/USD Data Feed from Monad mainnet to the pool on Monad testnet,
where new Pay in 4 plans pause on a depeg or a stale price (and, read from the
pool itself, a cash shortfall or bad debt).

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
 every minute (demo) ────▶ polaris-collections, trigger 0 (cron)                     │
 daily (production)      │  candidates: Envio GraphQL, else the chain's own counts,  │
                         │    both on the dunning ladder (6h, 24h, 72h, 168h)        │
                         │  EVM read: CollectionsReceiver.checkTasks (the chain       │──▶ CollectionsReceiver
                         │            disposes: only what is due at a final block)   │      ├▶ collectInstallment
 buyer re-signs ─────────▶ polaris-collections, trigger 1 (EVM log trigger:          │      ├▶ chargeDue
 PolarisCheckout         │    PolarisCheckout.Reauthorized, finalized)               │      └▶ liquidate
 .reauthorize(permit)    │  EVM read: CollectionsReceiver.dueTasksFor(buyer)         │
                         │  both: one signed report, gas = its own estimate + 15%;   │
                         │  receipt read back: skip reasons → dunning events         │
                         │                                                           │
 every minute (demo) ────▶ polaris-guardian (cron trigger)                           │
 every 10 min (prod)     │  Monad MAINNET: Chainlink AUSD/USD latestRoundData        │
                         │  Monad testnet, one finalized block: header, then         │──▶ GuardianReceiver
                         │    GuardianReceiver.currentInputs (free cash, owed, bad   │      (re-checks the verdict; reads
                         │    debt, originated, the owner's thresholds)              │       the pool live; a feed)
                         │  verdict: depeg | low cash | bad debt | stale price       │      └▶ PolarisCheckout.openPlan
                         │  written on a change, a heartbeat or a large move         │         refuses Pay in 4 while
                         └───────────────────────────────┬───────────────────────────┘         paused; Pay now, Send,
                                                         │                                      Subscribe never ask
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
- **CRE is how collections run on schedule.** Instalments, subscription
  renewals and liquidations happen when a `polaris-collections` report is
  delivered to `CollectionsReceiver`, and the dunning ladder hears about
  failures from the same run. Anyone can also call them directly on the loan
  engine ([Anyone can run the collections](#anyone-can-run-the-collections)):
  the workflow is the schedule, not a gate.
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
- **No healthy peg, no new Pay in 4.** `PolarisCheckout.openPlan` asks
  `GuardianReceiver` first. What only CRE can bring is the price: Chainlink's
  AUSD/USD lives on Monad mainnet, the pool on Monad testnet, and the
  `polaris-guardian` report carries the round it read. The receiver checks
  the report's verdict against the thresholds the owner sets on chain and
  refuses one that disagrees; it trusts the DON for the mainnet price, and
  for nothing on its own chain: it reads the pool's free cash and bad debt
  itself on every call (a report whose pool verdict is not the live pool's is
  refused), so no report can pause or resume credit on the pool's figures.
  The price reasons fail open once the latest attestation is older than
  `maxAttestationAge` (an hour), so an outage of CRE never locks buyers out;
  the pool's never do.
- **A re-signed buyer is collected in seconds, not hours.** A lost allowance
  is dunned on the ladder (the next try 6 h later). The buyer's fresh permit
  goes through `PolarisCheckout.reauthorize`, whose `Reauthorized` log fires
  collections' EVM log trigger, which collects that buyer's due instalments in
  the next block (`e2e:local`: one block, one second).

| Bounty requirement (Chainlink CRE, plan §3) | Where it is met |
|---|---|
| Build a CRE workflow | Three: [`collections/main.ts`](collections/main.ts) → [`src/collections/workflow.ts`](src/collections/workflow.ts) (+ [`retry.ts`](src/collections/retry.ts)), [`underwriting/main.ts`](underwriting/main.ts) → [`src/underwriting/workflow.ts`](src/underwriting/workflow.ts), [`guardian/main.ts`](guardian/main.ts) → [`src/guardian/workflow.ts`](src/guardian/workflow.ts); `project.yaml`, `workflow.yaml`, `secrets.yaml`, per-target configs |
| Used as an orchestration layer | All three trigger types: cron (collections, guardian), HTTP (underwriting), EVM log (collections' retry on `PolarisCheckout.Reauthorized`). EVM reads on two chains in one run (the guardian: Chainlink AUSD/USD on Monad mainnet, the pool on Monad testnet at one finalized block via `headerByNumber`); `checkTasks`, `dueTasksFor`, `profileOf`, `linkedUserOf`, `balanceOf`, gas estimates, receipts; HTTP with consensus (Envio, Nansen, Zerion, Etherscan, RPC); Confidential HTTP; signed reports written through the forwarder, each changing what the contracts do next (credit lines, collections, the Pay in 4 pause); a signed callback the Polaris API verifies and acts on (`apps/business` `POST /api/cre/callback`) |
| Simulate or deploy | `cre workflow simulate … --broadcast` against the local Monad stand-in or Monad testnet (needs `cre login`, see below), one command per trigger; `pnpm --filter @polaris/cre-workflows evidence` runs each workflow once on Monad testnet (and the log trigger on a real `reauthorize` with `--retry-tx`) and keeps its log and transaction hashes in [`evidence/`](evidence/); `cre workflow build` compiles all three to WASM without a login. **Run on Monad testnet on 28 Sep 2026** ([`evidence/2026-09-28/`](evidence/2026-09-28/)): collections on its log trigger (`0x1116fbb4…`) and its cron (`0xd7bcf41e…`), and the guardian (`0x015bd95d…`), each delivered by Chainlink's monad-testnet forwarder with `result=true`; underwriting ran and returned `incomplete` without provider keys |
| Monad | Writes to Monad testnet (10143) through Chainlink's forwarder; every target in `project.yaml` also reads Monad mainnet (143), where the guardian reads Chainlink's AUSD/USD feed (`0xE207…9e13`), without writing there |
| Chainlink privacy | The paid provider calls go through CRE's Confidential HTTP (a switch, on in simulation): see [Confidential HTTP](#confidential-http). Implemented and unit-tested on the SDK's test runtime; **not yet exercised against the real capability** (that needs a CLI run with a provider key) |

## One command

```bash
pnpm install
pnpm --filter @polaris/cre-workflows test        # unit tests on the CRE SDK's test runtime
pnpm --filter @polaris/cre-workflows e2e:local   # the three workflows against real contracts on a local node
```

`e2e:local` starts a Hardhat node on `127.0.0.1:8620` (`POLARIS_CRE_LOCAL_PORT`
moves it) with chain id 10143, deploys every Polaris contract with
`packages/contracts`' own deploy script, plants the mock forwarder at
Chainlink's simulation-forwarder address, and runs the workflows' handlers
(the code `cre workflow build` compiles) with their EVM capability bridged to
that node. See [What the tests prove](#what-the-tests-prove).

To build the WASM and simulate with the real CLI:

```bash
pnpm --filter @polaris/cre-workflows cre:install   # CRE CLI v1.35.0 from GitHub releases: SHA-256 + Authenticode checked, into workflows/.tools
pnpm --filter @polaris/cre-workflows build         # the three workflows → WASM (no login needed)
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
pnpm --filter @polaris/cre-workflows simulate:guardian local-settings
```

Locally the guardian reads the stand-in's own `MockPriceFeed` (described as
"AUSD / USD (local mock, not Chainlink)" and labelled `kind: "mock"` in every
result), so a depeg there is `setAnswer` on it; staging and production read
Chainlink's AUSD/USD on Monad mainnet, and `configure` refuses a testnet
deployment that records anything else.

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
pnpm --filter @polaris/cre-workflows simulate:guardian staging-settings
```

Every trigger, one command each (from `workflows/`, `cre` being the CLI; the
`pnpm` scripts above are the first three):

| Workflow, trigger | `cre workflow simulate …` |
|---|---|
| `polaris-collections`, 0: cron | `./collections -T staging-settings --non-interactive --trigger-index 0 --broadcast` |
| `polaris-collections`, 1: EVM log (`Reauthorized`), one past event | `./collections -T staging-settings --non-interactive --trigger-index 1 --evm-tx-hash <reauthorize tx> --evm-event-index 1 --broadcast` (`pnpm … simulate:retry staging-settings --evm-tx-hash <tx>`) |
| `polaris-collections`, 1: EVM log, live | `./collections -T staging-settings --non-interactive --trigger-index 1 --listen --broadcast` (`pnpm … retry:listen --broadcast`) |
| `polaris-underwrite`, 0: HTTP | `./underwriting -T staging-settings --non-interactive --trigger-index 0 --http-payload ./underwriting/payload.json --broadcast` (`--listen` for the API) |
| `polaris-guardian`, 0: cron | `./guardian -T staging-settings --non-interactive --trigger-index 0 --broadcast` |

The log trigger under simulation: CLI v1.35.0 fires trigger 1 either from one
past transaction (`--evm-tx-hash` with `--evm-event-index`, the position of
the log in that transaction's receipt: `Reauthorized` comes after the token's
own `Approval` from the permit, so 1, which `e2e:local` checks and `evidence
--retry-tx` reads from the chain), or live with `--listen`, which watches the
chain for logs matching the trigger's filter and runs the simulator on each
(the CLI refuses `--listen` with `--evm-tx-hash`). The transaction to point it
at is a `PolarisCheckout.reauthorize(buyer, permit)`, which the relayer sends
for the buyer (the relayer allow-list entry "Re-sign: PolarisCheckout.reauthorize").

Cron does not schedule under simulation: each `simulate` fires once, at the
schedule's next tick (the simulator waits for it and stamps that exact time).
For the demo's "every minute", keep them running (one terminal each):

```bash
pnpm --filter @polaris/cre-workflows collections:loop --broadcast   # polaris-collections every minute (or CRE_LOOP_BROADCAST=1); no flag: dry runs
pnpm --filter @polaris/cre-workflows guardian:loop --broadcast      # polaris-guardian every minute
pnpm --filter @polaris/cre-workflows retry:listen --broadcast       # collections' log trigger, live
```

`scripts/collections-loop.mjs` (`--workflow collections|guardian`) builds the
WASM once, then starts `simulate --wasm` again as soon as a run ends, so every
minute's tick gets a run. Each run's output (secrets redacted) is appended to
`evidence/loop/<UTC date>.log` (`<date>-guardian.log` for the guardian), and
one JSON line to the matching `.jsonl`: the outcome, the tasks or the
verdict, what the dunning ladder held back, the transaction hash.
`--target local-settings` runs it against the local stand-in, `--runs <n>`
stops after n runs. It refuses to start when you are not logged in, when the
workflow's `config.<target>.json` has no addresses, or when `--broadcast` has
no `CRE_ETH_PRIVATE_KEY`. The guardian writes only when it has something new
(see [`polaris-guardian`](#polaris-guardian)), so most of its minutes send
nothing. `scripts/retry-listen.mjs` keeps `simulate --listen` on trigger 1
running and cuts each finished run out of its output into
`<date>-retry.log` / `.jsonl`.

### The evidence, in one command

```bash
pnpm --filter @polaris/cre-workflows evidence                                   # every workflow, once, on Monad testnet
pnpm --filter @polaris/cre-workflows evidence --only collections,guardian       # or some of them
pnpm --filter @polaris/cre-workflows evidence --only collections --retry-tx 0x… # and collections' log trigger on a real reauthorize
```

`scripts/evidence.mjs` refuses, before anything is sent, unless: `cre whoami`
says you are logged in; `packages/contracts/deployments/monad-testnet.json`
(or `--deployment <file>`) exists, is on Monad testnet, and has every address
the workflows need (collections also needs PolarisCheckout, the guardian
GuardianReceiver); `CRE_ETH_PRIVATE_KEY` is set, holds testnet MON, and is
every receiver's `simulationTransmitter()` (read on chain; only its address
is printed); every variable the workflows' secrets files name is defined (see
below); a `--retry-tx` is a transaction with PolarisCheckout's
`Reauthorized` in it; a `--callback <url>` comes with
`POLARIS_CALLBACK_SECRET`, the key it is signed with. Then it fills the three `config.staging.json` from the
record (`configure staging`), keeps `cre workflow supported-chains`, and runs
each workflow with `simulate --broadcast` (underwriting with a freshly signed
payload; with `--retry-tx`, collections' trigger 1 too, as
`collections-retry`). Every hash in a result or a log is read back from Monad
testnet: landed or reverted, the block, and the forwarder's `ReportProcessed`
result for the receiver (a log-triggered run's own write only, not the
`reauthorize` that fired it). It writes `evidence/<UTC date>/<run>-<time>.log`,
`runs.json` and a `README.md` table, and prints the table (and warns if
git would ignore any of those files: the root `.gitignore` keeps
`workflows/evidence/**/*.log`). A run that wrote nothing (nothing due, a thin
file, a guardian with nothing new) is recorded as such: no hash is invented.

A run whose config must differ from the committed one gets its own, for that
run only, through `simulate --config` (written to `workflows/.local/evidence/`,
and named in the log's header and `runs.json`'s `configChanges`):

- **underwriting without the providers that have no key.** Under
  Confidential HTTP the workflow never reads a key, so it cannot tell an
  empty one from a real one; without this the enclave would template `""`
  into each paid request and spend the run's calls on 401s.
- **`--callback <url>`:** collections and underwriting post their signed run
  callback to that URL (the Polaris API's `/api/cre/callback`, local or not),
  so the HTTP capability shows in the log. The committed staging config keeps
  `callback: null`, and so a testnet run without it makes no HTTP call at all:
  its candidates come from the chain.

**Secrets under simulation.** CLI v1.35.0 resolves every name in the secrets
file a workflow.yaml target points at before the run, and aborts the whole
run on one that is not set at all ("environment variable X for secret value
not found"), whether or not the workflow reads it. So the guardian points at
no secrets file (`secrets-path: ""`), collections at its own
(`collections/secrets.yaml`: only `POLARIS_CALLBACK_SECRET`), underwriting at
`secrets.yaml` (the provider keys and the callback key; `cre secrets create`
uploads this one). Every script that starts `cre workflow simulate` here
(`cre`, the `simulate:*` scripts, the loops, `retry:listen`, `evidence`)
defines each of those variables that neither the shell nor `workflows/.env`
sets, as `""` (a key that is not configured, which every workflow reads as
missing; a value in either place always wins), puts the pinned Bun on PATH
(the CLI compiles TypeScript with it), and sets
`ZERION_BASIC_AUTH = base64("<ZERION_API_KEY>:")` when `ZERION_API_KEY` is
set and it is not: the credential Confidential HTTP templates into Zerion's
header ([Confidential HTTP](#confidential-http)). A bare `cre` run needs
them in `workflows/.env` (`.env.example` lists them).

For live underwriting, keep the simulator listening and let the API queue
requests (the HTTP trigger fires at most once per 30 s):

```bash
pnpm --filter @polaris/cre-workflows cre workflow simulate ./underwriting -T staging-settings --listen --broadcast
# the API: triggerSimulatedUnderwriting({ user, consent, linked }) from @polaris/cre-workflows/trigger
```

**The demo's depeg (decision 28).** AUSD sits at about $0.9998, so the guard
is shown by raising its threshold, not by faking a price: the owner sets the
depeg line above the real price. GuardianReceiver judges the latest attested
round by the new line at once, and the next guardian run reads the real
Chainlink round again and attests the pause; restoring the line resumes it
(at once, and attested on the next run). Caption it "threshold raised for
demo".

```bash
GUARD_ACTION=thresholds GUARD_MIN_PRICE=1.001 pnpm --filter @polarispay/contracts guardian:monad   # owner only
pnpm --filter @polaris/cre-workflows simulate:guardian staging-settings                            # verdict: paused (depeg)
GUARD_ACTION=thresholds pnpm --filter @polarispay/contracts guardian:monad                        # back to the defaults
pnpm --filter @polaris/cre-workflows simulate:guardian staging-settings                            # verdict: healthy, resumed
```

**Under simulation a reverted receiver still reads as success** (the mock
forwarder swallows the revert). Every workflow therefore reads its own
receipt and fails the run when the forwarder's `ReportProcessed` says
`result = false`; judge a run by `TaskExecuted` / `TaskSkipped` /
`UnderwritingApplied` / `UnderwritingRefused` / `CreditGuardUpdated` /
`AttestationRefused`, never by the CLI's status.

## Deploy (once deploy access is granted)

1. `cre account access` until `cre whoami` shows deploy access.
2. `cre workflow supported-chains`: check that Monad testnet (and Monad
   mainnet, for the guardian's read) are there for the organisation.
3. `pnpm --filter @polaris/cre-workflows configure production --authorized-key <address the API signs trigger requests with>`
4. `pnpm --filter @polaris/cre-workflows cre secrets create ./secrets.yaml -T production-settings --secrets-auth=browser`
5. `pnpm --filter @polaris/cre-workflows cre workflow deploy ./collections -T production-settings`, and the same for `./underwriting` and `./guardian`.
6. Lock the three receivers to them: `CRE_WORKFLOW_OWNER=<owner> CRE_WORKFLOW_ID_COLLECTIONS=… CRE_WORKFLOW_ID_UNDERWRITE=… CRE_WORKFLOW_ID_GUARDIAN=… pnpm --filter @polarispay/contracts lock-receivers:monad`
   (author, name, id, then the production forwarder `0xF834…4482`, then the
   simulation transmitter cleared; the ids are what `cre workflow hash <dir>
   -T production-settings` prints).

The private registry allows three workflows per organisation: deploy these
three, not staging copies. If a deployed DON turns out not to serve EVM log
triggers on Monad, `retry: null` in `collections/config.production.json`
deploys collections on its cron alone (the ladder then retries a re-signed
buyer at the next rung).

## Anyone can run the collections

CRE is how collections run on schedule, but it is not a gate. There is no fallback keeper. Every action a collections report carries is
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
| `collections/`, `underwriting/`, `guardian/` | `main.ts` (the WASM entry), `workflow.yaml`, `config.<target>.json`, a strict `tsconfig.json` with no Node/DOM/Bun types |
| `src/collections/` | `workflow.ts` (both handlers and the delivery they share), `retry.ts` (the `Reauthorized` log trigger: filter, decoding), `candidates.ts` (Envio query, chain window), `backoff.ts` (the dunning ladder when the chain proposes), `tasks.ts` (report encoding, batching), `outcomes.ts` (receipt → dunning events) |
| `src/underwriting/` | `workflow.ts`, `consent.ts` (the account's consent), `thin.ts` (facts it will not attest), `link.ts` (the history wallet's proof; both verified synchronously with @noble/curves), `evidence.ts` (the recipe over CRE's HTTP client in node mode, or over Confidential HTTP), `report.ts`, `payload.ts` |
| `src/guardian/` | `workflow.ts` (the handler: two chains, one report), `attestation.ts` (the report, the verdict, the write policy; pure, and `@polaris/cre-workflows/guardian` for the apps) |
| `src/shared/` | Config schemas, EVM helpers (reads at a block, the finalized header, `writeSized`, receipt), the signed callback |
| `src/trigger.ts` | `triggerSimulatedUnderwriting` for the API (`underwriteConsentMessage` is `@polaris/cre-workflows/consent`) |
| `scripts/` | `install-cre.mjs`, `cre.mjs`, `bun.mjs`, `configure.mjs`, `underwriting-payload.mjs`, `local-chain.mjs`, `e2e-local.mjs`, `hardhat.cre-local.config.cjs`, `evidence.mjs`, `collections-loop.mjs` (collections and guardian), `retry-listen.mjs`, `sim.mjs` (what those share); without a CRE login, `local-trigger.mjs`, `local-collections.mjs` and `local-guardian.mjs` (below) |
| `local/` | One run of each workflow on the SDK's test runtime against a local chain, for those three runners: `underwrite.run.ts`, `collections.run.ts` (either trigger), `guardian.run.ts`; `config.ts` builds their configs in memory from the staging templates and the deployment record |
| `evidence/` | What real CLI runs left: `<date>/` from `evidence`, `loop/` from the loops and the listener |
| `test/` | Unit tests (`bun test`, `@chainlink/cre-sdk/test`) |
| `e2e/` | The local-chain round trip |

## Reference

### `polaris-collections`

Report: `abi.encode(uint8 kind = 1, (uint8 action, uint256 id)[] tasks)`;
action 1 collects an instalment, 2 charges a subscription, 3 liquidates. Two
triggers write it: trigger 0, the cron (below), and trigger 1, the EVM log
trigger on `PolarisCheckout.Reauthorized` ([the instant retry](#trigger-1-the-instant-retry-evm-log-trigger)).

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
   undershoot that way. One exception: behind the public simulation
   forwarder, all three Polaris receivers accept deliveries only from their
   `simulationTransmitter()` (PolarisReceiver), so they refuse an estimate
   sent from the forwarder's address; the workflow reads that function (a
   receiver without it just reverts, which means no check) and, when a
   transmitter is set, estimates the whole delivery from it
   (`shared/evm.ts` `writeSized`, the one write path of all three
   workflows). The run still fails loudly if the forwarder's
   `ReportProcessed` says the receiver reverted.
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
`checkTasks` batches, one due-time read per due task on the chain's ladder,
and three kept for the write (the receiver's transmitter, the estimate, the
receipt); it checks fewer candidates, and says so, rather than exceed it.

#### Trigger 1: the instant retry (EVM log trigger)

`retry: { checkout, confidence }` registers a second handler:
`evmClient.logTrigger(logTriggerConfig({ addresses: [PolarisCheckout],
topics: [[keccak256("Reauthorized(address,uint256,uint256)")]], confidence:
"FINALIZED" }))` ([`src/collections/retry.ts`](src/collections/retry.ts)).
Only PolarisCheckout's own event fires it, for any buyer.

1. A buyer skipped for `InsufficientAllowance` is dunned (`allowance_lost`,
   "sign again"). They sign AUSD's ERC-2612 permit, spender the loan engine,
   value at least `activeDebtOf(buyer)`; the relayer submits
   `PolarisCheckout.reauthorize(buyer, permit)` (on its allow-list as "Re-sign:
   PolarisCheckout.reauthorize"), which checks the signature, applies the
   permit and emits `Reauthorized(buyer, value, deadline)` in one transaction.
2. The DON hears the log (finalized: about 800 ms on Monad, and never a
   permit a reorg removed). The handler decodes the buyer, refusing any log
   that is not PolarisCheckout's `Reauthorized` and doing nothing with a
   removed one, and reads `CollectionsReceiver.dueTasksFor(buyer)` at the
   last finalized block: one collect task per plan of theirs whose instalment
   is due now.
3. Nothing due (they re-signed before it fell due): no write, no callback;
   the cron collects it when it falls due. Otherwise the same kind-1 report
   through the same delivery as the cron (`deliver`: `writeSized`, receipt,
   dunning events, the signed callback, which now carries `trigger: { kind:
   "log", event: "Reauthorized", buyer, txHash, logIndex }`). A buyer still
   short of money is dunned again (`insufficient_funds`). Liquidation stays
   the cron's.

Reads: `dueTasksFor`, then the write's three: 4 of 15. The permit is the
buyer's own signature over the token's current nonce, so only the buyer can
cause the event, and a run writes only when something is due. It covers a lost
allowance only: a buyer without the money still waits for the ladder.

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

**Status: implemented and unit-tested on the SDK's test runtime (its mocks and
the underwriting package's synthesized fixtures); not yet exercised against
the real capability.** No run of the CLI has sent a real request through it:
that needs `cre login` and at least one provider key (a free Etherscan key is
enough), then `evidence --only underwriting`, whose log records the call.
Without a key, `evidence` leaves that provider out of the run's config, so
the run shows no Confidential HTTP call at all rather than a 401.

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
- **Under simulation there is no enclave.** `cre workflow simulate` stands in
  for it (chainlink's `DirectConfidentialHTTPAction`): it fills the
  placeholders from `secrets.yaml` and your environment and sends the request
  from your machine. What a simulated run shows is the workflow's side: the
  request shapes, one call per provider, and that the workflow never reads a
  key. The enclave's guarantee (keys decrypted only inside it) holds only for
  a deployed workflow, and whether Monad's DON serves the capability is
  unknown until one runs; production keeps the switch off until then.

#### Reading Monad mainnet

Every target in `project.yaml` also lists `monad-mainnet` with the public RPC
`https://rpc.monad.xyz`. Chainlink's AUSD/USD, MON/USD and EUR/GBP/JPY/CAD/CHF
feeds exist only on Monad mainnet, so a workflow that writes to testnet reads
them there with an EVM client for the `monad-mainnet` selector:
[`polaris-guardian`](#polaris-guardian) does, every run. Nothing here holds a
mainnet key or writes to mainnet; the reads are free.

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

### `polaris-guardian`

Pay in 4's risk guard, on a cron (every minute in staging, every 10 minutes
in production). [`src/guardian/workflow.ts`](src/guardian/workflow.ts),
[`src/guardian/attestation.ts`](src/guardian/attestation.ts). Each run:

1. **The pool, at one block.** `headerByNumber(LAST_FINALIZED)` on Monad
   testnet gives a block number and its timestamp (the run's `observedAt`);
   every read after it names that number, so the figures are one consistent
   state even though Monad's finalized head moves every 400 ms:
   `GuardianReceiver.currentInputs()` (PolarisLoanEngine's `poolState()`:
   free cash, what buyers owe, bad debt, lifetime originations; the
   thresholds the owner set; the bad debt the owner acknowledged),
   `creditStatus()`, `latestAttestation()`.
2. **The peg, on Monad mainnet.** A second EVM client, for `monad-mainnet`,
   reads Chainlink's AUSD/USD proxy `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13`
   at mainnet's last finalized block: `decimals()` must be 8 and
   `description()` "AUSD / USD" (a wrong address, or the 18-decimal SVR
   variant, fails the run instead of being rescaled), then `latestRoundData()`.
   Checked on chain on 28 Sep 2026: "AUSD / USD", 8 decimals, answer
   0.99982564, round 18446744073709559171 (phase 1, round 7555); the Flags
   registry lists the proxy as an official feed (research-monad.json).
3. **The verdict,** the same formula as `GuardianReceiver.evaluate`, with the
   thresholds read in step 1, so the owner changes policy on chain without
   touching the workflow:

   | Bit | Reason | Paused when (defaults) | Where GuardianReceiver takes it from |
   |---:|---|---|---|
   | 1 | depeg | price < `minPrice` ($0.995) or > `maxPrice` ($1.005) | the latest attestation (the DON's read of Monad mainnet), under today's thresholds; fails open once it is stale |
   | 2 | low cash | free cash < `minFreeCash` ($1,000) | the pool, read live on every call |
   | 4 | bad debt | once `minOriginated` ($10,000) is lent, bad debt beyond what the owner acknowledged > `maxBadDebtBps` (5%) of lifetime originations | the pool, read live on every call |
   | 8 | stale price | the round is older than `maxPriceAge` (2 h) at `observedAt`, or never updated | the latest attestation, under today's thresholds; fails open once it is stale |

   The ceiling catches an upward break and an absurd answer (a faulty feed
   can no longer only go stale). Bad debt is against lifetime originations,
   not today's book: bad debt never falls while the book shrinks with every
   repayment (GuardianReceiver's NatSpec has the reasoning). So a bad-debt
   pause does not lift by itself: the owner acknowledges the loss
   (`acknowledgeBadDebt()`, `GUARD_ACTION=acknowledge`), after which only new
   losses count, and nothing about the price is switched off. The
   `minOriginated` floor keeps one default on a young pool (the testnet pool
   has lent $200) from pausing Pay in 4 for everyone. Depeg and a stale price
   lift as soon as the price is back in the band; low cash as soon as the pool
   is funded.
4. **The write, when there is something new** (`writeDecision`, like a Data
   Feed's heartbeat and deviation threshold, because Monad bills every
   write's gas limit): the first attestation; a changed verdict (a pause, a
   resume, another reason), always at once; the latest attestation stale or
   `write.heartbeatSeconds` old (900 s staging, 1800 s production, both below
   the receiver's 3600 s `maxAttestationAge`, so a healthy guard never goes
   stale between writes); free cash x price moved by `write.deviationBps`
   (10%). Otherwise nothing is sent (`status: "unchanged"`), and a block no
   newer than the latest attestation is never sent (the receiver would
   refuse it as out of order).
5. **One report,** `abi.encode(uint8 3, Attestation)` with
   `Attestation = (uint80 priceRoundId, int256 price, uint64 priceUpdatedAt,
   uint256 freeCash, uint256 totalOwed, uint256 badDebt, uint256
   totalOriginated, uint64 observedAt, bool creditPaused, uint8 reasons)`,
   through `writeSized` like the other two, and the receipt read back:
   `CreditGuardUpdated(round, creditPaused, reasons, attestation)` means
   accepted (`status: "written"`, and `round` is the new round of the
   receiver's pool-health feed); `AttestationRefused(observedAt, reason)` is
   decoded (`VerdictMismatch`, `PoolMismatch`, `AttestationOutOfOrder`,
   `ObservationInFuture`, `AttestationTooOld`) into `status: "refused"`
   without failing the run: a threshold changed, or the pool crossed one,
   between the read and the write refuses one report, and the next run reads
   the chain anew. A reverted delivery fails the run.

What it moves on chain: `PolarisCheckout.openPlan` asks
`GuardianReceiver.isCreditPaused()` first and reverts
`CreditPausedByGuardian(reasons)` while it says paused. Pay now, Send,
Subscribe, collections, repayments and `reauthorize` never ask. What the
receiver trusts this workflow for is the price: it checks every report's
verdict against the thresholds on chain, reads low cash and bad debt from
the pool itself (so a report can neither pause credit by claiming an empty
pool nor keep it open through a real shortfall; either is `PoolMismatch`),
and judges the latest attested round by today's thresholds (a threshold
change applies at once). The price reasons fail open: no attestation, or one
older than `maxAttestationAge`, reads as no depeg (so a simulate-only setup,
which runs only when someone runs it, cannot lock Pay in 4); the pool's apply
whatever the attestations say. The owner's override outranks everything, and
a forced resume ends by itself (at most a day ahead). The receiver is also an
`AggregatorV3Interface` ("Polaris pool health, computed by CRE", 8 decimals):
each accepted attestation is a round whose answer is the pool's free cash
when the report landed (read from the pool, not the report) in dollars at
the attested price, or 0 while it pauses credit. That is a Polaris
attestation computed by a CRE workflow, not a Chainlink Data Feed or Proof of
Reserve.

The result says it all in one object: `status`, `why`, `transition` (first,
paused, resumed, reasons-changed, unchanged), `verdict { creditPaused,
reasons, reasonNames }`, `price { kind, chain, feed, answer, roundId,
updatedAt, ageSeconds }`, `pool { block, observedAt, freeCash, totalOwed,
badDebt, totalOriginated, badDebtAcknowledged }`, `thresholds` (with the
ceiling and the originations floor), `before` (what openPlan applied and
why: the pool's reasons and the price's, the override and until when,
staleness), `round`, `refusal`, `txHash`, `gasLimit`, `note`
(an owner override that decides, or a heartbeat that outlives the
attestation). Reads: at most 10 of 15 (header, 3 on the receiver, 3 on the
feed, the transmitter, the estimate, the receipt). No HTTP, no secrets.

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
| `retry` | collections | `{ checkout: <PolarisCheckout>, confidence: "FINALIZED" \| "SAFE" \| "LATEST" }`: trigger 1, the log trigger on `Reauthorized`; `null` runs on the cron alone. `configure` fills `checkout` |
| `priceFeed` | guardian | `{ chainSelectorName, address, decimals: 8, description, kind: "chainlink" \| "mock" }`: Chainlink AUSD/USD on `monad-mainnet` in staging and production; the labelled local mock on the stand-in |
| `write` | guardian | `{ heartbeatSeconds, deviationBps }`: when an unchanged verdict is re-attested (keep the heartbeat below the receiver's `maxAttestationAge`) |
| `receiver`, `forwarder` | guardian | GuardianReceiver and the forwarder it trusts; the thresholds are not config, they are read from GuardianReceiver every run |

### Callback (`callback.url`)

`POST` JSON with `Polaris-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
(the scheme `packages/db/src/webhooks.ts` signs merchant webhooks with) and
`Idempotency-Key`. Verify with `verifyCallback(secret, rawBody, header, now)`
from `@polaris/cre-workflows/callback`; event types are in
`@polaris/cre-workflows/events`. Every node may send it; key on `id`.

`collections.run` carries `txHash` (null for a run that wrote nothing),
`trigger` (`{ kind: "cron", scheduledAt }` or `{ kind: "log", event:
"Reauthorized", buyer, txHash, logIndex }`), `candidates: { source,
indexerError }` (`source: "event"` for the retry), `tally` and `events`; its
`id` is the transaction hash, or `collections:<scheduled tick>` for a cron run
that wrote nothing (a retry that wrote nothing posts nothing).
`polaris-underwrite` sends `credit.underwritten`, `credit.refused` and
`credit.thin`. `polaris-guardian` posts no callback: `CreditGuardUpdated` and
`GuardianReceiver.creditStatus()` are the record the apps read.

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
- `test/guardian.test.ts`: the guardian's report is byte-identical to
  `lib/cre.js` `encodeGuardianReport` and each side decodes the other's; it is
  11 static words whose tail is `GuardianReceiver.evaluate`'s own calldata;
  every threshold at its edge; on 5,000 seeded random attestations near every
  edge the verdict equals `lib/cre.js` `guardianReasons` (which the contract
  suite fuzzes against `evaluate`), the ceiling, the originations floor and
  the acknowledged bad debt included; which reasons the receiver reads from
  the pool and which from the report; the demo's raised threshold turns the
  real price into a depeg; the feed's answer saturates as the receiver's does;
  the write policy (first, verdict, stale, heartbeat, deviation, unchanged,
  not-newer); `polaris-guardian` hashes to `0x64383734313635346335`.
- `test/guardian.workflow.test.ts`: the handler with two EVM mocks, Monad
  testnet and Monad mainnet: the pool read at one finalized block by number,
  the feed on mainnet with its identity checked (a wrong description or the
  18-decimal variant fails the run before any write); a raised threshold
  pauses, a healthy run after a pause resumes; every reason; the ceiling, the
  originations floor and the acknowledgement read from the chain; the
  heartbeat and deviation; a refusal decoded, not thrown; a reverted delivery
  fails the run; gas behind a transmitter; a forced resume's end in the note;
  10 reads a run.
- The instant retry, in `test/collections.workflow.test.ts`: the
  `Reauthorized` topic0; trigger 1 filtered on PolarisCheckout and that topic
  with FINALIZED confidence (`retry: null` leaves one trigger); a real-shaped
  log collects the buyer's due instalments through the cron's report with no
  candidate scan, and the callback names the trigger; nothing due writes
  nothing; a still-short buyer is dunned again; a log from another contract or
  event, or one a reorg removed, collects nothing; `maxTasksPerReport` holds.
- `test/secrets-env.test.ts`: for every target, the guardian resolves no
  secret, collections only its callback key, underwriting its providers and
  the callback key; the environment every script starts the CLI with defines
  each of them (`""` when unset, never shadowing a value in `workflows/.env`
  or the shell) and puts Bun first on PATH; the evidence preflight names a
  variable left unset; underwriting's run config leaves out every provider
  without a key; `--callback` reaches collections and underwriting through
  `--config` for that run only.
- `test/evidence-script.test.ts`: the evidence and loop scripts read a run
  from the CLI's own output format, find its transaction, read the receipt's
  `ReportProcessed`, refuse (logged out, no deployment, a missing address,
  another chain, no transmitter key, a bad `--retry-tx`) before sending
  anything, and redact every secret; git keeps every file they write (the
  simulate logs included); the guardian's result reads as its
  verdict; a log-triggered run's hash is its own write, not the
  `reauthorize` that fired it; `--retry-tx` finds `Reauthorized` after the
  token's `Approval` and passes `--evm-event-index 1`; the listener cuts each
  finished run out of `--listen`'s stream.
- `test/config.test.ts`: the committed configs miss only the undeployed
  addresses; the guardian reads Chainlink AUSD/USD on Monad mainnet with a
  heartbeat below the receiver's attestation life; `configure` fills the
  retry's PolarisCheckout and the guardian (the local mock only locally, and
  refuses a testnet deployment that records a mock).
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
- `e2e/local-chain.e2e.test.ts` (`e2e:local`), on real contracts, in order:
  1. the account's consent and a proof become facts and ScoreManager opens a
     line at the mirror's score, while a brand-new account alone is a thin
     file: no report, and `creditLimitOf` stays 0;
  2. the guardian's first attestation is healthy, and GuardianReceiver decodes
     exactly the workflow's bytes (`latestAttestation()` equals them) and
     re-evaluates them to the same verdict (its pool verdict is the live
     pool's); the pool-health feed answers free cash x price; no second write
     inside the heartbeat. The owner raises the
     depeg threshold to $1.001: the next run pauses, `creditPaused()` is
     `(true, 1)` and `openPlan` reverts `CreditPausedByGuardian(1)`;
     restored, the next run resumes. A depeg and then a stale round on the
     labelled local mock pause it again; the recovery resumes it;
  3. a Pay in 4 plan opens on the line (so the resume is real);
  4. instalment 1 is collected from indexer candidates (the workflow's own
     query run against the indexer's schema);
  5. the instant retry: the buyer revokes the allowance, the cron dunns them
     (`allowance_lost`) and the ladder would hold them 6 h; they sign a permit,
     the relayer calls `PolarisCheckout.reauthorize`, and the log-triggered
     handler, fed the real receipt's `Reauthorized` log (event index 1),
     collects instalment 2 in the very next block;
  6. a revoked allowance and an empty balance become `allowance_lost` and
     `insufficient_funds`; past grace the plan is liquidated in the same
     report; an unknown action is skipped, not fatal;
  7. the guardian after that loss: the liquidation's shortfall is bad debt.
     The local pool has lent less than the $10,000 floor, so it pauses nobody;
     with the floor lowered, GuardianReceiver reads it from the pool and pauses
     Pay in 4 at once (`(true, 4)`), the next run attests it, and only the
     owner's acknowledgement (`acknowledgeBadDebt()`) lifts it, after which the
     next run attests the resume.

Gas on the local node (Hardhat, chain 10143), the limit each report was sent
with against what it used. Every receiver there has the deployer as its
simulation transmitter, so every report's whole delivery was estimated (no
overhead added), as on the simulation forwarder on testnet:

| Report | Gas used | Limit sent |
|---|---:|---:|
| Underwriting, one buyer with a history wallet (Confidential HTTP on) | 144,224 | 165,857 |
| Guardian, the first attestation (first writes of its storage) | 253,670 | 291,720 |
| Guardian, a later attestation (a pause) | 139,590 | 160,528 |
| Guardian, the bad-debt pause | 185,405 | 213,215 |
| Collections, one instalment collected (cron) | 158,510 | 185,846 |
| Collections, one instalment skipped (dunning) | 80,614 | 150,000 (the floor) |
| Collections, one instalment collected (the log-triggered retry) | 142,835 | 168,109 |
| Collections, a skip plus a liquidation | 165,406 | 208,048 |

(`e2e:local` on 28 Sep 2026, after the guardian's review fixes: 12 of 12 pass. The guardian's writes cost about 25,000 gas more than before: GuardianReceiver now reads the pool in the same call to check the report against it.)

## Status

| | |
|---|---|
| The three workflows compile to WASM with `cre workflow build` (CLI v1.35.0, SDK 1.22.0) | done, no login needed (28 Sep 2026: collections 2.78 MB with both triggers, underwriting 2.89 MB, guardian 2.74 MB) |
| `project.yaml` with the `monad-mainnet` read target | accepted: `cre workflow hash -T <target>` loads the settings of every target (a misspelt chain name is refused: `invalid chain name`); `cre workflow hash ./guardian -T staging-settings --public_key <any address>` compiles and hashes the guardian with both chains (28 Sep 2026); `cre workflow build` does not read them |
| Unit tests on the SDK's test runtime; the on-chain round trip on a local node | done (`test`: 209 pass; `e2e:local`: 12 of 12) |
| `cre workflow simulate --broadcast` on Monad testnet | ready (`evidence`, `evidence --retry-tx`, the loops, `retry:listen`), and the transmitter `CRE_ETH_PRIVATE_KEY` (0xBBb4…2EA6) is funded with 1 testnet MON and set on all three receivers. What blocked every run even after a login (the CLI aborting on the unset provider-key variables in the shared secrets file) is fixed and tested. Needs `cre login`; then `pnpm --filter @polaris/cre-workflows evidence --retry-tx 0xf02c45bd4ec1102d8ee4a55ea54e9980c28ddff5e7a4dffd222ca0bbba173002` (a real `Reauthorized` from the testnet smoke test). Its runs land in [`evidence/`](evidence/). **Done on 28 Sep 2026**: three reports delivered on Monad testnet ([`evidence/2026-09-28/`](evidence/2026-09-28/)) |
| `polaris-guardian` | done: cron; Chainlink AUSD/USD read on Monad mainnet (address and decimals checked on chain), the pool on Monad testnet at one finalized block, the verdict re-checked by GuardianReceiver (which reads the pool itself), pause and resume of `openPlan` shown on real contracts (`e2e:local`) |
| The instant retry (EVM log trigger) | done: trigger 1 of `polaris-collections` on `PolarisCheckout.Reauthorized`; shown on real contracts with a real `reauthorize` receipt (`e2e:local`); under the CLI, `simulate:retry` (one past transaction) or `retry:listen` (live) |
| Monad testnet | deployed 28 Sep 2026 (`packages/contracts/deployments/monad-testnet.json`): CollectionsReceiver 0x4201…45CC, UnderwritingReceiver 0x523e…4a19, GuardianReceiver 0x4c99…e3Df (redeployed the same day with the review's fixes; it replaced 0xF825…26D8), behind Chainlink's simulation forwarder; the three `config.staging.json` are filled from it (`configure staging`; `test/config.test.ts` holds them to the record) |
| Monad mainnet reads | every target reads `monad-mainnet` (public RPC); nothing writes there |
| Confidential HTTP | on in staging and local; production off until a deployed run shows Monad's DON serves it. Implemented and unit-tested; not yet exercised against the real capability (needs a CLI run with a provider key) |
| Deploy to the DON | waits for deploy access (`cre account access`) |
| The Polaris API side of the callback | done: `apps/business` `POST /api/cre/callback` verifies the HMAC (`POLARIS_CRE_CALLBACK_SECRET`), records `credit.underwritten` / `credit.refused` / `credit.thin` for the app, and runs the chain sync on `collections.run`. The committed configs keep `callback: null` until a deployment has an API URL to put there |
| Firing `polaris-underwrite` from the product | done: the app's **Raise your limit** (Bring your history) signs the consent and the history wallet's proof; `apps/business` `POST /api/credit/underwrite` verifies both and fires the HTTP trigger at most once per 30 s (`CRE_UNDERWRITING_TRIGGER_URL`) |
| Without a CRE login | Three local runners, each the real handler on the SDK's test runtime against a local chain (not the CLI or a DON), all started by `pnpm demo:local`: `trigger:local` (`scripts/local-trigger.mjs`) serves the underwriting trigger URL (fixture evidence, the local forwarder) and posts its signed callback; `collections:local` runs `polaris-collections` on both triggers, the cron every minute and the log trigger on every `PolarisCheckout.Reauthorized` the node emits (the log handed over from its receipt, as the DON does), with candidates from the chain, or from the Envio indexer's `DueCandidates` when `POLARIS_LOCAL_INDEXER_URL` names one (`pnpm indexer:local`; see `packages/indexer/README.md`); `guardian:local` runs `polaris-guardian` every minute, reading **Chainlink's AUSD/USD on Monad mainnet** over `https://rpc.monad.xyz` through a bridge that refuses any write (`POLARIS_LOCAL_GUARDIAN_PRICE=mock` reads the labelled local mock offline). The root `pnpm demo:e2e:chainlink` plays all three in the product, headless |
| The indexer schema | `DUE_CANDIDATES_QUERY` is the indexer client's `DUE_CANDIDATES`, validated against `packages/indexer/schema.graphql` |
| Dunning backoff without the indexer | done: the ladder from each task's due time (`candidates.chainBackoff`) |
| Provider calls | Nansen, Zerion and Etherscan have only answered from synthesized fixtures here; a live run needs their keys in `workflows/.env` |

## Limits that shaped this (docs/research/cre.md §8)

15 EVM reads and 15 HTTP calls per execution; 5 KB per read request; 10M gas
and 50 KB per report; cron no faster than 30 s; the HTTP trigger once per 30 s;
the log trigger 10 events per 6 s and 5 addresses per filter (we use one).

### What the CLI and Monad do not do (yet), stated

- **Simulation needs a CRE login.** `cre workflow build` and `cre workflow
  hash` run without one; `cre workflow simulate` does not (`cre login`, or
  `CRE_API_KEY`). So every on-chain proof in this README comes from
  `e2e:local` (the workflows' own handlers on the SDK's test runtime against
  real contracts on a local node) until `evidence` runs on Monad testnet. The
  handlers are the code the WASM runs; the simulator's own capability plumbing
  (`FakeEVMChain`) is exercised only by a real `simulate` run.
- **Cron does not schedule under simulation.** Each `simulate` fires one run
  at the next tick; `collections:loop` and `guardian:loop` restart it. `--listen`
  is for HTTP and log triggers only.
- **The log trigger under simulation** needs a past transaction
  (`--evm-tx-hash` plus `--evm-event-index`, the log's position in that
  receipt) or `--listen`, which polls the chain for matching logs; the two
  cannot be combined. A deployed DON would push the log instead.
- **Whether Monad's DON serves each capability is unconfirmed.** The docs
  list cron, HTTP and EVM log triggers for EVM chains in general and CLI
  v1.30.0's note mentions Monad testnet for local simulation only, though a
  production KeystoneForwarder exists there and delivers reports. `cre
  workflow supported-chains` (after login) is the organisation's answer, and
  `evidence` keeps it. `retry: null` deploys collections without the log
  trigger if it is not served.
- **Finality.** CRE's finality page does not list Monad. The workflows read
  at `LAST_FINALIZED_BLOCK_NUMBER` and the retry asks for FINALIZED logs,
  which rely on Monad's `finalized` block tag (testnet-rpc.monad.xyz answers
  it; Monad finalizes in about 800 ms).
- **The mainnet read is over a public RPC** (`https://rpc.monad.xyz`, in
  `project.yaml`). If it fails, the guardian's run fails and writes nothing;
  the last attestation stands until it is an hour old, then credit fails open.
- **The guardian attests; it does not custody.** A paused guardian stops new
  Pay in 4 plans only. Its price is the Chainlink feed's latest round on
  mainnet, which the receiver cannot check across chains: the DON's consensus
  on the read is what vouches for it, and the round id is in every report so
  anyone can look it up. The pool's figures the receiver checks itself. Under
  simulation the report is signed by the simulator, and the receivers accept
  only the simulation transmitter's origin (PolarisReceiver): whoever holds
  that key can attest a price, which is why it is a dedicated key and why the
  receivers move to the production forwarder, whose DON signatures replace
  it, once the workflows are deployed.

## Attribution

`@chainlink/cre-sdk` (BUSL-1.1, a dependency, not vendored; it converts to MIT
on 20 May 2029), the CRE CLI (MIT, downloaded from Chainlink's GitHub
releases, not committed), viem, zod and @noble/curves / @noble/hashes (MIT).
Written with Claude Code.
