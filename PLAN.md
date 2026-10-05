# Polaris: the plan to done

Started 6 Oct 2026 (the master pipeline in the team's orchestration notes).
Statuses are updated in place as work lands. Companion files:
[`docs/TODO.md`](docs/TODO.md) (the team's checklist),
[`docs/SPONSOR-GAP.md`](docs/SPONSOR-GAP.md),
[`docs/TEST-PLAN-ZERO-MOCK.md`](docs/TEST-PLAN-ZERO-MOCK.md) (every item's
browser verification), [`docs/DEPLOY-LATER.md`](docs/DEPLOY-LATER.md).

**Standing constraints.** Monad testnet is on hold until the team funds the
deployers and says go: on-chain work runs on a local anvil or an anvil fork of
Monad testnet with real contracts and real signed transactions; testnet-only
items are BLOCKED ("awaiting testnet go"). The live hosting stays as it is.
No secrets in git or on hosting. Seven sessions share one 16 GB Mac: own
worktrees, own ports, stop by PID.

## 1. Goals

**Done** means: every flow a judge can reach works for real (no sample data,
no stubbed relayer, no fixture evidence in the running product), is verified
in a real browser with a clean console and network tab, and the submission
says exactly what ran.

**Winning** means scoring on the published weights. Track 02 judges product
quality, technical excellence, Monad integration, track fit and innovation at
20% each; each bounty scores meeting its stated requirement at 40%. So the
priorities are: (1) a flawless consumer path (link → Face ID → pay / Pay in 4 /
send / split → receipt), (2) every sponsor requirement met with real calls,
(3) a ≤ 3 min video and a judge-ready README and kit.

## 2. Phases (critical path marked ★)

| # | Phase | Depends on | Status |
|---|---|---|---|
| P1 ★ | **Zero-mock product path**: remove offline demo data, the dev mock session, the shop's dev mock API, fixture evidence and the mock dollar from what runs | — | IN PROGRESS |
| P2 ★ | **Real local stack**: `demo:local` on an anvil fork of Monad testnet with Agora's real AUSD, Chainlink's forwarder, real WebAuthn (virtual authenticator with PRF in automation) | P1 | NOT STARTED |
| P3 | **Indexer live**: Envio HyperIndex on the local chain feeding the dashboard, webhooks and CRE candidates | P2 for the fork variant | IN PROGRESS |
| P4 ★ | **Verification**: `demo:e2e` (incl. receipts, split) green on the real stack; every item of the zero-mock test plan PASS or UNTESTED with its dependency, via Claude in Chrome with console and network clean | P1, P2 | NOT STARTED |
| P5 | **Quality loop**: tests, typecheck, lint, contracts, Slither, secret scan, 375 px, a11y basics, failure states; gap grep re-run | P4 | IN PROGRESS (first pass green) |
| P6 | **Judge package**: README, SUBMISSION.md, DEPLOY-LATER.md, kit | — | DONE (refresh at the end) |
| P7 | **Awaiting the team**: testnet go (PolarisSplit, real AUSD redeploy), keys (Nansen, Zerion, Envio, `cre login`), the shop's hosting, the Face ID domain, the video, registration | team | BLOCKED |

## 3. Tasks

Each task: objective · acceptance · verify · status.

### P1 Zero-mock product path

- **P1.1 App without the offline demo.** Remove `apps/app/src/lib/data/mock.ts`
  from the product path, the stub relayer (`lib/relayer.ts`), placeholder
  EIP-712 domains (`lib/domains.ts`) and `RELAYER_IS_STUB`. Without
  `NEXT_PUBLIC_POLARIS_API_URL` the app shows an honest "not configured"
  screen. · Acceptance: no import of mock data outside tests; a build without
  the API shows the not-configured state; app tests green. · Verify: grep,
  `pnpm --filter @polaris/app test typecheck lint`, browser. · NOT STARTED
  (waits for the UI polish session's `apps/app` branch).
- **P1.2 Business without the dev mock session.** Remove
  `POLARIS_DEV_MOCK_SESSION`, `components/auth/mock-auth.tsx`,
  `lib/data/sample.ts`, `chainlink-sample.ts` and the `placeholder` branches
  in `lib/data/insights.ts`; empty states where data is absent. · Acceptance:
  no sample or placeholder data reachable in any build; business tests
  green. · IN PROGRESS
- **P1.3 Shop without the dev mock API.** Remove `apps/shop/src/lib/dev-polaris`,
  the `route.dev.ts`/`page.dev.tsx` routes, `HALCYON_DEV_MOCK`, the dev
  drawer; without Polaris keys the shop says payments are not configured. ·
  Acceptance: shop pays only through Polaris for Business; tests green. · IN
  PROGRESS
- **P1.4 Underwriting without fixture evidence in the product.** Missing
  `NANSEN_API_KEY`/`ZERION_API_KEY` → the provider is "not configured", never
  synthesized data; "Raise your limit" says reviews need the named key;
  fixtures stay for unit tests only. Live Etherscan (key present) and public
  RPCs still count. · Acceptance: `packages/underwriting/src/node/client.ts`
  no longer defaults to fixtures; gateway `dataMode` never "fixture" at
  runtime. · IN PROGRESS
- **P1.5 Real dollar locally.** The local stack uses Agora's AUSD on a fork
  (see P2.1); MockAUSD stays for unit tests and `AUSD_MODE=mock` only. ·
  NOT STARTED
- **P1.6 No dev signer in the product path.** Automation signs in through a
  real WebAuthn ceremony (Chrome DevTools virtual authenticator with PRF), so
  Mera's real code derives the account and receipt keys. · NOT STARTED

### P2 Real local stack

- **P2.1 `demo:local` on a fork**: anvil fork of Monad testnet on own ports
  (`--prune-history 300`), `deploy:fork`, pool and buyers funded from Agora's
  faucet, Chainlink's MockKeystoneForwarder (Chainlink's own simulation
  contract) for CRE reports, own ports for every server. · Acceptance: one
  command brings it up; `check:deployment:fork` 63/63. · NOT STARTED
- **P2.2 CRE on the fork**: the three workflows' code runs against the fork
  (local runner today; `cre workflow simulate` once `cre login` is done:
  BLOCKED on the team). · NOT STARTED
- **P2.3 Merchant sign-in**: real Privy login on localhost needs the origin
  allowed in Privy and a person for the email code (or Privy test
  credentials enabled by the team). Until then the local merchant session is
  the documented dev path and the item is UNTESTED in the browser. · BLOCKED
  (team: Privy allowed origins / test account)

### P3 Indexer

- **P3.1 Envio on the local chain** (RPC source, no token): entities,
  Activity outbox, DueCandidates, consumers read it. · IN PROGRESS (agent)
- **P3.2 Envio on testnet** needs `ENVIO_API_TOKEN` and the testnet go. ·
  BLOCKED

### P4 Verification

- **P4.1 Receipts step in `demo:e2e`** (written, branch
  `metropolis/receipts-e2e`): run green. · BLOCKED on the shared checkout
  (another session's demo run), then on P2.
- **P4.2 `docs/TEST-PLAN-ZERO-MOCK.md`**: every page, endpoint, contract
  interaction and integration with its expected result. · NOT STARTED
- **P4.3 Browser pass** via Claude in Chrome, console and network clean,
  375 px. · NOT STARTED

### P5 Quality loop

- **P5.1 First gate** on `metropolis/integrate`: 29/29 test, typecheck, lint
  green; contracts 611; Slither triaged ([SLITHER.md](packages/contracts/SLITHER.md));
  secret scan clean. · DONE
- **P5.2 Re-run after P1–P4** and the gap grep. · NOT STARTED

## 4. Gap audit (from the code, 6 Oct)

Grep of `mock|stub|fake|dummy|placeholder|TODO|FIXME|hardcod` over `apps`,
`packages`, `workflows`, `scripts`, excluding tests, fixtures, docs, ABIs and
evidence: 730 lines. The product-path gaps:

| # | Evidence | Impact | Sev | Fix | Task |
|---|---|---|---|---|---|
| G1 | `apps/app/src/lib/data/index.ts:17` `data = apiConfigured() ? liveData : mockData` | A build without the API shows invented balances and activity | P1 | Not-configured state | P1.1 |
| G2 | `apps/app/src/lib/relayer.ts:5,20,111` stub relayer with made-up hashes | Fake success when unconfigured | P0 | Remove | P1.1 |
| G3 | `apps/app/src/lib/domains.ts:57` placeholder EIP-712 domains | Signatures over a fake domain when unconfigured | P1 | Remove | P1.1 |
| G4 | `apps/business/src/components/auth/mock-auth.tsx`, `lib/session.tsx:50` | A fake signed-in merchant in development | P2 | Remove | P1.2 |
| G5 | `apps/business/src/lib/data/sample.ts`, `chainlink-sample.ts`, `insights.ts:95,138,150` (`fakeHash`, placeholder runs/events) | Invented dashboard data in the mock session | P1 | Remove; empty states | P1.2 |
| G6 | `apps/shop/src/lib/dev-polaris/mock.ts`, `app/api/dev-polaris/**` | A mock Polaris API in development | P2 | Remove | P1.3 |
| G7 | `packages/underwriting/src/node/client.ts:52` defaults to `fixture` without a key | Credit lines from synthesized evidence | P0 | Not configured | P1.4 |
| G8 | `apps/gateway/src/server.ts:36` `dataMode: "fixture"` | Same, through the gateway | P1 | Same | P1.4 |
| G9 | `scripts/demo-local.mjs` deploys MockAUSD and the repo's own MockKeystoneForwarder and MockPriceFeed | The local product runs on a mock dollar | P1 | Fork stack | P1.5, P2.1 |
| G10 | `apps/app/src/lib/account/dev-signer.ts`, `dev-receipts.ts`; `demo:local` sets `NEXT_PUBLIC_DEV_SIGNER` | Face ID replaced by a dev key in every local run | P1 | Virtual authenticator | P1.6 |
| G11 | `scripts/demo-local.mjs:426–431` `POLARIS_LOCAL_SESSION_*` | Merchant sign-in bypasses Privy locally | P2 | Real Privy on localhost (team) | P2.3 |
| G12 | Testnet stablecoin is MockAUSD (`deployments/monad-testnet.json`) | Agora bounty on a labelled mock | P1 | Redeploy on go | P7 |
| G13 | `README.md` Attribution was "TBD" | Rules require attribution | P1 | Done 6 Oct | P6 |
| G14 | `workflows` CRE report gas estimate undershoots on the fork | A report can land "not processed" | P2 | Measure on testnet (read-only) | P7 |

The other hits are tooling and tests: deploy and e2e scripts, the contracts'
own `Mock*.sol` for unit tests, `assert-no-dev-mock.mjs` (a guard),
`provenance.ts` (names Chainlink's MockKeystoneForwarder for what it is).

## 5. Completion

A 44-item checklist, each item 1 (done), 0.5 (built, one step left) or 0.

| Area | Items | Score |
|---|---|---|
| Features (12): Pay now, Pay in 4, Subscribe, Send/claim, Split (testnet ✗), Withdraw/payouts, Receipts (e2e unrun), Dashboard, Links/keys/webhooks, SDK, Shop (not hosted), Android (no real phone) | | 10 |
| Zero-mock product path (6): G1–G3, G4–G5, G6, G7–G8, G9 (fork path exists), G10 | | 0.5 |
| Integrations (8): Privy, CRE (testnet sims), Nansen, Zerion, Envio (local in progress), Chainlink feeds, real AUSD (fork only), Mera on a real device | | 4 |
| Data and auth (3): persisted DB, hosted Privy login, Face ID | | 1.5 |
| Tests (4): unit/type/lint, contracts + Slither, full `demo:e2e`, browser zero-mock pass | | 2.5 |
| Deploy (5): testnet contracts, hosting (3 of 4), PolarisSplit on testnet, Face ID domain, Envio deployed | | 1.75 |
| Submission (6): README/licence/attribution, kit, gap/runbook docs, video, registration, pushed | | 3 |
| **Total** | **44** | **23.25 → 53%** |

**INITIAL: 53%** (6 Oct). Final is recorded at the end of the pipeline.
