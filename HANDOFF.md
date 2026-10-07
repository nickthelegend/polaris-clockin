# HANDOFF: Polaris on Solana Mobile (CLOCK IN)

Status as of Wed 7 Oct 2026, 19:30 IST (APK 1.1.1: Coach rules fix). Deadline: 2026-10-09 06:59 UTC (Oct 8, 23:59 PDT).
Everything below was run on this Mac unless it says otherwise.

## What exists

| Part | Where | State |
|---|---|---|
| Anchor program `polaris` | `packages/solana` | Built, unit-tested and end-to-end tested on a local validator. **Not on devnet yet** (see below) |
| Mobile app | `apps/mobile` (Expo 57, RN 0.86) | Runs on the iOS simulator (release build) against the local validator, full flow verified |
| Release APK | `/Volumes/Extreme SSD/Projects/clockin/apks/polaris-clockin.apk` | 1.1.1 (versionCode 4), built and signed with the release key (cert SHA-256 `8370bf40…376f`, same key as every earlier build), arm64-v8a + x86_64, sha256 `3d631819f9e49101515e813b051afcbd260796bf1596d9fbbbeb28400da618ae`; uploaded to the `clockin-v1` release and the re-downloaded file matches. **Never run on a device or emulator** |
| Coach server | `apps/coach` | Handler tested with a stub client; never called Claude with a real key; not deployed |
| Hackathon kit | `clockin/` | PORT-PLAN, SUBMISSION, PITCH, DEMO-SCRIPT, screenshots |

## Verified (with evidence)

1. **Program unit tests:** `cargo test --manifest-path programs/polaris/Cargo.toml --lib` →
   9 passed (`clockin/evidence/cargo-test.txt`).
2. **Program end-to-end tests:** `anchor test` → 19 passing on a local
   validator (ports 4270-4299): config and vaults, faucet caps, pool and
   rewards funding, merchant and profile, Pay now (+2), the $50 starter
   limit, SKR lock raising the limit to open a $120 plan, the delegate
   approval, collateral that can't be unlocked while it backs debt, the crank
   refusing early and collecting a late instalment (−30), early repayment
   (+12), the daily check-in (once a day, SKR reward), paying an instalment in
   SKR, closing a plan, send-by-link claimed by a wallet with 0 SOL (the link
   key ends empty), cancel, pause, and a stranger's repayment refused
   (`clockin/evidence/anchor-test.txt`).
3. **Smoke script against a running validator** (the same instructions the
   app sends): `scripts/smoke.ts` → "smoke OK", score 547, recipient 20 pUSD
   with 0 SOL (`packages/solana/deployments/localnet-smoke.json`).
4. **The app on the iOS simulator** (iPhone Air, release build, local
   validator): a scripted run (`apps/mobile/src/dev/autopilot.tsx`, only in
   bundles built with `EXPO_PUBLIC_AUTOPILOT=1`) drove a fresh guest wallet
   through airdrop → test funds → clock-in → lock 3,000 SKR → Pay in 4 for
   $64 → repay an instalment (score 521 → 533) → create a $25 link → claim it,
   with every transaction confirmed and the account state logged after each
   step (`clockin/screens/ios/autopilot-log.txt`, 18 screenshots in
   `clockin/screens/ios/`). Re-run green on 7 Oct with the 1.0.1 source
   (same results: score 521 → 533, link created and claimed, no read errors).
   This run found and fixed a Hermes bug
   (Buffer#subarray) that broke all account decoding.
5. `npx tsc --noEmit` clean in `apps/mobile`; `node --test` green in `apps/coach`.

## 1.1.1 (7 Oct): Coach rules fix

Without an AI key, every Coach question fell back to one summary, so "Why is
my limit what it is?" repeated the "points to Fair" answer. `coachRules.ts`
now routes each question to its own intent (afford, late, SKR, next tier,
limit, streak, score) and answers it; the limit answer explains the base
line from the score tier, plus SKR collateral, minus what's in use, and what
would raise it. `npm test` in apps/mobile: 9 tests (every suggested question,
keyword collisions, edge cases). Verified on the iPhone Air
(`clockin/screens/all/24-coach-answer.png`, `24b-coach-answer-limit.png`).

## Polish round (1.1.0, 7 Oct)

Driven by the review in `review/POLARIS-POLISH.md`; branch `polish`, merged to main.
- P0: content scrolls under a fade behind the floating tab bar with bottom room
  on every tab screen; a 12 pt floor for all text (13-15 pt body), Dynamic
  Type allowed with caps on display numbers; disabled buttons have a distinct
  style and a line saying why ("Over your $50.00 available…").
- P1: SKR explainer as three rows (earn, lock, spend) with bigger chips;
  Coach with a profile summary, suggested questions and a friendly "works
  without AI" state; Me with a smaller QR, reminder switches, the optional
  Coach key and the raw RPC/program IDs folded into "Network & programs";
  receipts on the checkout and claim success screens; bigger clock-in day
  markers with each day's reward.
- Basics: first-run "How Pay in 4 works" card; count-ups on balance and
  score (off with Reduce Motion); haptics on presses, chips, switches and
  results; loading, empty, low-SOL, error and offline states with Retry;
  accessibility roles/labels and 44 pt targets; a streak-at-risk reminder at
  20:00 (only on days you haven't clocked in) plus switches for each reminder.
- Evidence: `clockin/screens/all/` (30 screens and states with INDEX.md and
  the run log), `clockin/screens/polish/` (before/after pairs).
  cargo test 9/9, anchor test 19/19, `tsc --noEmit` clean.
- The offline screenshot is simulated by the autopilot (a test hook that only
  exists in autopilot builds), not a real network cut.
, 7 Oct, by inspection: no emulator allowed)

Checked on the built APK with `aapt2 dump badging`, `apksigner`, `unzip`,
`strings`, and in the source. Fixes are in commit 2bb4fc2; the APK below is
1.0.1.

| # | Check | Result |
|---|---|---|
| 1 | Package / version | `app.polarispay.clockin`, versionCode 1 → **2**, versionName **1.0.1**. PASS |
| 1 | min / target SDK | minSdk 24, targetSdk 36. PASS |
| 1 | Permissions | INTERNET, POST_NOTIFICATIONS, VIBRATE present. **Fixed:** removed SYSTEM_ALERT_WINDOW (dev tooling), READ/WRITE_EXTERNAL_STORAGE, USE_BIOMETRIC, USE_FINGERPRINT (`blockedPermissions`); verified absent in the 1.0.1 badging. Left: expo-notifications' boot-completed, wake-lock, FCM and launcher-badge permissions (library defaults, harmless) |
| 1 | Cleartext traffic | Not enabled; the release talks only to https devnet RPC. PASS |
| 1 | `<queries>` for wallets | **Fixed:** added an intent query for the `solana-wallet` scheme (plugin `with-mwa-queries`). PASS |
| 1 | Backups | **Fixed:** `allowBackup=false` (the guest key and Coach key are in SecureStore) |
| 2 | MWA native module in the APK | `com.solanamobile.mobilewalletadapter` classes present in classes3.dex. PASS |
| 2 | MWA call | dynamic import on Android only; `authorize({ chain: "solana:devnet", identity: { name, uri, icon }, auth_token })`; `signAndSendTransactions` with `minContextSlot`. PASS |
| 2 | Auth token / reauthorize | Cached in SecureStore. **Fixed:** if the wallet rejects the cached token, the app authorizes afresh in the same session; a silently switched account is refused |
| 2 | No wallet installed | **Fixed:** `ERROR_WALLET_NOT_FOUND` / "no installed wallet" now map to "No Solana wallet app found… use the guest wallet"; the guest wallet is offered on the same screen |
| 3 | JS bundle | `assets/index.android.bundle` present, Hermes bytecode (magic `c61fbc03`), no Metro. PASS |
| 3 | Local URLs in the bundle | **Fixed:** the app's own `10.0.2.2` / `127.0.0.1` fallbacks are gone (a localnet build must set `EXPO_PUBLIC_LOCAL_HOST`). Remaining strings come from libraries and are never used: `127.0.0.1` ×2 and `localhost:8899` (web3.js/Anchor local defaults), `localhost:8081/unpause` (React Native dev tooling). Devnet RPC `https://api.devnet.solana.com` present |
| 4 | Polyfills | `index.js`: `react-native-get-random-values`, then `Buffer` (plus the Hermes `subarray` fix) before expo-router and any Solana code. TextEncoder is native on Hermes. PASS |
| 5 | Back button | expo-router / react-navigation handles hardware back (sheets close, onboarding exits); predictive back disabled in app.json. PASS (not run) |
| 5 | Notifications | Channel `daily` created before scheduling; Android 13 permission is requested only after the first clock-in or from Me; due-date reminders never prompt. PASS (not run) |
| 5 | Deep links | `polaris://claim?k=…` and `polaris://checkout?…` intent filter present. PASS (not run) |
| 5 | WebView | None used. N/A |
| 5 | Keyboard / edge-to-edge / fonts | `adjustResize`; Coach input sits above the floating tab bar; safe-area insets used for the tab bar and screens (edge-to-edge default in Expo 57); Satoshi embedded by the expo-font plugin. PASS (not run) |
| 6 | Signing | `apksigner`: CN=Polaris, OU=CLOCK IN; cert SHA-256 `8370bf40d44f186682e9884972b3e637b3347c8e883ccdaa0b7576fa622b376f`, the same keystore as 1.0.0. PASS |
| 7 | ABIs / size | arm64-v8a + x86_64. PASS |
| — | Coach key field | Optional and labelled so; autofill off; stored only via SecureStore; never logged (grep: no console calls touch it); sent only to api.anthropic.com |

Not possible without a device: launching the APK, a real MWA wallet round
trip, notification delivery.

## Not verified / not done (honest list)

- **Devnet deployment: not done.** The deployer
  `BKaeJqmmgMTFAkTwUwBceLpGwpSRKfjc9TC8kvb6ieRP` has 0 SOL: the devnet
  airdrop returned 429 ("airdrop limit today / faucet dry") for this
  machine's IP all day (retried every 10 minutes). All devnet addresses are
  fixed in advance (`packages/solana/deployments/devnet.json`, `deployed:
  false`) and the APK is built against them, so it works as soon as the
  deploy below runs.
- **The APK was not run on any device or emulator.** The Android emulator
  was ruled out on this machine (it exhausted RAM). It was built and signed
  with Gradle only; the iOS simulator run above exercises the same JS code
  except the Mobile Wallet Adapter path.
- **Mobile Wallet Adapter was not exercised end to end** (no Android
  device/emulator, no wallet app). The code follows the MWA 2.3 API
  (dynamic import, `authorize` with `chain`, cached `auth_token`,
  `signAndSendTransactions` with `minContextSlot`).
- **Coach with Claude** has not been called with a real key (no key
  available to this session). The rules-based fallback is what the
  screenshots show, labelled "AI off · rules".
- Local notifications were not observed firing (the scripted run skips the
  permission prompt). The Seeker Genesis Token check only runs for MWA
  wallets and was not exercised.
- Cut from the Monad build: split the bill, subscriptions, merchant
  dashboard, SDK, webhooks, receipts, indexer, passkeys, external-data
  underwriting, collateral seizure (see `clockin/PORT-PLAN.md`).

## What you need to do

1. **Fund the deployer and deploy** (about 4 SOL; the program is 493 KB):
   send devnet SOL to `BKaeJqmmgMTFAkTwUwBceLpGwpSRKfjc9TC8kvb6ieRP`
   (https://faucet.solana.com, GitHub sign-in gives more), then:
   ```bash
   cd "/Volumes/Extreme SSD/Projects/clockin/polaris-clockin/packages/solana"
   bash scripts/deploy-devnet.sh             # deploy + setup (mints, pool, rewards, merchants)
   npx ts-node --transpile-only scripts/smoke.ts   # full flow on devnet -> deployments/devnet-smoke.json
   cd ../../apps/mobile && npm run sync-chain && cd ../.. && git add -A packages/solana/deployments apps/mobile/src/chain && git commit -m "Devnet: deployed" && git push
   ```
   The APK does not need rebuilding: the addresses it uses are the ones the
   setup creates. Put the program/tx links from `deployments/devnet*.json`
   into `clockin/SUBMISSION.md`.
2. **The APK is hosted**: https://github.com/nickthelegend/polaris-clockin/releases/download/clockin-v1/polaris-clockin.apk (paste it into the portal).
3. **Try the APK on a phone** (or an emulator on another machine) before
   recording: install, connect a devnet wallet (Solflare/Phantom on devnet,
   or the guest wallet), Add, Clock in, Pay in 4. Guest wallets need devnet
   SOL for fees: Me → Fee balance (airdrop), or faucet.solana.com.
4. **Record the demo** with narration (`clockin/DEMO-SCRIPT.md`), make the
   deck from `clockin/PITCH.md`, fill `<TEAM>`, `<APK_URL>`, `<VIDEO_URL>`.
5. **Optional AI:** run the coach server with your key and rebuild the APK
   with `EXPO_PUBLIC_COACH_URL`, or paste a key in the app (Me → Coach):
   ```bash
   cd apps/coach && npm install && ANTHROPIC_API_KEY=... PORT=4210 node server.mjs
   ```
   Hosting it anywhere public is a new deployment: your call.
6. **Back up the release keystore** (needed for dApp Store updates):
   `/Volumes/Extreme SSD/Projects/clockin/.keys/polaris-clockin-release.keystore`
   and its passwords in `polaris-clockin-signing.properties` next to it.
   Both are outside git.
7. Register and submit on https://solanamobile.radiant.nexus (agents must not).

## Rebuild commands

```bash
# APK (devnet), signed with the keystore above; caps memory
cd apps/mobile && npx expo prebuild -p android --no-install
cd android && EXPO_PUBLIC_CLUSTER=devnet ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon --max-workers=2 \
  "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=512m"
# iOS simulator (local validator), plus the scripted screenshots
EXPO_PUBLIC_CLUSTER=localnet EXPO_PUBLIC_AUTOPILOT=1 xcodebuild -workspace ios/Polaris.xcworkspace \
  -scheme Polaris -configuration Release -sdk iphonesimulator -derivedDataPath <dir> build
xcrun simctl install <udid> <dir>/Build/Products/Release-iphonesimulator/Polaris.app
bash scripts/ios-shots.sh <udid> ../../clockin/screens/ios
```

## Decisions made (no one was asked)

- One Anchor program instead of eight contracts; pUSD and SKR are stand-in
  mints whose mint authority is the config PDA (so a capped devnet faucet
  works); USDC and real SKR on mainnet.
- The credit score is purely behavioural and on chain; external-data
  underwriting (Nansen/Zerion via Chainlink CRE) is cut.
- SKR is integrated as earn (check-in rewards), lock (collateral that raises
  the limit) and spend (pay instalments; the SKR refills the rewards vault),
  not as staking. SKR price is admin-set ($0.05) on devnet.
- Send links: the sender pre-pays 0.0021 SOL to the link key so the claim is
  free for the recipient; the change is swept back on claim.
- No API key in the APK: the AI uses a server you host or the user's own key.
- The Monad-era README/plan/submission index moved to `docs/monad/`; the
  Monad code stays for reference. `pnpm docs:check` (Monad tooling) was not
  updated for the move.
- `apps/mobile`, `apps/coach` and `packages/solana` are outside the pnpm
  workspace and install with npm.

## Housekeeping

- A built iOS simulator app (release, local validator, autopilot on) is kept
  at `/Volumes/Extreme SSD/Projects/clockin/.cache/polaris-sim/Polaris.app`;
  Xcode derived data, Rust `target/debug|release`, Gradle intermediates and
  the local validator ledger were deleted to save disk. To run the simulator
  flow again, start a fresh validator and rerun `setup-devnet.ts` with
  `NETWORK=localnet` (README → Run it).
- The devnet airdrop retry loop was stopped; nothing of this session is left
  running (no Metro, validator, emulator or Gradle daemon).
