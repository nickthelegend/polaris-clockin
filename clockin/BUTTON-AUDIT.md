# Polaris 1.2.0: every-button audit (no mocks)

Run on 2026-10-12 with a **Release** build (`xcodebuild -configuration Release`, cluster devnet) on the iPhone Air
simulator (`D200DD2A-…`), guest wallet `H8DtAdGM…knEq`. Every on-chain row below is a real Solana devnet transaction,
checked with `solana confirm -u devnet <sig>` (all `Finalized`). The Android APK was built and signed but not run on a
device (no emulator, by rule).

## Program deployment (was "Preview mode")

The program was not on devnet, so the app showed a "Preview mode" banner. It is now deployed and initialised, and
the preview branch is deleted from the code.

| Step | Signature |
|---|---|
| Deploy `HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA` (max-len 540000; stale 2.74 SOL buffer closed first) | `35ovkmMiPrFYiFQwkiA5V6iEaniw682CnS4PigE7zCMH9yiaepas1smY5BjeLq7eWCHizpCEUegWv8g5fWsmWaRs` |
| initialize (config, pUSD and SKR stand-in mints) | `3nPs7QNjTJK3q9eSUChdxiyQLjuL1mKd719GUWZkqZvkex7Uz8Q86vaxs785ErrkgYnerQmTcg3FjMCBYA8ko1zP` |
| fundPool (5,000 pUSD credit pool) | `3MuQ2s9s4dqjzEbqEfz2XZDSXPoavKRqZG5pdqNjciuRMAiVPQAYRxzraEZECgprR1YyGJVUSy5ZWhUC14tPtW5H` |
| fundRewards (10,000 SKR clock-in rewards) | `2hfRUqjBtTdXhHJRTx6k3vR75YtE4MVLdnbCwB5fDYH1YMUdwYNkuryhEtsvwSm7UMrbBFXE7dv5a5wRT3fYzPC` |
| registerMerchant Studio Sol | `4NHy91EKRzjyPJnwb4Gucs269NnRAbjnUV1kwwHeMtH3SBuZ6MVHGuqAq5WbbLQ581tSWyqfcsSMYDx7uPxvp8Vh` |
| registerMerchant Kora Rail | `tqQL651C8ix92fnhwN4NPeX1veDJQnh915YKqtyzXjJ2tDVdjgKCpGYcY8QM17XfFtTS1xBQThY3xnUUy4h4xTQ` |
| registerMerchant Nomada Coffee | `yqcBt8Gv6rTiL3rAvB5uGrXmnZXYUGkZhAbr1xfJswZXzoajVDe4was5V16jnK5gTc8J9CQgcXwNUYmbPGSyYsp` |
| registerMerchant Lumen Audio | `Fn85zJYUTGHkvKQ8eiRVmHp3nmCCk4YVW7XeDVaWQ7SArjLc9CMvN8KJBDhAHscD5ABW4EtQxFS1TWTrU5hPkde` |

Spare deployer SOL (2.1) was swept back to hub1: `4ipPAavEvc1vHJ8osk1Nny9rQDAAZCNqQaqn71YmQ6rTjPxCjcMJEDfjaKmJkkm5ve6puRsKFpVUHhNRxZaLoH6i`.
No buffer accounts are left open.

## Controls

| Screen | Control | Expected | Result | Tx signature (devnet) | Fix |
|---|---|---|---|---|---|
| Onboarding | Next (×2) | Pages through 3 cards | Pass | | |
| Onboarding | Continue with a guest wallet | Loads the device key, signs a SIWS message, opens Home | Pass ("Signed in with Solana" on Me) | | SIWS added (see below) |
| Onboarding | Connect wallet (MWA) | Android only: authorize + `sign_in_payload` in one sheet | Not runnable on iOS; code path reviewed | | SIWS added |
| Home | Wallet chip | Opens Me | Pass | | |
| Home | Add | Mints 250 pUSD + 500 SKR stand-ins from the capped program faucet | Pass ($250, 500 SKR) | `5ec4VFLDk5hPSBD1yVWpPz98MBnwRTn3HFbyYYz89piGgrL8jrxhHYN7LRmkYFGfnxU7ziY9Uw8Eb4o7AtXPALCH` | Was blocked by a stale receipt from the undeployed era; journal fixed |
| Home | Get SOL (fee card) | Real devnet airdrop; on refusal opens faucet.solana.com | Airdrop refused (429), faucet page opened | | |
| Home | Clock in · +25 SKR | `check_in`: 25 SKR, +1 score, streak 1 | Pass | `2j95eQW2mn1e2UL214Zau97NRT8AGRnwvSd6gxEtH6cKwW6X6NgXkLwBHNoR93KtgHnZynYU4FJJYg4miknyQNaT` | |
| Home | Send / Shop / Credit shortcuts | Open those screens | Pass | | |
| Home | SKR card, "Lock to raise limit" | Opens SKR collateral | Pass | | |
| Home | Pull to refresh | Re-reads chain | Was stuck spinning after a background poll | | Spinner now owned by the gesture (`usePullRefresh`) |
| Home | Recent activity | Real history of this wallet | Was empty (JSON-RPC batch refused) | | Fetched one tx at a time; now lists claim, link, repays… |
| Home | Activity row | Opens Solana Explorer for that tx | Pass | | |
| Shop | Item rows (4 merchants, all registered on devnet) | Open checkout | Pass | | |
| Checkout | Pay now / Pay in 4 segment | Switches mode | Pass | | |
| Checkout | Ask Coach: can I afford this? | Answer from on-chain facts; says "Rules-based (AI off)" without a key | Pass | | |
| Checkout | Pay $4.50 (Nomada Coffee, Flat white) | `pay`: pUSD to the merchant | Pass | `5wyK5CukM7VMq4gPsgvuzCbgyGhx8cqcjU8M317GxgryVKfgeSVV3yVi2hBeuW6g2p3gk9z5ewf6coKPce6SxVY3` | Receipt no longer prints a hash |
| Checkout | How Pay in 4 works → Got it | Hides intro | Pass | | |
| Checkout | Start Pay in 4 ($28 House beans) | `open_plan`: pool pays the merchant, 4 × $7.05 | Pass | `3LQ8ooxZPFczNBWbZbyYFLPmb1NP9woAPVHybYMBizTewbuxZsPxACGdwj1DCNk1cxyczTnCT84e58vDbBbabuCT` | |
| Receipt | View on Solana Explorer / Done | Explorer / back | Pass | | Hash text removed |
| Credit | Active plans list | Shows the open plan | Was "No plans yet" while $28.21 was owed (gPA read) | | Plans now derived as PDAs and read with getMultipleAccounts |
| Plan | Pay $7.05 (instalment 1) | `repay_installment`, +12 | Pass | `378UizsUR22ovCsfWHEeJxpcfqs4WdFMR2ZZUJLqbxbHg7zuZ4KN8VwMg3RyxwoFQgjuALvCP9E5TSPtXgf5unNH` | |
| Plan | Pay with 141.07 SKR (instalment 2) | `repay_with_skr` | Pass | `5fe7BdNkKG3UcEJqKm1ekX19vH9avFAqG5Ebiy6ZP9UWUrJAQxi15PjGkQQehhNZ79fKE965wLBCHCesyrRXeA4i` | |
| Plan | Pay $7.05 (instalment 3) | `repay_installment` | Pass | `62RYAiT5zvwcCAwfBuizYxFq9JSFNnfT1rdJGAhQtXBxEfPay81XrA7DCGwBRpNPcy9vKEsLcnvrnzhJ1ToFH6Mt` | |
| Plan | Pay $7.05 (instalment 4) | Plan repaid, +10 | Pass: **score 521 → 579, line $50 → $150** | `5Yt9BRtYvhhS8Kaiw9QKh5naJmZ6octK6kHooEAL6C9Qrxpv7HPHHCUJ87QgBmbCPnWWtQWeMmZgMXXPjHeZgS2H` | |
| Plan | Close (chevron) | Back to Credit | Pass | | Empty state now "No active plans" |
| SKR | Lock / Unlock segment, amount pills | Select | Pass | | |
| SKR | Lock 250 SKR | `lock_skr`; limit $150 → $156 | Pass | `FSWZhxnjZrpkzRhoyH16u5w437f4xaedz27dfoxLZS2ad9We711DhiFkZTQ15TBu2HKvDTKCFnsi9kykYvxUM1x` | |
| SKR | Unlock 250 SKR | `unlock_skr` | Pass | `4CTwm6Dw2N4UzfEBYFBSii96NJM6b84x8CBdAa2cycFNLKN9dgUvrEdFTz56KX6WmNHMtY7vuJtTAN1ja3xp9JmN` | |
| Send | Keypad, Create a $5.00 link | `create_link`: escrow + link key funded | Pass | `3R8jXnLjS55sK3iYkMapqxeGNbZ1KoSffJyKp3KY4W5L22FU3pcBT1pXrJbje1pUhZmwaCH8pDBVtr6MbH2Ld4Pu` | Expiry text now "until Oct 26" |
| Send | Copy link | Copies `polaris://claim?k=…` after the link is finalized | Pass | | |
| Send | Share | System share sheet with the same verified URL as Copy | Pass (1.2.1: iOS share sheet with the claim message) | `4Xnh3xBsrtCa73tGPjsGbqTB3RBNb8XnPR8swbiFZGYrj7gdkexZzx9wm477q84qgTGaCxoKE6YqQwRLzGZQvvGy` (link) | |
| Claim | Open link (deep link) → Claim $5.00 | `claim_link`, the link key pays its own fee | Pass | `2vojfCsCcZBFWDkmxR2mdr8PJ3S3qaS2HfhSpBaPdmohC7MKHj6nCvmpQxe5Hvsgy4QkT1wRSDHGbVwRtEugkVWR` | Sender/recipient addresses replaced with words |
| Coach | 4 suggested questions, free-text + send | Distinct answers from the on-chain profile | Pass ("Rules-based answer (AI off)") | | |
| Coach | See / Hide what Coach sees | Shows the exact facts sent | Pass | | |
| Coach | Add key | Goes to Me → Coach AI | Pass | | |
| Me | Copy address | Copies the receive address | Pass | | |
| Me | 3 reminder toggles | Schedule/cancel local notifications | Pass (iOS permission granted) | | |
| Me | Get SOL | Real airdrop request | Pass (request sent; faucet rate-limited) | | |
| Me | Coach key field + Save | Stores the user's own Anthropic key in SecureStore | Not exercised with a real key (no credentials entered by the tester) | | |
| Me | Network & programs (Advanced) | Expand | Pass | | RPC URL and mint addresses removed |
| Me | Polaris program → Explorer | Opens the program on Explorer | Pass | | |
| Me | Disconnect | Back to onboarding; guest reconnects to the same account | Pass | | |

## Mocks and dev text removed

- "Preview mode" banner and every `DEPLOYED`/`PREVIEW_NOTE` branch (the program is live on devnet).
- A receipt journal that refused every new transaction forever if one old transaction never landed; it now clears
  a record once its blockhash window has passed and never shows a raw signature in an error.
- Raw hashes on receipts and toasts; RPC URL and mint addresses in Me; shortened addresses on the claim screen;
  JSON chain errors in messages.
- `getProgramAccounts` for plans and the JSON-RPC batch for activity (both failed on public devnet).

Grep (`mock|fake|dummy|placeholder|lorem|preview mode|stub|TODO|setTimeout`) left only: the toast's auto-hide timer,
a scroll-to-end delay, text-input placeholders, a comment naming the "Mock MWA Wallet" test app, and the dev-only
autopilot (`EXPO_PUBLIC_AUTOPILOT`, never set in release builds).

## Sponsor tech

- **Mobile Wallet Adapter** (Android, Seed Vault on Seeker) with the labelled guest wallet on iOS.
- **Sign In With Solana**: new in 1.2.0. MWA `authorize({ sign_in_payload })`, falling back to `signMessages`; the
  guest key signs the same message. The ed25519 signature, domain, nonce, chain and time are verified on the phone and
  re-checked at every start ("Signed in with Solana" on Me).
- **SKR**: devnet stand-in mint (clearly labelled) earned by clock-ins, locked as collateral, and spent on instalments.
- **Seeker Genesis Token**: read-only mainnet check of the connected account (Token-2022 group member of the SGT group).

## Still not real

- Coach AI answers need the user's own Anthropic key (or a hosted coach server that is not deployed); without one, the
  app shows rules-based answers and labels them "AI off".
- The devnet SOL airdrop is rate-limited for most IPs; the app then opens the official faucet.

## 1.2.1 final pass (Oct 12 evening)

- **Send after a claimed link** was permanently blocked ("link account is unavailable or closed", Create link disabled).
  Fixed: a closed link account with a later successful transaction clears the saved link ("Your last link was claimed").
  Re-run: link `4Xnh3xBs…QvvGy` created after link `iZtQUcUk…nuPBz` was claimed (`51iGoGMb…3edbU`), Share opened the system sheet.
- Coach key field validates the `sk-ant-` format before Save; no-key path answers from rules, labelled "AI off".
- Second sweep: Home, Shop, Checkout (Pay now / Pay in 4), Credit, Plan, SKR, Send, Claim, Coach, Me (+ Advanced). No other issues.
