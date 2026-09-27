# @polarispay/contracts

The Polaris contract layer on Monad: one checkout for **Pay now**, **Pay in 4**
on a Polaris credit line, and **Subscribe**; the BNPL loan engine and credit
scores behind it; send-by-link; and the two **Chainlink CRE** receivers that run
collections and underwriting. Settled in AUSD. Every user action is a
signature a relayer submits, so buyers, senders and merchants never hold MON.

## One command

```bash
pnpm install
pnpm --filter @polarispay/contracts test        # the whole suite (Hardhat)
pnpm --filter @polarispay/contracts e2e:local   # node on :8600, deploy, nine flows end to end
```

`e2e:local` starts a Hardhat node on `127.0.0.1:8600`, deploys everything with
the same script as testnet (MockAUSD and a local forwarder standing in for
AUSD and Chainlink's), and runs: a CRE underwriting report opens a buyer's
line; Pay now; Pay in 4 ($200 as 4 x $50.38, the merchant paid in full); a CRE
collections report collects instalment 1; the buyer pays the rest early by
signature; Subscribe; a CRE report charges the renewal; send by link; claim.
It prints gas used against each estimated limit and fails if any user sent a
transaction or held MON.

## Deploy to Monad testnet

```bash
pnpm --filter @polarispay/contracts deployer       # creates DEPLOYER_PRIVATE_KEY in the root .env if missing; prints address + balance
# fund that address with ~3 MON from https://testnet.monad.xyz
pnpm --filter @polarispay/contracts deploy:monad   # deploys, wires every role, writes deployments/monad-testnet.json
```

Then, as needed:

| Command | When |
|---|---|
| `fund-pool:monad` | The credit pool is empty because the deployer held no AUSD (the Agora faucet is dry; `docs/research/ausd.md` 5.2). Send AUSD to the deployer, then run it. Or redeploy with `AUSD_MODE=mock`. |
| `RELAYER_ADDRESS=0x… grant-relayer:monad` | The Privy relayer wallet exists: gives it PolarisPayments and MerchantRegistry operator and BatchSettlement settler. |
| `ETHERSCAN_API_KEY=… verify:monad` | Verify every contract on Monadscan (Etherscan V2 API). |
| `check:monad` | Read-only live check of AUSD, the forwarders, Multicall3 and gas. |

`deploy:monad` uses **real AUSD** (`0xa9012a05…22dC`) and checks its EIP-712
domain on deploy; it refuses Monad mainnet, and refuses to start without the
MON a rough estimate says it needs. Configuration (all optional) is documented
at the top of `scripts/deploy-monad.js`: `AUSD_MODE`, `TREASURY`,
`GRACE_SECONDS` (3600), `MIN_INTERVAL_SECONDS` and `MIN_PERIOD_SECONDS` (60,
so a plan plays out on camera; weekly plans still work), `CRE_FORWARDER`
(`simulation` by default, `production` once Early Access lands),
`CRE_SIMULATION_TRANSMITTER` (the address of `CRE_ETH_PRIVATE_KEY`, a key kept
for `cre workflow simulate --broadcast` alone; required on the simulation
forwarder, read from `CRE_ETH_PRIVATE_KEY` when unset, and never the deployer,
which the script refuses), `CRE_WORKFLOW_OWNER`, `RELAYER_ADDRESS`,
`POOL_SEED_AUSD`.

**Gas.** Monad bills the gas *limit*. Every script sends through `lib/tx.js`:
`eth_estimateGas` plus 15%, never a blanket limit. Measured locally (gas used):
Pay now 268k, open a plan 396k, CRE collection 153k, subscribe 310k, send
167k, claim 63k, CRE underwriting 134k.

## Contracts

| Contract | Role |
|---|---|
| `PolarisCheckout` | Pay now, Pay in 4 and Subscribe from signatures. The **only** loan originator. |
| `PolarisLoanEngine` | Pay in 4 plans: merchant paid from the pool; permissionless `collectInstallment`; `repayWithSig`; liquidation past grace. |
| `ScoreManager` | 300–850 scores and credit lines; `underwrite(user, facts)` computes the opening score on chain, capped at $1,000, and opens nothing for a thin file (`isThinFile`: under 90 days or 10 transactions). |
| `PolarisPayments` | Direct payments (`payWithAuthorization`) and subscriptions (`subscribeFor`, `chargeDue`). 0.5% fee. |
| `PolarisSend` | Send dollars as a link; claim to any address with the link key's signature. |
| `MerchantRegistry` | Merchants, registered by their own signature (`registerFor`), activated with a cap. |
| `CollateralVault`, `BatchSettlement` | Secured credit; batch payouts with memos. |
| `cre/CollectionsReceiver` | CRE `polaris-collections` (cron): collects, charges, liquidates in a batch. |
| `cre/UnderwritingReceiver` | CRE `polaris-underwrite` (HTTP): facts → `ScoreManager.underwrite`. |
| `cre/ReceiverTemplate`, `cre/IReceiver` | Chainlink's, verbatim (MIT). |
| `cre/MockKeystoneForwarder` | Local stand-in for Chainlink's mock forwarder. Tests and `e2e:local` only. |
| `MockAUSD` | Local AUSD: 6 decimals, ERC-2612, ERC-3009, AUSD's EIP-712 name `"Agora Dollar"`. Never on a public network. |

## Interfaces for the SDK, relayer, indexer and CRE workflows

**ABIs**: `abi/<Name>.json`, and typed indexes (`import { polarisCheckoutAbi } from "@polarispay/contracts/abi"`;
the `.d.ts` gives viem full inference). Regenerate with `pnpm --filter @polarispay/contracts abi`; a test fails if they drift.
**Deployment**: `deployments/monad-testnet.json` (written by `deploy:monad`; not yet deployed),
`deployments/monad-local.json` (each local run; git-ignored). Each holds every address with its block and
transaction, ABI paths, `eip712` (domain and struct types per contract), `roles`, `cre` and `demo`.
**Signing types**: `lib/eip712.js`. **CRE encoders**: `lib/cre.js`.

### PolarisCheckout

EIP-712 domain `{ name: "PolarisCheckout", version: "1", chainId, verifyingContract }`.

```
PlanIntent(address buyer,address merchant,uint256 principal,uint32 installments,uint64 interval,string orderId,uint256 nonce,uint256 deadline)
SubscribeIntent(address buyer,address merchant,uint256 planId,uint256 pricePerPeriod,uint64 periodSeconds,string orderId,uint256 nonce,uint256 deadline)
```

`nonce` is `nonces(buyer)`, one sequence shared by both intents. `deadline` must be
at most `MAX_SIGNATURE_WINDOW` (1 hour) ahead of the block. The order key is
`keccak256(abi.encodePacked(merchant, orderId))`, identical to the PolarisPayments
payment id; an order settles once, in one mode, at its quoted price if
`PolarisPayments.quoteOrder` pinned one. `openPlan` and `subscribe` record the
order on PolarisPayments (`settledByCheckout(orderKey)`), which then refuses
every payment on it with `OrderAlreadySettled(paymentId)`: a Pay now
authorization the buyer signed before choosing Pay in 4 or Subscribe can't be
redeemed on top of the plan, whether it is sent to the checkout or straight to
PolarisPayments, and whichever checkout is appointed later. The checkout must be
PolarisPayments' appointed `checkout` for Pay in 4 as well as Subscribe.

| Function | Buyer signs | Notes |
|---|---|---|
| `pay(buyer, merchant, amount, orderId, validAfter, validBefore, v, r, s) → orderKey` | AUSD `ReceiveWithAuthorization`, `to` = **PolarisPayments**, `nonce` = order key | Relays `PolarisPayments.payWithAuthorization`. |
| `openPlan(PlanIntent, bytes signature, PermitSignature) → loanId` | `PlanIntent` + AUSD `Permit`, spender = **PolarisLoanEngine**, value = `quotePlan(...).permitValue` | Merchant paid `principal` at once. |
| `subscribe(SubscribeIntent, bytes signature, PermitSignature) → subId` | `SubscribeIntent` + AUSD `Permit`, spender = **PolarisPayments** (e.g. 12 periods) | Plan terms must equal the intent (`PlanMismatch`). |
| `quotePlan(buyer, principal, installments, interval) → PlanQuote` | | `totalOwed, interest, installmentAmount, permitValue, creditLimit, activeDebt, available, withinLimit`. |
| `orderOf(merchant, orderId)`, `orderKeyOf`, `planIntentDigest`, `subscribeIntentDigest`, `invalidateNonce()`, `pause()`/`unpause()` (owner) | | |

`PermitSignature = (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`; `deadline = 0`
means no permit (the standing allowance is used). A permit **replaces** the allowance, which
is why `permitValue` covers every plan the buyer already has open.

Events (topic 1–3 indexed):

```
CheckoutPaid(bytes32 indexed orderKey, address indexed merchant, address indexed buyer, string orderId, uint256 amount, uint256 fee)
PlanOpened(bytes32 indexed orderKey, address indexed merchant, address indexed buyer, uint256 loanId, string orderId, uint256 principal, uint256 totalOwed, uint32 installments, uint64 interval, uint64 firstDueAt)
SubscriptionStarted(bytes32 indexed orderKey, address indexed merchant, address indexed buyer, uint256 subId, uint256 planId, string orderId, uint256 pricePerPeriod, uint64 periodSeconds, uint64 nextChargeAt)
NonceInvalidated(address indexed buyer, uint256 nonce)
```

Instalment *i* (0-based) of a plan is due at `firstDueAt + i * interval`. Errors: `InvalidSignature`,
`InvalidAccountNonce(account, current)`, `SignatureExpired`, `SignatureWindowTooLong`,
`OrderAlreadySettled(orderKey)`, `WrongAmount(quoted, offered)`, `PlanMismatch(planId)`, `EmptyOrderId`,
`ZeroAddress`, `EnforcedPause`; the engine's `ExceedsCreditLimit`, `InsufficientAllowance(have, need)`,
`MerchantNotEligible`, `InvalidInterval` bubble up unchanged.

### Chainlink CRE receivers

Both extend Chainlink's `ReceiverTemplate`: `onReport(metadata, report)` accepts only the
configured forwarder, and once `setExpectedAuthor` + `setExpectedWorkflowName` are set, only that
workflow owner and name. Names travel as `bytes10` = the first 10 hex chars of `sha256(name)` as ASCII:
`polaris-collections` = `0x38323961376630323863`, `polaris-underwrite` = `0x39333731613831386437`.

**CollectionsReceiver** (`polaris-collections`, cron). Report body:

```
abi.encode(uint8 kind = 1, (uint8 action, uint256 id)[] tasks)
action 1 = PolarisLoanEngine.collectInstallment(id)   2 = PolarisPayments.chargeDue(id)   3 = PolarisLoanEngine.liquidate(id)
```

`checkTasks((uint8,uint256)[]) → bool[]` is the workflow's one batched read (actionable at this block).
Events: `TaskExecuted(uint8 indexed action, uint256 indexed id, uint256 amount)`,
`TaskSkipped(uint8 indexed action, uint256 indexed id, bytes reason)` (the target's revert data:
`InsufficientAllowance(have, need)` = re-sign, `InsufficientBalance(have, need)` = top up, `NotDue` /
`LoanNotActive` = stale candidate), `CollectionsRun(uint256 tasks, uint256 executed, uint256 skipped)`.
A task that runs out of gas reverts the whole report with `InsufficientGasForTask(index)` so the
forwarder can retry.

**UnderwritingReceiver** (`polaris-underwrite`, HTTP). Report body:

```
abi.encode(uint8 kind = 2, (address user, address linkedWallet, Facts facts)[] items)
Facts = (uint32 walletAgeDays, uint32 txCount, uint64 stableBalance, uint32 defiTenureDays,
         uint16 priorLiquidations, uint16 relatedWallets, bool exchangeFunded, uint64 observedAt)
```

`stableBalance` is 6-decimal base units; `observedAt` must be within 15 minutes of the block.
A report must show a history (`ScoreManager.isThinFile`): at least `MIN_HISTORY_DAYS` (90) days
since the oldest activity and `MIN_HISTORY_TXS` (10) transactions, over the account and its linked
wallet. A thin file is refused with `ThinFile(walletAgeDays, txCount)` and records nothing, so a fresh
account gets no unsecured line until it links a history wallet (collateral works meanwhile, at face
value); a report that declines the wallet is recorded whatever the history. The balance does not count
towards a history. The off-chain decision and the workflow should skip thin files rather than send them.
Events: `UnderwritingApplied(address indexed user, address indexed linkedWallet, uint16 score)`,
`UnderwritingRefused(address indexed user, address indexed linkedWallet, bytes reason)` (e.g.
`StaleEvidence`, `ThinFile(walletAgeDays, txCount)`, `AlreadyHasRecord`, `WalletAlreadyLinked(wallet, user)`, `UserIsLinkedHistory(user, account)`,
`WalletAlreadyUnderwritten(wallet)`). One history opens one line: `linkedUserOf(wallet)` backs one
account, a wallet backing an account can't be underwritten itself, and an underwritten account can't be
linked as another's history. While `simulationTransmitter` is set (simulation), only that `tx.origin` may
deliver, so it must be a dedicated CRE key, never the deployer.

**Forwarders on Monad testnet**: simulation `0xB9F79d863261869B234c481D1f9A7af84AeAd192` (default),
production `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`. To move to production after Early Access:
`setForwarderAddress(0xF834…4482)` on both receivers, `setSimulationTransmitter(0)`, then
`setExpectedAuthor(<workflow owner>)` and `setExpectedWorkflowName(...)`. Under `cre workflow simulate`
a reverted `onReport` still reads as success, so judge runs by the events above.

## Tests

`pnpm --filter @polarispay/contracts test`. The Metropolis suites are named for the attack each
refuses: `test/metropolis/Checkout.test.js` (a relayer cannot open a plan the buyer did not sign,
redirect a payment, replay an intent or a permit, or reenter), `CreReceivers.test.js` (forged
reports, the forwarder, owner and name checks, stale or repeated underwriting, a reused history
wallet, a stranger on the simulation forwarder, out-of-gas reports), `Deploy.test.js` (every role
the deployment grants), `Interfaces.test.js` (ABIs and EIP-712 types stay true).

## Attribution

`contracts/cre/ReceiverTemplate.sol` and `IReceiver.sol` are Chainlink's (MIT), from the CRE
consumer-contract docs. OpenZeppelin Contracts 5 (MIT). Written with Claude Code.
