# Polaris app (`@polaris/app`)

The consumer side of Polaris: a mobile-first, installable PWA where a buyer
creates an account with Face ID, pays merchant links in full, in four or on a
subscription, and sends dollars anywhere with a link. The plan is in
[`docs/plan.md`](../../docs/plan.md) (§2, §3.1, §5.3, §5.5, §5.6) and the visual
design in [`docs/design/system.md`](../../docs/design/system.md): dark, built
entirely from the shared library [`@polaris/ui`](../../packages/ui) (open
`/gallery` to see every component beside its reference).

## Run it

Node 22.6+ and pnpm 10, from the repository root:

```bash
pnpm install
pnpm --filter @polaris/app dev          # http://localhost:3000
```

| Command (with `pnpm --filter @polaris/app`) | What it does |
|---|---|
| `dev` | Next dev server |
| `build` / `start` | Production build and server |
| `typecheck` | `tsc --noEmit` (strict) |
| `lint` | ESLint with `eslint-config-next` |
| `check:signatures` | Checks every EIP-712 struct and nonce against the contracts' definitions (28 checks, no chain needed) |

Open it at **`http://localhost`**, not `127.0.0.1` or a LAN IP: WebAuthn only
accepts a domain name as the relying party, and `localhost` is the one domain
browsers allow over plain http.

## Environment

Copy [`.env.example`](.env.example) to `.env.local`. Everything is `NEXT_PUBLIC_*`,
inlined at build time, and public.

| Variable | Default | What it is |
|---|---|---|
| `NEXT_PUBLIC_RP_ID` | the page's hostname | The WebAuthn relying party. **Production: `polarispay.app`**, so `app.` and `pay.` share one account per person. A passkey, and the account derived from it, belongs to this id forever. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | unset | The Privy app (the dashboard's) behind **Continue with email**. Unset hides the option; Face ID works either way. |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | unset | Optional: a Privy *app client* made for the web origin. |
| `NEXT_PUBLIC_BUILD_TARGET` | unset | `android` for the Android build only. |
| `NEXT_PUBLIC_PRIVY_ANDROID_CLIENT_ID` | unset | The Privy app client for the **Android build** (read only when `NEXT_PUBLIC_BUILD_TARGET=android`). It is locked to the Android package, so the web build never passes it as its `clientId`. |
| `NEXT_PUBLIC_DEV_SIGNER` | unset | `1` replaces Face ID with a random key in the tab's `sessionStorage`, for headless runs. A "Dev signer" badge is always on screen while it is set. Never set it in a deployment. |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | Monad testnet; `143` for mainnet |
| `NEXT_PUBLIC_RPC_URL` | viem's default for the chain | Read-only RPC (EIP-712 domains, permit nonces) |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://testnet.monadvision.com` | Where "View receipt" goes |
| `NEXT_PUBLIC_AUSD_ADDRESS` | AUSD on Monad testnet | The dollar token |
| `NEXT_PUBLIC_PAYMENTS_ADDRESS`, `_CHECKOUT_ADDRESS`, `_SEND_ADDRESS`, `_LOAN_ENGINE_ADDRESS` | unset | Polaris contracts. Unset ones sign against a local placeholder domain, which only the stub relayer accepts. |

## Accounts

One interface (`AccountImplementation` in `src/lib/account/index.ts`), three
implementations; the rest of the app never asks which one is in use:

| Source | How you get in | What signs |
|---|---|---|
| `mera` | **Face ID**, the primary sign-up | A key derived from the passkey's PRF (below) |
| `privy` | **Continue with email**, beneath Face ID: an email code, and Privy creates an embedded wallet on login (`createOnLogin: "users-without-wallets"`; the Privy dashboard leaves it off, so the client asks) | The embedded wallet, through Privy's `useSignTypedData`, with no Privy UI. `src/lib/account/privy.ts` wraps it as a viem account, and every signature is checked to recover to the wallet before it is used |
| `dev` | `NEXT_PUBLIC_DEV_SIGNER=1` | A key in the tab's `sessionStorage` |

All three sign the same EIP-712 payloads (`src/lib/actions.ts` is unchanged by
which one is in use). Only email is offered: Google is off in the Privy app.
The email sheet is ours (`components/email-login-sheet.tsx`); it never says
wallet.

### Face ID (Mera)

[Mera](https://mera.category.xyz): no seed phrase, no extension, no custody
backend.

```
Face ID ─► passkey PRF (32 bytes) ─► BIP-39 entropy ─► m/44'/60'/0'/0/0 ─► Mera signing session ─► viem LocalAccount
```

- `src/lib/account` exposes `createAccount()`, `continueWithEmail()`,
  `signIn()`, `getAccount()`, `authorize()` (what every Confirm calls) and
  `signOut()`.
- Only public metadata is stored, in `localStorage`: the credential id, its
  transports, the rpId and the account's address. The PRF output and the key
  are never stored; every sign-in recomputes them.
- Ceremonies only ever start from a tap. Creating an account and paying is
  **one** Face ID.
- The derivation path is frozen. The same passkey gives the same account on
  every device it syncs to.

### Supported devices

From Mera's authenticator table (see `docs/research/mera.md` §12):

| Works | Doesn't |
|---|---|
| iPhone, iOS 18+ (Safari or Chrome, iCloud Keychain) | Desktop Chrome's local profile (it creates a passkey, then can't use it) |
| Android, Chrome or Edge (Google Password Manager) | Bitwarden, Dashlane |
| Mac, macOS 15+ (Safari, Chrome 132+, Firefox 139+) | Windows before 11 25H2 |
| Desktop Chrome signed in to Google Password Manager | In-app browsers (Instagram, Facebook, TikTok): the app says "Open in Safari or Chrome" |
| Windows 11 25H2+ (Edge, Chrome 147+, Firefox 148+) | |
| 1Password, Proton Pass, YubiKey 5 | |

A browser that can't hold an account gets **"Open Polaris on your phone"**
with a QR code of the page. Passkeys sync within one provider only (iCloud
Keychain across Apple devices, Google across Android and Chrome), so an
iPhone account doesn't appear on an Android tablet; *I already use Polaris*
is always offered before creating a second account.

### Testing without a phone

- **Chrome's virtual authenticator** exercises the real Mera path: DevTools →
  More tools → WebAuthn → *Enable virtual authenticator environment*, add a
  `ctap2` / `internal` authenticator with resident keys, user verification
  and **PRF** on. Scripts can do the same over CDP
  (`WebAuthn.addVirtualAuthenticator` with `hasPrf: true`), which is how
  Mera's own end-to-end tests run.
- **The dev signer** (`NEXT_PUBLIC_DEV_SIGNER=1`) skips WebAuthn entirely.
- **A phone** needs a real https domain inside the rpId, for example
  `dev.polarispay.app` with `NEXT_PUBLIC_RP_ID=polarispay.app`.

## Screens

Only the five tabs are full screens, under ref A's floating nav. Everything
you *do* slides up as a `BottomSheet`, routed through the root layout's
`@sheet` parallel route: from inside the app an intercepting route
(`app/@sheet/(.)send` and so on) presents it over the current tab, which
scales back behind it like iOS; a cold link (a checkout link from a merchant)
opens the page itself, the sheet over a blurred tab. Back, the close button
and a swipe down close it and restore the URL. The sheet lives in a host
(`components/shell/sheet-host.tsx`) that outlives the route, so it springs
out again even when the browser's Back removed it.

| Route | Presentation | What it is |
|---|---|---|
| `/` | tab | Home (ref A): the lime balance card, quick transfer, recent transactions |
| `/insights` | tab | My spending, Expenses by category, and `?view=plans`: Pay in 4, subscriptions, paid off |
| `/cards` | tab | Ref D's balance card with side squares, the three accounts, details |
| `/activity` | tab | Every transaction, grouped by day, with filter chips and Filters |
| `/profile` | tab | Who you are, how you sign in, settings, log out |
| `/send` | full sheet | Ref A's transfer: who, from which account, the amount, the keypad; a link (`/claim#k=…`) or straight to a Polaris account |
| `/receive` | half sheet | Your code and link for getting paid |
| `/add` | half sheet | Ask, show your code, or claim a link |
| `/pay` | full sheet | Scan a code, paste a link, or try a sample |
| `/pay/[id]` | full sheet | Checkout (ref C): Pay now, Pay in 4 or Subscribe, the limit, Raise your limit |
| `/claim` | full sheet | Reads the link's fragment, which never reaches a server; claim with one Face ID |
| `/accounts` | half sheet | Select account (the card carousel); which one Home shows |
| `/activity/[id]` | half sheet | Transaction detail and *View receipt* |
| `/plans/[id]` | half, drags to full | Plan detail and *Pay early* |
| `/credit` | full sheet | Credit line (ref B): active plans, upcoming payments |
| `/credit/score` | full sheet | Credit score, line or candles, week by week |
| `/notifications` | half sheet | Payments due, money in, links claimed |
| `/settings` | half sheet | Name on links, local currency, log out, remove from this device |
| `/onboard?next=…` | page | Three pages (ref B), then Face ID with *Continue with email* beneath |
| `/gallery` | page | Every `@polaris/ui` component |

Inside those: Confirm with Face ID (compact: it fits its content), the success
receipt with its check-mark (half), Filters, and Continue with email. A sheet
opened over another stacks above it, with its own dimmed backdrop.

The buyer never reads *wallet, address, seed phrase, passkey, sign, approve,
transaction, gas, MON, AUSD, USDC, token, blockchain, on-chain* or *Monad*. The
only exception is the optional *Raise your limit* step, which says "wallet"
because it is for people who already have one.

## Code map

| Path | What it is |
|---|---|
| `src/lib/account/` | The account layer: one interface; Mera (Face ID), Privy (email) and the dev signer; capability check |
| `src/lib/sign/` | EIP-712 builders for `PlanIntent`, `SubscribeIntent`, ERC-3009, ERC-2612, `Claim`, `Cancel`, `CancelSubscription`; domain reading (ERC-5267); nonce derivations |
| `src/lib/actions.ts` | Each money action: build, sign, relay |
| `src/lib/relayer.ts` | The typed relayer client. **A stub for now**: it returns a made-up receipt |
| `src/lib/data/` | The data interface every screen reads; `mock.ts` is placeholder data behind it |
| `src/screens/`, `src/sheets/` | The five tabs, and every sheet with its route wrapper (`SendRoute`, `CheckoutRoute`…), which the pages in `app/(tabs)` (cold) and `app/@sheet` (intercepted) render |
| `src/components/` | App pieces composed from `@polaris/ui`: the shell (stage, sheet host, nav), Confirm with Face ID, the success receipt, the email sheet, QR |
| `src/lib/view.ts` | Figures the screens derive from the data layer (spending by category, the score week by week) |
| `public/assets/` | Generated images, picked up as soon as they exist (see below) |

## Images

Two kinds of generated image are read from fixed paths, each with a drawn
stand-in, so dropping the files in needs no code change:

| Path | What it is | Until it exists |
|---|---|---|
| `public/assets/coin.png` | The 3D coin on the claim card | — |
| `public/lottie/onboarding-{1,2,3}.json` | The onboarding animations (played with lottie-react) | The glass renders in `public/assets/onboarding/`, floating |
| `public/assets/avatars/<first name>.jpg` | A person's portrait, e.g. `marisol.jpg`, `tomas.jpg` (lower case, no accents) | Tinted initials |

## Not built yet

- The relayer and indexer: receipts are simulated, and all balances, plans and
  activity are placeholder data (`src/lib/data/mock.ts`).
- *Raise your limit* simulates the WalletConnect signature and the
  underwriting call.
- Pay early has no signed early-repayment entry point on the loan engine yet.
- Receipts only you can read (plan §3.5) and the opt-in recovery key.
- Local-currency rates are placeholders.
