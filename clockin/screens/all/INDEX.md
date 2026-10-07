# Polaris 1.1.0: screen census

Every reachable screen and state, in flow order, captured on the iPhone Air
simulator (iOS 26.5) from the release build against a local validator. The
scripted run (`apps/mobile/src/dev/autopilot.tsx`, driven by
`apps/mobile/scripts/ios-shots.sh`) uses a fresh guest wallet and real
transactions; `autopilot-log.txt` has every signature and the account state
after each step. Android was not run (no emulator allowed); the screens are
the same React Native code.

| # | Route | What it shows | How to reach it | Known issues |
|---|---|---|---|---|
| 01 | `/onboarding` | Page 1: "Pay now, or in four." | First launch | — |
| 02 | `/onboarding` | Page 2: the daily clock-in | Swipe | — |
| 03 | `/onboarding` | Page 3 and the wallet buttons (iOS: guest wallet only; Android adds Connect wallet via MWA) | Swipe | MWA button not shown on iOS by design |
| 04 | `/(tabs)` Home | New account: $0, "Add SOL for network fees" state, clock-in card, empty activity | Continue with a guest wallet | — |
| 05 | Home | Funded ($250 pUSD, 1,000 SKR), clock-in ready with day markers and rewards | Home → Add | — |
| 06 | Home | Clocked in: streak 1, countdown to the next reward, activity rows | Clock in | — |
| 07 | `/(tabs)/shop` | Four devnet merchants, prices, Pay in 4 tags | Shop tab | — |
| 08 | `/checkout` | First-run "How Pay in 4 works", the over-limit state: disabled Start Pay in 4 with the reason | Shop → Kora Rail → Lisbon → Porto | — |
| 09 | `/checkout` | Pay now mode | Checkout → Pay now | — |
| 10 | `/skr` | SKR collateral, nothing locked, disabled Lock with "Pick an amount" | Home → SKR card | — |
| 11 | `/skr` | 3,000 SKR locked, limit $125 | Lock SKR | — |
| 12 | `/checkout` | Pay in 4 now fits: 4 × $16.12, $0.00 due today, schedule | Back to checkout | — |
| 13 | `/checkout` | Receipt: amount, merchant, plan, network, explorer link, the schedule | Start Pay in 4 | — |
| 14 | `/(tabs)/credit` | Score card, line, available to spend, active plan, how the score moves | Credit tab | — |
| 15 | `/plan` | Plan detail: four payments, pay in pUSD or SKR | Credit → plan card | — |
| 16 | `/plan` | After paying instalment 1 early | Pay $16.12 | — |
| 17 | Credit | Score 521 → 533 after the on-time payment | Back | — |
| 18 | `/send` | Keypad, empty amount, disabled Create link with the reason | Home → Send | — |
| 19 | `/send` | Link ready: amount, QR, copy, Share | Type 25 → Create link | — |
| 20 | `/claim` | Claim screen for a link | Open `polaris://claim?k=…` | Claimed to the same wallet in the script |
| 21 | `/claim` | Claim receipt: $0.00 fee, explorer link | Claim | — |
| 22 | Home | After: balance, due next, SKR locked, activity | Back to Home | — |
| 23 | `/(tabs)/coach` | Profile summary, suggested questions, "Works without AI" (no key) | Coach tab | Claude path not exercised (no key) |
| 24 | Coach | A rules-based answer to "How do I reach the next tier fastest?" | Tap a suggestion | — |
| 25 | `/(tabs)/me` | Address QR, reminder switches, fees, optional Coach key | Me tab | — |
| 26 | Me | "Network & programs" expanded (RPC, program, mints) | Me → Network & programs | — |
| 27 | Home | Offline state with Retry (RPC unreachable, simulated in the script) | Lose connection | Simulated, not a real network cut |
| 28 | Home | Largest accessibility text size | iOS Settings → Accessibility → Larger Text | — |
| 29 | Credit | Largest accessibility text size | — | — |
| 30 | Checkout | Largest accessibility text size | — | — |

Not captured (no way to reach them on this simulator): the MWA wallet sheet and
"no wallet installed" error (Android only), system notification banners, the
Seeker verified badge (needs a Seeker's Genesis Token).
