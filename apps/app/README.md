# Polaris app (`@polaris/app`)

The consumer side of Polaris: a mobile-first, installable PWA where a buyer
creates an account with Face ID, pays merchant links in full, in four or on a
subscription, and sends dollars anywhere with a link. The plan is in
[`docs/plan.md`](../../docs/plan.md) (§2, §3.1, §5.3, §5.5, §5.6) and the visual
design in [`docs/design/mobile.md`](../../docs/design/mobile.md).

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
| `NEXT_PUBLIC_DEV_SIGNER` | unset | `1` replaces Face ID with a random key in the tab's `sessionStorage`, for headless runs. A "Dev signer" badge is always on screen while it is set. Never set it in a deployment. |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | Monad testnet; `143` for mainnet |
| `NEXT_PUBLIC_RPC_URL` | viem's default for the chain | Read-only RPC (EIP-712 domains, permit nonces) |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://testnet.monadvision.com` | Where "View receipt" goes |
| `NEXT_PUBLIC_AUSD_ADDRESS` | AUSD on Monad testnet | The dollar token |
| `NEXT_PUBLIC_POLARIS_API_URL` | unset | Polaris for Business (e.g. `http://localhost:3100`): the relayer (`POST /api/relay`), checkout sessions and payment links (`/api/public/…`), and the network's contracts and EIP-712 domains (`/api/public/network`). Unset: the stub relayer and sample links. |
| `NEXT_PUBLIC_PAYMENTS_ADDRESS`, `_CHECKOUT_ADDRESS`, `_SEND_ADDRESS`, `_LOAN_ENGINE_ADDRESS` | unset | Polaris contracts. With the API set they come from it (and, if set here too, must match it). Without either, unset ones sign against a local placeholder domain, which only the stub relayer accepts. |

## Face ID accounts

[Mera](https://mera.category.xyz) is the entire account layer: no seed phrase,
no extension, no custody backend.

```
Face ID ─► passkey PRF (32 bytes) ─► BIP-39 entropy ─► m/44'/60'/0'/0/0 ─► Mera signing session ─► viem LocalAccount
```

- `src/lib/account` exposes `createAccount()`, `signIn()`, `getAccount()`,
  `authorize()` (what every Confirm calls) and `signOut()`.
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

| Route | What it is |
|---|---|
| `/` | Home: dollar balance with a local-currency equivalent, credit available, Send / Receive, the send-abroad promo, Send again, History |
| `/onboard?next=…` | Create your account with Face ID, then back to `next` |
| `/pay` | The raised Pay tab: scan a code (where the browser can), paste a link, or try a sample |
| `/pay/[id]` | Checkout for a merchant link: Pay now, Pay in 4 (schedule and total interest shown), Subscribe; the limit and its reasons; Raise your limit; one Face ID; the receipt |
| `/send` | Keypad, then a send link (`/claim#k=…&a=…&n=…`) shared with the share sheet or copied, then "Waiting to be claimed" |
| `/claim` | Reads the link's fragment, which never reaches a server; Face ID to create or sign in; Claim; "Arrived" |
| `/plans` | Pay in 4 schedules with instalment ticks and *Pay early*; subscriptions with *Cancel* |
| `/activity` | Every receipt, grouped by day; *View receipt* opens the explorer |
| `/cards`, `/profile` | Select card; name on links, local currency, sign out |

The buyer never reads *wallet, address, seed phrase, passkey, sign, approve,
transaction, gas, MON, AUSD, USDC, token, blockchain, on-chain* or *Monad*. The
only exception is the optional *Raise your limit* step, which says "wallet"
because it is for people who already have one.

## Code map

| Path | What it is |
|---|---|
| `src/lib/account/` | The Mera account layer, capability check, dev signer |
| `src/lib/sign/` | EIP-712 builders for `PlanIntent`, `SubscribeIntent`, ERC-3009, ERC-2612, `Claim`, `Cancel`, `CancelSubscription`; domain reading (ERC-5267); nonce derivations |
| `src/lib/actions.ts` | Each money action: build, sign, relay |
| `src/lib/relayer.ts` | The relayer client: `POST {NEXT_PUBLIC_POLARIS_API_URL}/api/relay`, errors mapped to `RelayError` with the server's message for the buyer. Without the API, a local stub |
| `src/lib/network.ts`, `src/lib/api.ts` | The network (contracts and EIP-712 domains) from Polaris for Business; the fetch helper |
| `src/lib/data/remote.ts` | Real checkout links: `cs_…` sessions and `pl_…` payment links, mapped to `PaymentLink` |
| `src/lib/checkout-return.ts` | The `polaris:checkout` postMessage protocol back to the merchant page (`announceReady`, `finishCheckout`, `cancelCheckout`) |
| `src/lib/data/` | The data interface every screen reads; `mock.ts` is placeholder data behind it |
| `src/components/` | The design system: buttons, cards, sheets, keypad, QR, tab bar |
| `public/assets/` | Generated images, picked up as soon as they exist (see below) |

## Images

Two kinds of generated image are read from fixed paths, each with a drawn
stand-in, so dropping the files in needs no code change:

| Path | What it is | Until it exists |
|---|---|---|
| `public/assets/coin.png` | The 3D silver coin on the promo and claim cards (transparent PNG) | The drawn SVG coin |
| `public/assets/avatars/<first name>.jpg` | A person's portrait, e.g. `marisol.jpg`, `tomas.jpg` (lower case, no accents) | Tinted initials |

## Not built yet

- Balances, plans and activity are still placeholder data
  (`src/lib/data/mock.ts`) until the Envio indexer lands; checkout links and
  the relayer are real when `NEXT_PUBLIC_POLARIS_API_URL` is set.
- The `/pay/[id]` screen doesn't yet call `src/lib/checkout-return.ts`, so a
  popup checkout doesn't post its result to the merchant page.
- *Raise your limit* simulates the WalletConnect signature and the
  underwriting call.
- Receipts only you can read (plan §3.5) and the opt-in recovery key.
- Local-currency rates are placeholders.
