# HANDOFF: Polaris on Solana Mobile (CLOCK IN)

Status as of Tue 6 Oct 2026, 22:30 IST. Deadline: 2026-10-09 06:59 UTC (Oct 8, 23:59 PDT).
Everything below was run on this Mac unless it says otherwise.

## What exists

| Part | Where | State |
|---|---|---|
| Anchor program `polaris` | `packages/solana` | Built, unit-tested and end-to-end tested on a local validator. **Not on devnet yet** (see below) |
| Mobile app | `apps/mobile` (Expo 57, RN 0.86) | Runs on the iOS simulator (release build) against the local validator, full flow verified |
| Release APK | `/Volumes/Extreme SSD/Projects/clockin/apks/polaris-clockin.apk` | Built and signed (release key, arm64-v8a + x86_64, 65.8 MB, sha256 `d2b4e1abbee9fed14373430f3be55bfc077c93b5cd65f14e8c4bd62a5c3abd98`); **never run on a device or emulator** |
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
   `clockin/screens/ios/`). This run found and fixed a Hermes bug
   (Buffer#subarray) that broke all account decoding.
5. `npx tsc --noEmit` clean in `apps/mobile`; `node --test` green in `apps/coach`.

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
2. **Host the APK** as a direct download, e.g. a GitHub Release asset:
   `gh release create v1.0.0 "/Volumes/Extreme SSD/Projects/clockin/apks/polaris-clockin.apk" -R nickthelegend/polaris-clockin`
   and paste the asset URL into the portal and SUBMISSION.md.
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
