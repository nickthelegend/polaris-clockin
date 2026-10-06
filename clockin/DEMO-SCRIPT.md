# Polaris: demo video script

Record on the Android emulator (`clockin_seeker`, release APK) or a Seeker.
Judges read the **transcript**, so narrate every scene (or upload captions).
Target length: about 2:45. A 90-second cut is marked ✂ (keep only those
scenes). Everything shown runs on Solana devnet; say so once at the start.

Before recording: the APK is installed and the devnet program is deployed and
set up (`packages/solana/scripts/deploy-devnet.sh`). If a wallet app is
installed (Solflare, Phantom or Mock MWA Wallet with a PIN lock), use
**Connect wallet** for the MWA shot; otherwise use the guest wallet and say
that it stands in for Seed Vault on the emulator.

| # | Time | On screen | Narration |
|---|---|---|---|
| 1 ✂ | 0:00–0:12 | App icon → onboarding, swipe the three pages | "This is Polaris: pay a shop now, or split it into four, from your phone. It runs on Solana devnet, and every number you'll see comes from one Anchor program." |
| 2 ✂ | 0:12–0:25 | **Connect wallet** → wallet sheet (MWA) → approve. (Emulator without a wallet: **Try with a guest wallet**.) | "I connect with Mobile Wallet Adapter, so on a Seeker this is Seed Vault. There's no account to make and nothing to download." |
| 3 ✂ | 0:25–0:40 | Home: the lime dollar card; tap **Add** (test dollars + SKR); the toast | "Polaris holds dollars. On devnet I tap Add for test dollars and some SKR, a labelled stand-in for Seeker's token." |
| 4 ✂ | 0:40–0:58 | The **Clock in** card → tap → streak ring fills, "+25 SKR, +1 score" | "Here's why you open it every day. Clock in once a day: your streak grows, you earn SKR, and your credit score goes up a point. Day seven pays seven times day one. Miss a day and the streak resets." |
| 5 ✂ | 0:58–1:15 | Shop → Kora Rail → *Lisbon → Porto, $64* → checkout on **Pay in 4**; "Over your available $50" | "My starter line is fifty dollars, so this sixty-four-dollar train ticket is over my limit." |
| 6 ✂ | 1:15–1:35 | Tap the warning → SKR sheet → **Lock 3,000 SKR** → limit goes up | "So I lock SKR. Half its value counts towards my limit, and the program won't let me unlock it while it backs what I owe. That's SKR as credit collateral." |
| 7 ✂ | 1:35–1:55 | Back to checkout: 4 × $16.12, due today $0.00, the four dates → **Start Pay in 4** → wallet approve → **Done.** | "Now it fits: four payments of sixteen dollars, nothing due today. The shop is paid in full right now from the credit pool, and my wallet gives the program an approval for exactly what I owe." |
| 8 | 1:55–2:10 | Tap **Ask Coach: can I afford this?** (before step 7) or the Coach tab | "Coach reads only my on-chain profile and tells me whether a plan fits and what moves my score. It runs on Claude when a key is configured; otherwise it says the AI is off and shows the rules." |
| 9 ✂ | 2:10–2:25 | Credit tab: score card, available to spend, the plan → plan sheet → **Pay $16.12** → score +12 | "Paying early counts as on time: plus twelve points. Every on-time instalment moves me towards the next tier. I can also pay an instalment in SKR, and that SKR refills the pool that pays tomorrow's check-ins." |
| 10 | 2:25–2:40 | Home → Send → keypad $25 → **Create link** → QR and Share | "And I can send dollars to anyone with a link. The link carries its own fee, so whoever opens it needs no SOL to claim." |
| 11 ✂ | 2:40–2:50 | Home activity list (tap one row → Solana Explorer, devnet) | "Every one of these is a devnet transaction you can open in the explorer. That's Polaris: pay in four, grow your line every day, and SKR that does real work." |

## Shot notes

- Use the release APK, not a dev build (no dev menu, no Metro).
- Turn on notifications in **Me → Daily reminder** before recording, and show
  the 9:00 reminder in a cut-away if you have time.
- If the devnet faucet is rate-limited, fund the wallet at
  https://faucet.solana.com before recording; **Me → Fee balance** shows SOL.
- Keep the wallet approval sheet on screen for a beat: judges look for MWA.
