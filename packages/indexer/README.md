# polaris-indexer

The [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview) indexer
for Polaris on Monad testnet (chain 10143). It turns every event of every
Polaris contract into the rows these read:

| Reader | What it asks | Breaks without it |
|---|---|---|
| **The CRE `polaris-collections` workflow** | Which instalments are due (or due a retry on the dunning ladder), which plans are past grace, which subscriptions renew: `DueCandidates` | The workflow proposes from the indexer and the chain disposes; without it, it falls back to scanning windows of ids and retries a failing buyer on every run |
| **The webhook dispatcher** | The `Activity` outbox after a cursor: `payment.succeeded`, `plan.opened`, `installment.collected`, `installment.failed`, `plan.completed`, `plan.liquidated`, `subscription.charged`, `subscription.canceled`, `payout.paid` | Merchants are never told they were paid |
| **Polaris for Business** | Balance, payments, the Pay in 4 ledger with instalment tick marks and at-risk exposure, payouts, customers, daily bar and candlestick charts, CRE collector status | "Paid" only ever comes from indexed chain events, so the dashboard has nothing to show |
| **The Polaris app** | The buyer's credit line and why, open plans and the next payment, receipts, send links | The credit screen and "Arrived" on a claimed link |

HyperIndex V3 with `envio` **3.12.1** pinned; HyperSync is the data source
(`monad-testnet.hypersync.xyz`). Typed handlers, a GraphQL schema, 46 handler
tests including a replay of a real chain, an end-to-end run of Envio's own
runtime against a live local chain, and a typed client ([`client/`](client/))
for everything above.

## One command

The `envio` CLI has no Windows build, so everything runs on Linux: WSL on
Windows, or any Linux or macOS machine and CI.

```bash
# from Windows, at the repo root (WSL distro with Node 22+ and pnpm inside it):
wsl -d <distro> -- bash packages/indexer/scripts/wsl.sh test

# from Linux or macOS:
bash packages/indexer/scripts/wsl.sh test
```

`test` installs this package on its own (it is deliberately outside the pnpm
workspace; see [Layout](#layout)), checks `config.yaml` is current with the
contract ABIs, runs `envio codegen`, type-checks, and runs the tests. No
Docker, no API token.

First time in WSL: Node must be a *Linux* install, not the Windows one WSL
puts on `PATH`. For example:

```bash
# inside WSL
mkdir -p ~/.local/opt
curl -fsSL https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz | tar -xJ -C ~/.local/opt
ln -sfn ~/.local/opt/node-v22.23.3-linux-x64 ~/.local/opt/node22   # scripts/wsl.sh puts ~/.local/opt/node22/bin first
~/.local/opt/node22/bin/npm install -g pnpm@10
```

Under WSL the Windows drives are slow, so when the repo is on `/mnt/c` or
`/mnt/e`, `wsl.sh` works in a copy on the Linux filesystem
(`~/.cache/polaris-indexer`: this package, the contract ABIs and deployment
records) and a run takes seconds. `POLARIS_INDEXER_IN_PLACE=1` turns that off.

The client's tests run anywhere, from the repo root:
`pnpm --filter @polarispay/indexer-client test`.

### The whole thing on a local chain, still without Docker

```bash
bash packages/indexer/scripts/wsl.sh live     # needs packages/contracts installed on Linux (pnpm install at the root)
```

A Hardhat node on port 3541; the contracts deployed with the testnet script;
the contracts' end-to-end flows plus `scripts/fixture-scenarios.cjs` run on
it; then Envio's own runtime indexes that chain over RPC (dynamic merchant
registration, the wildcard transfer filter, every handler) and the indexed
state must equal what the contracts report. It works in a scratch copy, so
`config.yaml` is untouched. `POLARIS_LIVE_RUNS=5` indexes the same chain five
times (CI does): Envio's queries answer in a different order every run, and
an ordering bug shows up only now and then.

## Running it locally against Monad testnet (needs Docker)

```bash
cp packages/indexer/.env.example packages/indexer/.env   # add ENVIO_API_TOKEN from https://envio.dev/app/api-tokens
bash packages/indexer/scripts/wsl.sh dev                 # envio dev: Postgres + Hasura in Docker, hot reload
```

GraphQL is then at `http://localhost:8080/v1/graphql` (Hasura console on
the same port, admin secret `testing`). On Windows, `envio dev` needs Docker
Desktop's WSL integration switched on for the distro (Settings > Resources >
WSL integration). `ENVIO_START_BLOCK` and `ENVIO_BLOCK_LAG` override
`config.yaml`.

## After the contracts are deployed

`config.yaml` and `src/deployment.ts` are generated, never edited:

```bash
pnpm --filter @polarispay/contracts deploy:monad     # writes packages/contracts/deployments/monad-testnet.json
node packages/indexer/scripts/generate.mjs           # rewrites config.yaml and src/deployment.ts from it
```

Commit both. Until that record exists every Polaris address is a marked
placeholder (`0x…cafe0001`…) and `src/deployment.ts` says
`placeholder: true`; AUSD and Chainlink's two CRE forwarders are real. The
start block is the first Polaris deploy block. `generate.mjs --check` (run by
the tests) fails if the files are stale, so a contract change cannot drift
from the indexer.

## Deploying to Envio Cloud (the hosted service)

Envio Cloud builds from a git branch and uploads only this folder, which is
why nothing here imports from outside it (`src/deployment.ts` is generated
into it) and `envio` is pinned exactly. Cloud needs no API token.

1. Sign in at <https://envio.dev/app/login> with GitHub, pick the
   organisation, and install the **Envio Deployments** GitHub App on the repo.
2. Add the indexer (dashboard, or the `envio-cloud` CLI, which runs natively
   on Windows):
   ```bash
   npx envio-cloud login
   npx envio-cloud indexer add --name polaris --repo polaris --branch envio --root-dir packages/indexer --config-file config.yaml --tier development
   ```
3. Push the branch it builds from: `git push origin HEAD:envio`. Each push
   re-indexes from the start block; the previous deployment serves until the
   new one is synced.
4. Wait and read the endpoint:
   ```bash
   npx envio-cloud deployment status polaris <commit> --watch-till-synced
   npx envio-cloud deployment endpoint polaris <commit>
   ```
5. Give that URL to every reader: `POLARIS_INDEXER_URL` for the dashboard and
   the webhook dispatcher, and `candidates.indexerUrl` in the CRE collections
   workflow's config, with `candidates.indexerQuery` set to the client's
   `DUE_CANDIDATES` document.

Free-plan limits to plan around: a deployment is deleted after 30 days
(hard limit); 100,000 events, 5 GB, or 7 days without a request (soft limits)
start a 7-day grace period, then 3 days read-only, then deletion; 3
deployments per indexer. Make the final deployment at the feature freeze (9 Oct), and keep it
queried: the CRE cron does while it runs, and
`.github/workflows/indexer-keepalive.yml` sends a daily `_meta` query once the
repository variable `POLARIS_INDEXER_URL` is set. The endpoint is
public on the free plan: nothing indexed is secret, and order ids must not
carry personal data.

## What is indexed

`config.yaml` lists every event of `PolarisCheckout`, `PolarisPayments`,
`PolarisLoanEngine`, `ScoreManager`, `MerchantRegistry`, `PolarisSend`,
`CollateralVault`, `BatchSettlement`, `CollectionsReceiver` and
`UnderwritingReceiver`, plus two sources that are not ours:

- **Chainlink's forwarders** (`CreForwarder`): `ReportProcessed` for our two
  receivers only (filtered by the receiver topic). `result: false` means the
  receiver reverted, which `cre workflow simulate` still reports as success.
- **Merchant accounts** (`MerchantWallet`): an account is registered at
  runtime when it registers with the `MerchantRegistry`, and from then on
  stablecoin `Transfer`s from or to it are indexed in wildcard mode, filtered
  at the source by topic. That gives the dashboard a balance without an RPC
  call, and makes payouts visible. Nothing else registers an account: Envio
  runs `contractRegister` as each contract's query answers, in any order, so
  an account registered from several events (a loan seen before the
  registration) could start being followed after its first payment; and
  paying an arbitrary account a cent must not make the indexer follow it.

| Entity | Holds | Read by |
|---|---|---|
| `Merchant` | Registration, totals by mode, Pay in 4 book (outstanding, dunning, at risk), MRR, balance, payouts | Dashboard |
| `Payment` | Every settled order and subscription charge, with the relayer that carried it | Dashboard, app |
| `Order` | An order key from quoted to paid, and whether it paid the quoted price | Checkout ("Paid"), dashboard |
| `Plan`, `Installment`, `Repayment` | Pay in 4 schedules, what was paid toward each instalment and by whom (buyer, CRE, keeper), dunning state | Dashboard, app, **CRE** |
| `SubscriptionPlan`, `Subscription` | Plans, subscriptions, next charge, misses, backoff | Dashboard, app, **CRE** |
| `Send` | Send-by-link from open to claimed, cancelled or refunded | App |
| `Payout`, `Batch`, `BatchLeg` | Merchant withdrawals; batch settlements with memos | Dashboard, webhooks |
| `Buyer`, `ScoreEvent`, `Underwriting`, `LinkedWallet` | The credit line (mirrors `creditLimitOf`), every score move and why, CRE underwriting results | App |
| `CollectionRun`, `CollectionTask`, `CreReport` | Every CRE report: tasks executed or skipped and why | Dashboard (collector card), evidence |
| `Activity` | The webhook outbox, with a strictly increasing `cursor` | Webhook dispatcher |
| `MerchantDay`, `ProtocolDay`, `BuyerDay` | Daily totals and candles (payment sizes, balance, score) | Charts |
| `Customer`, `Protocol`, `ConfigChange` | Merchant x buyer; protocol totals and settings; every role and setting change (e.g. exactly what the relayer may do) | Dashboard, evidence |

Envio Cloud exposes no aggregate queries, so every total is a counter kept at
indexing time. Money is BigInt in AUSD base units (6 decimals); times are Int
unix seconds; addresses are lowercase.

### How some of it is derived

- **Schedules without eth_call.** The loan engine's threshold ladder and
  `installmentsEarned` are mirrored exactly (`src/lib/loans.ts`), so
  `nextDueAt`, `liquidatableAt` (`nextDueAt + grace + 1`) and each
  instalment's paid amount follow from the events. Subscriptions mirror
  `chargeDue`, including the skip to the next boundary after a missed window.
  The engine's `LoanCreated` carries no interval, so a plan's schedule comes
  from `PolarisCheckout.PlanOpened`; the checkout is the only originator the
  deploy script appoints.
- **Dunning.** A skipped collection is decoded (`src/lib/revert.ts`):
  `InsufficientAllowance` = the buyer must sign again, `InsufficientBalance` =
  top up, `NotDue`/`LoanNotActive` = a stale candidate, nobody's fault. A real
  failure puts the plan into dunning and moves `nextAttemptAt` along the
  6 h / 24 h / 72 h / weekly ladder (`packages/keeperhub`), never past the
  liquidation point, so the workflow does not pay gas to retry a failing buyer
  every minute.
- **Payouts.** A stablecoin transfer out of a merchant account in a
  transaction sent to the stablecoin itself (the relayer carrying the
  merchant's signed `transferWithAuthorization`) is a payout; money leaving
  through a Polaris contract (a checkout payment, a send) is not.
- **Totals by contribution.** Before a plan or subscription changes, its
  share of every total is noted; after, the difference is applied. The replay
  test checks totals against a recount.
- **Webhooks never fire from a handler** (handlers run twice and can be rolled
  back); they are rows in `Activity`. `block_lag: 2` (Monad's finality) means
  a row is final when it appears.
- **Merchant balances** count every stablecoin transfer since the merchant
  registered (`registeredAt`), which for a Polaris business is before any
  money. An account paid without ever registering is not followed: its
  `balance` stays 0 (read `AUSD.balanceOf`), and its payments still count in
  every volume.

## The GraphQL client

`@polarispay/indexer-client` (in [`client/`](client/)) is a workspace package
with no runtime dependencies: every document the readers send, validated in
its tests against a Hasura-shaped schema built from `schema.graphql`, and
typed results with BigInt columns as `bigint`.

```ts
import { createIndexerClient, toCents, toWebhookEvent, nextCursor } from "@polarispay/indexer-client";

const indexer = createIndexerClient({ url: process.env.POLARIS_INDEXER_URL! });

// Dashboard home
const { merchant, recentPayments, days } = await indexer.merchantOverview(wallet, { days: 30 });
const balanceCents = merchant ? toCents(merchant.balance) : 0;
const ledger = await indexer.plans(wallet, { filter: "dunning" });

// Checkout: "Paid" only from the index
const order = await indexer.waitForOrder(orderKey); // keccak256(encodePacked(merchant, orderId))

// Webhook dispatcher: tail the outbox, sign and send each event in order
let cursor = await loadCursor();
const { activities } = await indexer.activityAfter(cursor, 100);
for (const a of activities) await deliver(toWebhookEvent(a, { merchantId })); // the SDK's envelope; sign and send with @polaris/db
await saveCursor(nextCursor(cursor, activities));
```

The CRE workflow cannot use `fetch`; it sends the same document through its
HTTP capability. `DUE_CANDIDATES` answers in the shape the
`polaris-collections` workflow already parses (`Loan[].loanId`,
`Subscription[].subId`), so pointing the workflow at the indexer is its
`candidates.indexerUrl` plus `candidates.indexerQuery` set to this document.
The pure helpers build the same task list anywhere else (the fallback keeper,
a script):

```ts
import { documents } from "@polarispay/indexer-client";
import { dueCandidatesRequest, parseDueCandidates, readyTasks, REPORT_ABI_PARAMETERS } from "@polarispay/indexer-client/cre";

documents.DUE_CANDIDATES;                                            // the workflow's candidates.indexerQuery
const req = dueCandidatesRequest(scheduledTimeSeconds, 50);          // same time on every node
const tasks = parseDueCandidates(json(httpResponse), scheduledTimeSeconds); // liquidations, collections, charges; sorted, deduplicated
const due = readyTasks(tasks, checkTasksResult);                     // CollectionsReceiver.checkTasks, one EVM read
// report body: encodeAbiParameters(parseAbiParameters(REPORT_ABI_PARAMETERS), [1, due])
```

Next.js apps add `transpilePackages: ["@polarispay/indexer-client"]` (the
package ships TypeScript source).

## Tests

| Suite | What it proves |
|---|---|
| `test/lib.test.ts` | The schedule mirror gives the contract's numbers ($200 x 4 weekly = 201534246 owed, 50383562 first instalment); the credit line mirrors `ScoreManager`; every revert selector recomputed with viem; `config.yaml` is current and indexes every event in every ABI |
| `test/paynow`, `plans`, `subscriptions`, `accounts` | Simulated flows through Envio's own test indexer: Pay now, Pay in 4 with dunning, CRE collection, prepayment and liquidation, subscriptions with backoff, missed windows, lapses and cancellations, sends, payouts, batches, credit, CRE reports, roles |
| `test/live.test.ts` (`wsl.sh live`) | The same checks, but Envio's runtime fetches the chain itself over RPC: the config, the dynamic registration and the source-side filters are exercised too |
| `test/replay.test.ts` | A real chain: `scripts/record-fixture.mjs` runs the deploy script, the contracts' end-to-end flows and `scripts/fixture-scenarios.cjs` on a Hardhat node (port 3540) and records 142 logs of 62 kinds; replayed through the handlers, every plan, subscription, credit line, merchant balance and link equals what the contracts report, every webhook kind appears, and totals equal a recount |
| `client/test` | Every document is valid against the schema; BigInt decoding is complete; the client's requests, errors and paging; CRE task building; webhook events; money; the credit mirror equals the indexer's |

Re-record the fixture after a contract change (Windows or Linux, with the
workspace installed): `node packages/indexer/scripts/record-fixture.mjs`.

## Layout

The indexer is its own pnpm project (`pnpm-workspace.yaml` excludes it) and
its client is a workspace package. The `envio` CLI needs its Linux binary,
which a Windows workspace install would skip, and Envio Cloud installs this
folder on its own. `scripts/wsl.sh` installs it with
`pnpm install --ignore-workspace` against its own `pnpm-lock.yaml`.

```
config.yaml            generated: contracts, every event signature, chain 10143
schema.graphql         entities
src/deployment.ts      generated: per-chain settings (grace, dunning ladder, addresses)
src/handlers/          one file per area; Envio loads them all
src/lib/               the mirrors (loans, credit, revert reasons) and the unit of work
scripts/generate.mjs   config + settings from the ABIs and a deployment record
scripts/wsl.sh         the one command
scripts/record-fixture.mjs, fixture-scenarios.cjs   the real-chain fixture
scripts/live.sh        the live end-to-end run
test/                  vitest + Envio's createTestIndexer
client/                @polarispay/indexer-client
```

## Not verified here

- **No Docker on this machine,** so `envio dev` (Postgres + Hasura) was not
  run. Everything up to the database was (`wsl.sh live`), but the client's
  documents were validated against a Hasura-shaped schema built from
  `schema.graphql`, not a live Hasura. Run
  `wsl.sh dev` and open the Hasura console once to confirm (docs/research/envio.md
  section 11 lists the open questions: `_meta` shape on Cloud, numeric as
  strings).
- **No deployment yet:** the Polaris addresses are placeholders until
  `deploy:monad` runs.
- The wildcard `Transfer` matches any token's transfers touching a merchant
  account; only the stablecoin's are used. An ERC-721 `Transfer` (same topic,
  three indexed arguments) to a merchant account would not decode as an
  ERC-20 one.

Written with Claude Code.
