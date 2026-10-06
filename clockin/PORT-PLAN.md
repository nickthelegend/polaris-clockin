# Polaris on Solana: the port plan (CLOCK IN)

Written 6 Oct 2026, before any code. The Monad build (`packages/contracts`,
`apps/*`) stays in the repo as history; the Solana Mobile build is new code in
`packages/solana` (Anchor) and `apps/mobile` (Expo). Window: about 36 hours.

## What Polaris is, and what has to survive the port

Polaris is "payment links with credit built in": pay a merchant now, or **Pay
in 4** against an on-chain credit line that grows with good behaviour, and
**send dollars by link**. The core value to keep:

1. A buyer pays a merchant in dollars in one tap.
2. Pay in 4: the merchant is paid in full up front from a credit pool; the
   buyer repays four instalments; nothing due today.
3. A credit score and limit that are **on chain** and that the buyer can
   raise by behaving well.
4. Send dollars to anyone by link; whoever opens it claims, with no fees.

## Contract map: Monad (Solidity) → Solana (one Anchor program, `polaris`)

| Monad contract / integration | Solana equivalent | Status |
|---|---|---|
| `MockAUSD` (ERC-20, ERC-2612/3009) | **pUSD**: an SPL mint (6 decimals) whose mint authority is the program's `config` PDA; a `faucet` instruction mints test dollars on devnet. Mainnet: USDC (or PYUSD) instead, faucet disabled | Port |
| `PolarisPayments.pay` (Pay now) | `pay(amount, order_id)`: buyer ATA → merchant ATA, emits `Paid`, counts toward the buyer's record | Port |
| `MerchantRegistry` | `register_merchant(name)` → `Merchant` PDA `["merchant", authority]` with totals | Port (no off-chain KYC/operator roles) |
| `PolarisLoanEngine` (pool, loans, 10% APR, grace) | `fund_pool`, `open_plan`, `repay_installment`, `collect_due`; pool is a token account PDA `["pool"]`; each plan is a `Plan` PDA `["plan", buyer, index]`; 10% APR pro-rated over the four intervals | Port |
| `PolarisCheckout.openPlan` (intent + permit signatures, relayed) | The buyer signs the Solana transaction directly (MWA / guest wallet). `open_plan` also sets an SPL **delegate approval** to the `config` PDA for what the buyer owes, which is how Solana replaces ERC-2612 permits | Port |
| Chainlink CRE collections workflow | `collect_due(plan)`: a **permissionless crank** that pulls a due instalment through the delegate approval (anyone may call it; the buyer can also tap Repay). A keeper script is provided; no hosted keeper is deployed | Port (crank + script) |
| `ScoreManager` (score, tiers, underwriting from Nansen/Zerion facts via CRE) | `Profile` PDA `["profile", owner]`: score starts at 520, **+12** per on-time instalment, **−30** per late one, **+10** per plan repaid in full, **+2** per Pay now (first 10), **+1** per daily check-in (first 60). Limit tiers by score ($50 → $1,000). External-data underwriting (Nansen, Zerion, Etherscan via CRE) is **cut**: the score is built only from what the program sees | Port (simplified, trustless) |
| `CollateralVault` (lock dollars, boost the limit by a multiplier, seize on default) | **SKR collateral**: `lock_skr` / `unlock_skr` into a vault PDA; boost = locked SKR × price × 50%. Unlock refused if it would leave debt above the limit. Seizure on default is **cut** (documented) | Port, re-themed to SKR |
| Chainlink AUSD/USD guardian (pause Pay in 4 on depeg) | `credit_paused` flag in `config`, set by the admin. On mainnet this would read a Pyth USDC/USD feed; on devnet there is no oracle step | Simplified |
| SKR price | `skr_price_micros` in `config`, admin-set, **labelled stand-in for a Pyth / Switchboard SKR/USD feed** | Stand-in |
| `PolarisSend` (send by link, ephemeral link key, relayed claim) | `create_link(amount, expires_in)` escrows pUSD in a vault PDA keyed by an **ephemeral link keypair** whose secret is in the URL; `claim_link` must be signed by that key. The sender also tops the link key up with a little SOL, so **the link key pays the claim's fee and the recipient's token-account rent: claiming needs no SOL**. `cancel_link` returns the money to the sender while unclaimed | Port |
| `PolarisSplit` (split the bill) | **Cut** for the window | Cut |
| `PolarisPayments` subscriptions | **Cut** (would be delegate approvals + the same crank) | Cut |
| `BatchSettlement`, the relayer (Privy server wallet), webhooks, merchant dashboard (`apps/business`), the SDK, the demo shop (`apps/shop`), sealed receipts (HPKE), Envio indexer, Mera passkeys | **Not ported.** They are web/back-end products; the CLOCK IN deliverable is the buyer's phone app. The demo merchants are registered on devnet by a script and shown in the app's Shop | Not ported |
| — (new) | **Daily check-in** `check_in()`: one per UTC day; streak, best streak; pays an SKR reward from a rewards vault (base × min(streak, 7)); +1 score (first 60) | New: the daily loop |
| Jupiter | Not needed: there is no swap step in the product, and devnet has no meaningful liquidity. Mainnet idea (not built): pay any token, Jupiter swaps to USDC at checkout | Not used |

## The mobile app (`apps/mobile`, Expo, Android first)

- **Wallets:** Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js`)
  on Android, Seed Vault / Seeker compatible. A **guest devnet wallet** (a
  keypair in SecureStore, devnet only, labelled) for the iOS simulator and for
  judges without a devnet wallet.
- **Screens:** Home (pUSD + SKR balances, daily Clock-in card, plans due),
  Shop (devnet demo merchants) → Checkout (Pay now / Pay in 4 with the
  schedule), Credit (score, limit, SKR lock, plans, Repay), Send by link /
  Claim, Coach (AI), Settings.
- **Design:** the web app's design language (`packages/ui`, `docs/design`):
  dark canvas `#0f1011`, lime `#9cef5e` and purple `#8e5cf0` cards, Satoshi.
- **Daily loop:** Clock in once a day for SKR and score; your streak shows on
  Home; instalments due are surfaced there too.
- **SKR hook (two parts):** (1) daily SKR rewards for clocking in; (2) **lock
  SKR to raise your Pay in 4 limit** (SKR as credit collateral). Devnet uses
  a stand-in mint, labelled "SKR (devnet stand-in)" everywhere it shows.
- **AI (honest):** *Polaris Coach* uses Claude (Anthropic API) to explain
  your score and limit from your real on-chain profile and to answer "can I
  afford this Pay in 4?" before you confirm. It runs through a tiny coach
  server (`apps/coach`, needs `ANTHROPIC_API_KEY`, not deployed) or a key the
  user pastes into Settings. With neither, the app shows a rules-based
  summary and says plainly that the AI is off.

## Cut list (and why)

- Split the bill, subscriptions, merchant dashboard, SDK, webhooks, receipts,
  the indexer, passkey accounts: each is days of work; the phone app's
  pay / Pay in 4 / send / credit loop is the core.
- External-data underwriting: needed CRE + paid APIs; replaced by an on-chain
  behavioural score.
- Collateral seizure on default: the vault and the check that blocks unlock
  are built; liquidation is not.
- A hosted keeper and a hosted coach: the brief forbids new cloud deploys;
  both are scripts / a small server with exact deploy steps in HANDOFF.md.

## Order of work

1. Anchor program + `anchor test` on localnet.
2. Devnet: new deployer keypair (git-ignored, inside the repo), airdrop,
   deploy, `initialize`, create mints, fund pool and rewards, register demo
   merchants; record IDs and tx links.
3. Expo app, iOS simulator (iPhone Air) with the guest wallet, screenshots.
4. Release APK, emulator smoke test (lock), docs, push.
