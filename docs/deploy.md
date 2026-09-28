# Deploying Polaris

Four apps go to public HTTPS for the submission. Nothing in this repository
deploys itself: you run these steps with your own Vercel, Fly.io (or Railway),
Upstash and Privy accounts. When everything is up, one command checks the whole
deployment ([step 7](#7-run-the-deploy-check)).

| App | Where | Why there |
|---|---|---|
| **Polaris for Business** (`apps/business`): the dashboard, the API, the relayer | **Fly.io**, one Machine with a 1 GB volume ([`apps/business/fly.toml`](../apps/business/fly.toml)); or Railway ([`apps/business/railway.json`](../apps/business/railway.json)) | It is one long-lived Node process with a persistent disk: the SQLite store, the relayer's nonce lanes, the rate limits and the chain sync all live in that process. The [Dockerfile](../apps/business/Dockerfile) builds it |
| **The Polaris app** (`apps/app`): the buyer's app and the hosted checkout | **Vercel** ([`apps/app/vercel.json`](../apps/app/vercel.json)) | Static pages plus one small function (`/api/fx`) |
| **The landing page** (`apps/landing`) | **Vercel** ([`apps/landing/vercel.json`](../apps/landing/vercel.json)) | A static page |
| **Halcyon, the demo shop** (`apps/shop`) | **Vercel** with **Upstash Redis** ([`apps/shop/vercel.json`](../apps/shop/vercel.json)) | Its orders must be shared by every function instance: the checkout creates an order in one, the Polaris webhook marks it paid in another |

Everything stays on **Monad testnet** (chain 10143), against the deployment in
[`packages/contracts/deployments/monad-testnet.json`](../packages/contracts/deployments/monad-testnet.json).
Its dollar is the labelled `MockAUSD`, and the relayer is the dev relayer
until the Privy server wallet exists (README, "What only you can do", step 4).

## Contents

0. [Before you start: pick the four URLs](#0-before-you-start-pick-the-four-urls)
1. [Polaris for Business on Fly.io](#1-polaris-for-business-on-flyio) (or [Railway](#1b-or-railway))
2. [The Polaris app on Vercel](#2-the-polaris-app-on-vercel)
3. [The landing page on Vercel](#3-the-landing-page-on-vercel)
4. [Halcyon on Vercel, with Upstash Redis](#4-halcyon-on-vercel-with-upstash-redis)
5. [Privy: allowed domains](#5-privy-allowed-domains)
6. [Custom domains](#6-custom-domains)
7. [Run the deploy check](#7-run-the-deploy-check)
8. [Every environment variable](#8-every-environment-variable)
9. [Rehearse it locally](#9-rehearse-it-locally)
10. [Troubleshooting](#10-troubleshooting)

---

## 0. Before you start: pick the four URLs

Every app names the others, so decide all four URLs first; then each is set
once and nothing needs a second deploy. With the platforms' own domains they
follow from the project names you choose:

| | Example (platform domains) | Example (your domain) |
|---|---|---|
| `APP` | `https://polaris-app.vercel.app` | `https://app.polarispay.app` |
| `BUSINESS` | `https://polaris-business.fly.dev` | `https://business.polarispay.app` |
| `LANDING` | `https://polaris-landing.vercel.app` | `https://polarispay.app` |
| `SHOP` | `https://polaris-shop.vercel.app` | `https://shop.polarispay.app` |

**Decide the Face ID domain now.** A Face ID account (a Mera passkey) belongs
to one WebAuthn relying party, `NEXT_PUBLIC_RP_ID`, for good: move the app to
another domain later and those accounts can't sign in there. The relying party
must be the app's host or a domain the host is under, and never a platform's
shared domain (`vercel.app` is a public suffix):

- **With your own domain** (the plan's `polarispay.app`): `NEXT_PUBLIC_RP_ID=polarispay.app`, and the app on `app.polarispay.app`.
- **With Vercel's domain only**: leave `NEXT_PUBLIC_RP_ID` unset (the app uses its own host, `polaris-app.vercel.app`). Fine for the hackathon; those accounts stay on that host.

Tools, once (from a terminal on your machine):

```bash
npm install -g vercel                        # the Vercel CLI (optional; the dashboard does all of it)
curl -L https://fly.io/install.sh | sh       # flyctl (Windows PowerShell: iwr https://fly.io/install.ps1 -useb | iex)
fly auth login
vercel login
```

Two secrets to generate now (keep them in your password manager):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # POLARIS_KEY_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CRON_SECRET
```

`POLARIS_KEY_PEPPER` must never change once merchants have API keys: their
stored key hashes are keyed with it.

Order: **Business first** (the shop needs API keys from its dashboard), then
the app and the landing page (any order), then the shop.

---

## 1. Polaris for Business on Fly.io

Everything runs from the **repository root**: the Docker build context is the
whole pnpm workspace ([`.dockerignore`](../.dockerignore) keeps out installs,
build output, `.env` files and docs).

**1.1 Create the app and its volume.** Use your own app name, and put the same
name in `app = "…"` at the top of [`apps/business/fly.toml`](../apps/business/fly.toml):

```bash
fly apps create polaris-business
fly volumes create polaris_data --app polaris-business --region iad --size 1 --yes
```

Pick the region nearest you (and change `primary_region` in `fly.toml` to
match); the volume and the Machine must be in the same region.

**1.2 The public build arguments.** The dashboard's browser bundle is compiled
with these, so they go in `[build.args]` in `fly.toml` (they are public by
design: every page the browser loads carries them). Fill in:

```toml
[build.args]
  NEXT_PUBLIC_PRIVY_APP_ID = "<your Privy app id>"            # required: sign-in
  NEXT_PUBLIC_PRIVY_CLIENT_ID = ""                            # optional: a Privy app client for this origin
  NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID = ""                     # optional: automatic payouts (privy:setup-payouts)
  NEXT_PUBLIC_DEMO_SHOP_URL = "https://polaris-shop.vercel.app"   # SHOP: "See the demo shop"
  NEXT_PUBLIC_CONSUMER_APP_URL = "https://polaris-app.vercel.app" # APP: where the sample book's links point
```

(Or leave the file alone and pass `--build-arg NEXT_PUBLIC_PRIVY_APP_ID=…` to
`fly deploy`.)

**1.3 The runtime secrets.** Write them to `apps/business/.env.production`,
which git ignores (`git check-ignore apps/business/.env.production` prints the
rule). One `NAME=value` per line, and no comment after a value: `fly secrets
import` would keep it as part of the value.

```bash
PRIVY_APP_ID=<your Privy app id>
PRIVY_APP_SECRET=<your Privy app secret>
POLARIS_KEY_PEPPER=<generated in step 0>
CRON_SECRET=<generated in step 0>
POLARIS_CHECKOUT_ORIGIN=https://polaris-app.vercel.app
POLARIS_PUBLIC_URL=https://polaris-business.fly.dev
RELAYER_MODE=local
RELAYER_LOCAL_ALLOW_TESTNET=1
RELAYER_PRIVATE_KEY=<the dev relayer's key>
```

- `POLARIS_CHECKOUT_ORIGIN` is APP and `POLARIS_PUBLIC_URL` is BUSINESS, with
  no trailing slash.
- The relayer: until the Privy server wallet exists (README, "What only you
  can do", step 4), the testnet deployment's dev relayer
  `0x5e6934725eBCdfcA2d95D991045Fa813B51E2c69` carries payments; it holds the
  operator roles. Its key is `TESTNET_RELAYER_PRIVATE_KEY` in the git-ignored
  repo-root `.env` of the machine that deployed the contracts. If that key is
  gone, give a new address the roles with `RELAYER_ADDRESS=0x… pnpm --filter
  @polarispay/contracts grant-relayer:monad` (signed with the deployer's key)
  and use that address's key instead. Once `pnpm --filter @polaris/business privy:setup-relayer
  -- --apply` has run, replace the three `RELAYER_*` lines with
  `RELAYER_MODE=privy`, `PRIVY_RELAYER_WALLET_ID`, `PRIVY_RELAYER_ADDRESS` and
  `PRIVY_RELAYER_AUTH_KEY`.

Import only the `NAME=value` lines, in one go:

```bash
grep -E '^[A-Z][A-Z0-9_]*=' apps/business/.env.production | fly secrets import --app polaris-business
```

```powershell
Get-Content apps/business/.env.production | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=' } | fly secrets import --app polaris-business
```

`fly secrets list --app polaris-business` shows the names (never the values).

The optional ones (the CRE underwriting trigger, Envio, automatic payouts,
merchant activation, a faster log source) are in the
[table below](#polaris-for-business-apps-business); add them the same way.
`fly.toml` already sets `POLARIS_TRUSTED_PROXIES=1` (Fly's proxy), and the
image sets `POLARIS_DB_URL=sqlite:/data/polaris.db`, `POLARIS_WORKERS=1` and
`POLARIS_DEPLOYMENT=monad-testnet`.

**1.4 Deploy** (from the repository root):

```bash
fly deploy . --config apps/business/fly.toml --dockerfile apps/business/Dockerfile --ha=false
```

The `.` makes the repository root the build context, and `--ha=false` keeps
it to the one Machine the volume belongs to (Fly would otherwise start a
spare). The build installs only `@polaris/business` and the workspace packages it
imports, runs `next build` with Next's standalone output, and ships a
Node 22 image with no toolchain; the server runs as the unprivileged `node`
user (the entrypoint only hands the volume to that user). Fly waits for
`/api/health/ready` before it routes traffic: the environment parses, the
deployment record is there, the SQLite file on `/data` is writable, and the
background loops (chain sync, webhook retries, payouts, the underwriting
queue) are running.

**1.5 Check it:**

```bash
curl https://polaris-business.fly.dev/api/health/ready
curl -H "Authorization: Bearer $CRON_SECRET" https://polaris-business.fly.dev/api/health   # lists what production is missing
fly logs --app polaris-business
```

Keep it at **exactly one Machine** (`fly scale count 1 --app polaris-business`):
`fly.toml` turns auto-stop off and never starts a second one. The volume is
snapshotted daily by Fly (`fly volumes snapshots list <volume id>`).

A merchant who signs up registers on `MerchantRegistry` by their own signature,
relayed (the dev relayer holds the registry's operator role on testnet). Pay in
4 at a new merchant also needs activation, which is off until
`REGISTRY_ACTIVATOR=privy` is set up (`apps/business/README.md`, "Merchants,
onboarding and payouts"); Pay now works at once.

### 1b. Or Railway

1. New project → **Deploy from GitHub repo** → this repository.
2. The service's **Settings**: Root Directory `/` (the repository root, the
   build context); **Config-as-code** file `apps/business/railway.json` (it
   selects `apps/business/Dockerfile`, the readiness check and one replica).
3. **Volume**: add one to the service, mount path `/data`.
4. **Variables**: everything in 1.2 and 1.3, plus `PORT=3100` and
   `POLARIS_TRUSTED_PROXIES=1`. Railway passes variables to the build as
   build arguments, so the `NEXT_PUBLIC_*` ones reach `next build`.
5. **Networking**: generate a domain on port 3100. Never scale past one replica.

---

## 2. The Polaris app on Vercel

1. Vercel dashboard → **Add New… → Project** → import this repository.
2. **Root Directory**: `apps/app`. Framework: Next.js (detected). The install
   and build commands come from [`apps/app/vercel.json`](../apps/app/vercel.json):
   pnpm 10 installs only `@polaris/app` and its workspace packages, then
   `next build`.
3. **Settings → General → Node.js Version**: 22.x.
4. **Environment Variables** (Production), all compiled into the bundle, so a
   change needs a redeploy:

   ```
   NEXT_PUBLIC_POLARIS_API_URL=https://polaris-business.fly.dev
   NEXT_PUBLIC_CHAIN_ID=10143
   NEXT_PUBLIC_RP_ID=polarispay.app
   NEXT_PUBLIC_PRIVY_APP_ID=<the dashboard's Privy app id>
   ```

   `NEXT_PUBLIC_POLARIS_API_URL` is BUSINESS. Set `NEXT_PUBLIC_RP_ID` only
   with your own domain (step 0). `NEXT_PUBLIC_PRIVY_APP_ID` is optional: it
   adds "Continue with email" (use the dashboard's Privy app). Vercel's
   **Import .env** accepts these lines pasted as they are.

   Never set `NEXT_PUBLIC_DEV_SIGNER` (a production build blanks it anyway),
   `NEXT_PUBLIC_DEV_SIGNER_PERSIST`, `NEXT_PUBLIC_LOCAL_DEMO`,
   `NEXT_PUBLIC_LOCAL_FAUCET_URL` or `POLARIS_ALLOW_DEV_SIGNER_BUILD`.
5. **Deploy**. Then `https://<APP>/api/health` shows what the build has.

With the CLI instead of the dashboard, per variable:

```bash
vercel link --repo                       # once, at the repository root: links each app folder to its project
printf '%s' "https://polaris-business.fly.dev" | vercel env add NEXT_PUBLIC_POLARIS_API_URL production --cwd apps/app
vercel deploy --prod --cwd apps/app
```

If an Android build (Trusted Web Activity) is added, its Digital Asset Links
file is served from `apps/app/public/.well-known/assetlinks.json`;
`vercel.json` gives it `Content-Type: application/json`, and the deploy check
verifies it (`--android-package`).

---

## 3. The landing page on Vercel

Same as step 2 with **Root Directory** `apps/landing`. Its two variables are
optional (unset, the buttons stay on the page as anchors):

```
NEXT_PUBLIC_APP_URL=https://polaris-app.vercel.app
NEXT_PUBLIC_BUSINESS_URL=https://polaris-business.fly.dev
```

APP is where "Get the app" leads; BUSINESS is "Log in" and "Start accepting".

`next build` downloads Inter Tight from Google Fonts, which Vercel's builders can reach.

---

## 4. Halcyon on Vercel, with Upstash Redis

The shop pays through Polaris for Business as a merchant, so it needs that
merchant's keys first.

**4.1 In the deployed dashboard** (`https://<BUSINESS>/login`): sign in, name
the business (the payout account registers itself), then in **Developers**:

- create an API key pair: `sk_test_…` (secret) and `pk_test_…` (publishable);
- add a webhook endpoint `https://<SHOP>/api/webhooks/polaris` and copy its
  signing secret `whsec_…`;
- note the payout address (Settings), the shop's `POLARIS_MERCHANT_ADDRESS`.

**4.2 Create the project**: as in step 2 with **Root Directory** `apps/shop`.
Its build builds `polarispay-sdk` first and then proves no dev mock shipped
(`scripts/assert-no-dev-mock.mjs`).

**4.3 Connect Redis**: the project's **Storage** tab → **Create Database** →
**Upstash for Redis** (free plan) → connect it to this project. That adds
`KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the shop keeps its orders there
(one record per Vercel environment: production and previews never share one).
Without it every function keeps its own orders in memory, and a paid order can
stay "awaiting payment" forever; the deploy check fails on it.

**4.4 Environment Variables** (Production):

```
POLARIS_API_BASE=https://polaris-business.fly.dev
POLARIS_SECRET_KEY=sk_test_…
POLARIS_WEBHOOK_SECRET=whsec_…
NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY=pk_test_…
NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN=https://polaris-app.vercel.app
POLARIS_MERCHANT_ADDRESS=0x…
SHOP_URL=https://polaris-shop.vercel.app
```

`POLARIS_API_BASE` is BUSINESS, `NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN` is APP
and `SHOP_URL` is SHOP; `POLARIS_MERCHANT_ADDRESS` is the payout address from
4.1. Mark `POLARIS_SECRET_KEY` and `POLARIS_WEBHOOK_SECRET` **Sensitive**.

**4.5 Deploy.** `https://<SHOP>/api/health` shows how it is wired (never a secret).

---

## 5. Privy: allowed domains

In the Privy dashboard, for the app whose id you used:

1. **Configuration → App settings → Domains** (allowed origins): add
   `https://<BUSINESS>` (the dashboard's sign-in) and `https://<APP>` (the
   app's "Continue with email", if you set `NEXT_PUBLIC_PRIVY_APP_ID` there).
   Add your custom domains too, if you use them.
2. **Login methods**: email on (Google too, if you want it; then add both
   origins to its allowed redirect URLs as well).
3. If you created **app clients** (`NEXT_PUBLIC_PRIVY_CLIENT_ID`), give each
   one its origin.

Privy refuses sign-in from an origin that isn't listed, so do this before the
first sign-in in 4.1.

---

## 6. Custom domains

Optional, and best decided in step 0 (the Face ID domain):

```bash
fly certs add business.polarispay.app --app polaris-business   # then the DNS record it prints
vercel domains add app.polarispay.app --cwd apps/app            # or the project's Settings → Domains
```

After moving any app to a new domain, update every variable that names it
(the table in [step 8](#8-every-environment-variable) says which), redeploy
the apps whose `NEXT_PUBLIC_*` changed, add the domain in Privy, and run the
deploy check again.

---

## 7. Run the deploy check

From the repository root, with the four URLs:

```bash
node scripts/deploy-check.mjs \
  --app https://polaris-app.vercel.app \
  --business https://polaris-business.fly.dev \
  --landing https://polaris-landing.vercel.app \
  --shop https://polaris-shop.vercel.app \
  --cron-secret "$CRON_SECRET"
```

(`pnpm deploy:check --app …` is the same.) It only reads: `GET` and `OPTIONS`
requests, plus two it expects refused without credentials (an unsigned `POST`
to the shop's webhook, a `PUT` to the API's scheduler route), and this
repository's deployment record and SDK presets. Each line is `PASS`, `WARN`,
`FAIL` or `SKIP`; the exit status is 1 when anything failed. `--json` prints
the results as JSON; `--android-package <name>` requires the app's
`/.well-known/assetlinks.json` to name that package.

| Target | What it checks |
|---|---|
| All four | `/` answers over HTTPS; `http://` redirects to HTTPS; HSTS; `nosniff` and no `X-Powered-By` |
| The app | `/api/health`: a production build with no dev signer and no local demo switches; `NEXT_PUBLIC_POLARIS_API_URL` is BUSINESS; chain 10143; `NEXT_PUBLIC_RP_ID` is one the host may use (warns when unset); Privy's email option; pinned contracts are the deployment's; the app refuses to be framed; the web app manifest; `assetlinks.json` if served (or required) |
| Business | `/api/health`: chain 10143 and all ten contracts equal to the deployment record; the relayer (fails when off, warns on the dev relayer); `POLARIS_CHECKOUT_ORIGIN` is APP; `POLARIS_PUBLIC_URL` is BUSINESS; nothing production needs is missing (listed with `--cron-secret`); a production build with no mock or local session; Privy configured, the same app in the bundle and on the server; "See the demo shop" is SHOP. `/api/health/ready`: ready, the store on a disk (fails in memory), the background loops running, the chain sync recent. `/api/public/network` answers. CORS: APP may call `/api/public` and `/api/relay`, another origin may not, SHOP may call `/api/v1/relay/payments`. `/api/me` and `/api/cron/tick` refuse requests without credentials |
| The shop | `/api/health`: a production build with no dev mock; payments on, through BUSINESS, opening the checkout at APP; `SHOP_URL` is SHOP; orders in Redis on Vercel (fails otherwise); the dev mock's routes are gone; the webhook refuses an unsigned event |
| The landing page | It renders and links to APP and BUSINESS |
| SDK presets | `polarispay-sdk`'s `MONAD_TESTNET` preset (`packages/sdk/src/deployments.ts`) equals the deployment record, and equals what BUSINESS serves at `/api/public/network`, so a shop on the SDK and the hosted checkout sign for the same contracts |

Expected warnings on the testnet setup above: the dev relayer (until the Privy
relayer), and `NEXT_PUBLIC_RP_ID` unset if you stay on `vercel.app`.

---

## 8. Every environment variable

"Build" means compiled in when the app is built (set it before deploying; a
change needs a new build). "Runtime" means read by the server when it runs.
The `.env.example` in each app describes every variable in full.

### The Polaris app (`apps/app`, Vercel)

| Variable | | When | Value |
|---|---|---|---|
| `NEXT_PUBLIC_POLARIS_API_URL` | **required** | build | BUSINESS. Unset, the app is the offline demo ("Demo mode · sample data") |
| `NEXT_PUBLIC_CHAIN_ID` | **required** | build | `10143` |
| `NEXT_PUBLIC_RP_ID` | advised | build | The Face ID domain (step 0). Unset: the app's own host |
| `NEXT_PUBLIC_PRIVY_APP_ID` | optional | build | The dashboard's Privy app: shows "Continue with email" |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | optional | build | A Privy app client for this origin |
| `NEXT_PUBLIC_RPC_URL` | optional | build | Default: Monad testnet's public RPC |
| `NEXT_PUBLIC_EXPLORER_URL` | optional | build | Default `https://testnet.monadvision.com` |
| `NEXT_PUBLIC_AUSD_ADDRESS`, `NEXT_PUBLIC_PAYMENTS_ADDRESS`, `NEXT_PUBLIC_CHECKOUT_ADDRESS`, `NEXT_PUBLIC_SEND_ADDRESS`, `NEXT_PUBLIC_LOAN_ENGINE_ADDRESS` | optional | build | Pins; unset, they come from BUSINESS's deployment record (the app refuses to sign if a pin disagrees) |
| `FX_RPC_MONAD`, `FX_RPC_ETHEREUM`, `FX_RPC_POLYGON`, `FX_RPC_BASE` | optional | runtime | RPCs for the Chainlink FX rates; defaults are public |
| `NEXT_PUBLIC_BUILD_TARGET`, `NEXT_PUBLIC_PRIVY_ANDROID_CLIENT_ID` | not on the web | build | The Android build only |
| `NEXT_PUBLIC_DEV_SIGNER`, `NEXT_PUBLIC_DEV_SIGNER_PERSIST`, `NEXT_PUBLIC_LOCAL_DEMO`, `NEXT_PUBLIC_LOCAL_FAUCET_URL`, `POLARIS_ALLOW_DEV_SIGNER_BUILD` | **never** | | `pnpm demo:local` only |

### The landing page (`apps/landing`, Vercel)

| Variable | | When | Value |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | optional | build | APP ("Get the app") |
| `NEXT_PUBLIC_BUSINESS_URL` | optional | build | BUSINESS ("Log in", "Start accepting") |

### Halcyon (`apps/shop`, Vercel)

| Variable | | When | Value |
|---|---|---|---|
| `POLARIS_API_BASE` | **required** | runtime | BUSINESS |
| `POLARIS_SECRET_KEY` | **required**, secret | runtime | `sk_test_…` from the dashboard |
| `POLARIS_WEBHOOK_SECRET` | **required**, secret | runtime | `whsec_…` of the endpoint `https://<SHOP>/api/webhooks/polaris` |
| `NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY` | **required** | runtime | `pk_test_…` |
| `NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN` | **required** | runtime | APP |
| `POLARIS_MERCHANT_ADDRESS` | **required** | runtime | The merchant's payout address (direct wallet payments pay it) |
| `SHOP_URL` | **required** | runtime | SHOP (success and cancel URLs) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | **required on Vercel**, secret | runtime | Set by the Upstash integration (or `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) |
| `SHOP_ORDER_STORE` | optional | runtime | `memory`, `file` or `redis`; unset: redis when the pair above is set, else a file |
| `SHOP_ORDER_STORE_KEY` | optional | runtime | Default `halcyon:<VERCEL_ENV>:orders:v1` |
| `POLARIS_RELAY_URL` | optional | runtime | Default `<POLARIS_API_BASE>/api/v1/relay/payments` |
| `SHOP_DATA_DIR`, `TRUST_PROXY` | not on Vercel | runtime | A long-lived host's order file; proxy headers (SHOP_URL makes them unnecessary) |

### Polaris for Business (`apps/business`, Fly.io or Railway)

| Variable | | When | Value |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | **required** | build (`[build.args]`) | The Privy app |
| `NEXT_PUBLIC_DEMO_SHOP_URL` | advised | build | SHOP ("See the demo shop"; disabled without it) |
| `NEXT_PUBLIC_CONSUMER_APP_URL` | optional | build | APP, for the sample book's links |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID`, `NEXT_PUBLIC_MONAD_TESTNET_RPC`, `NEXT_PUBLIC_AUSD_ADDRESS`, `NEXT_PUBLIC_AUSD_EIP712_NAME`, `NEXT_PUBLIC_AUSD_EIP712_VERSION` | optional | build | See `apps/business/.env.example` |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | **required**, secret | runtime | Server-side sign-in verification (the same app as the build argument) |
| `POLARIS_KEY_PEPPER` | **required**, secret | runtime | 32 random bytes, never changed afterwards |
| `CRON_SECRET` | **required**, secret | runtime | Opens `/api/cron/tick` and the health route's problem list |
| `POLARIS_CHECKOUT_ORIGIN` | **required** | runtime | APP: payment links and sessions send buyers to `<APP>/pay/<id>`; also allowed by CORS |
| `POLARIS_PUBLIC_URL` | **required** | runtime | BUSINESS: signed into each merchant's registry metadata |
| `POLARIS_TRUSTED_PROXIES` | **required** | runtime | `1` on Fly and Railway (`fly.toml` sets it) |
| `RELAYER_MODE` | **required** | runtime | `local` with `RELAYER_LOCAL_ALLOW_TESTNET=1` and `RELAYER_PRIVATE_KEY` (the dev relayer, secret) until the Privy relayer exists; then `privy` with `PRIVY_RELAYER_WALLET_ID`, `PRIVY_RELAYER_ADDRESS`, `PRIVY_RELAYER_AUTH_KEY` |
| `POLARIS_DB_URL` | set by the image | runtime | `sqlite:/data/polaris.db` (the volume) |
| `POLARIS_WORKERS` | set by the image | runtime | `1`: the background loops run in the server |
| `POLARIS_DEPLOYMENT` | set by the image | runtime | `monad-testnet` (the record in the image) |
| `POLARIS_APP_ORIGINS` | optional | runtime | More browser origins for `/api/relay` and `/api/public` (APP is always allowed) |
| `POLARIS_RPC_URL`, `POLARIS_EXPLORER_URL` | optional | runtime | Default: Monad testnet's public RPC, MonadVision |
| `POLARIS_LOGS_RPC_URL` | optional | runtime | Envio HyperRPC for the chain sync's logs (10,000 blocks a request instead of 100) |
| `POLARIS_SYNC_FROM_BLOCK` | optional | runtime | Where the chain sync starts on an empty store (default: the current block; `66288112` for the deployment's whole history) |
| `POLARIS_INDEXER_URL`, `POLARIS_INDEXER_TOKEN` | optional | runtime | The Envio indexer's GraphQL endpoint (README, step 5) |
| `CRE_UNDERWRITING_TRIGGER_URL`, `POLARIS_CRE_CALLBACK_SECRET` | optional | runtime | The CRE underwriting trigger and its callback secret; unset, "Raise your limit" answers that reviews are off |
| `REGISTRY_ACTIVATOR`, `PRIVY_REGISTRY_*`, `MERCHANT_ACTIVATION_CAP_USD`, `MERCHANT_ACTIVATION_MIN_PAYMENTS` | optional | runtime | Automatic Pay in 4 activation of new merchants |
| `PRIVY_PAYOUT_SIGNER_ID`, `PRIVY_PAYOUT_SIGNER_KEY`, `PRIVY_ADMIN_QUORUM_ID` | optional (together) | runtime | Automatic payouts |
| `UNDERWRITING_GATEWAY_URL`, `UNDERWRITING_API_TOKEN` | optional | runtime | The underwriting gateway, if deployed |
| `PAY_IN_4_INTERVAL_SECONDS`, `PAY_IN_4_MIN_CENTS`, `PAY_IN_4_MAX_CENTS`, `POLARIS_SESSION_TTL_SECONDS` | optional | runtime | Checkout terms (weekly instalments by default) |
| `RELAYER_MIN_TRANSFER_UNITS`, `RELAYER_MAX_GAS`, `RELAYER_MAX_FEE_GWEI`, `RELAYER_RECEIPT_TIMEOUT_MS` | optional | runtime | The relayer's own limits |
| `POLARIS_DEV_MOCK_SESSION`, `POLARIS_LOCAL_SESSION_*`, `NEXT_PUBLIC_POLARIS_LOCAL_SESSION*`, `POLARIS_DISABLE_PRIVY`, `POLARIS_WEBHOOK_ALLOW_PRIVATE` | **never** | | Development and `pnpm demo:local` only (production ignores or refuses them) |

---

## 9. Rehearse it locally

The same production builds, on this machine, before anything is public
(ports are examples):

```bash
# Polaris for Business, the image
docker build -f apps/business/Dockerfile -t polaris-business \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID=<id> --build-arg NEXT_PUBLIC_DEMO_SHOP_URL=http://localhost:3933 .
docker run --rm -p 3931:3100 -v polaris-data:/data \
  -e POLARIS_TRUSTED_PROXIES=1 -e POLARIS_CHECKOUT_ORIGIN=http://localhost:3930 \
  -e POLARIS_PUBLIC_URL=http://localhost:3931 -e POLARIS_KEY_PEPPER=local -e CRON_SECRET=local \
  -e PRIVY_APP_ID=<id> -e PRIVY_APP_SECRET=<secret> polaris-business

# The app, the landing page and the shop: next build && next start
NEXT_PUBLIC_POLARIS_API_URL=http://localhost:3931 NEXT_PUBLIC_CHAIN_ID=10143 pnpm --filter @polaris/app build
pnpm --filter @polaris/app exec next start -p 3930
NEXT_PUBLIC_APP_URL=http://localhost:3930 NEXT_PUBLIC_BUSINESS_URL=http://localhost:3931 pnpm --filter @polaris/landing build
pnpm --filter @polaris/landing exec next start -p 3932
pnpm --filter @polaris/shop build
POLARIS_API_BASE=http://localhost:3931 SHOP_URL=http://localhost:3933 … pnpm --filter @polaris/shop exec next start -p 3933

node scripts/deploy-check.mjs --allow-http \
  --app http://localhost:3930 --business http://localhost:3931 \
  --landing http://localhost:3932 --shop http://localhost:3933
```

Over plain HTTP the check warns on HTTPS (that part only a public deployment
can pass). With `RELAYER_MODE` left off locally it fails the relayer, as it
should: nothing could be paid.

---

## 10. Troubleshooting

| Symptom | Cause |
|---|---|
| `/login` says "Sign-in is unavailable right now" | The image was built without `NEXT_PUBLIC_PRIVY_APP_ID` (a build argument, step 1.2: set it and deploy again) |
| `fly deploy` never gets healthy | `curl …/api/health/ready`: `store` not writable (the volume isn't mounted at `/data`: `[[mounts]]` and `fly volumes list`), `config` (a variable doesn't parse: the message says which), or `workers` (see `fly logs`) |
| Sign-in fails with an origin error | The origin isn't in Privy's allowed domains (step 5) |
| "Continue with Face ID" fails at once | `NEXT_PUBLIC_RP_ID` isn't the app's host or a domain above it (the deploy check says so) |
| The checkout can't load a payment link | The app's `NEXT_PUBLIC_POLARIS_API_URL` or Business's `POLARIS_CHECKOUT_ORIGIN` names another host: CORS refuses (deploy check: `cors`) |
| A shop order stays "awaiting payment" | The webhook endpoint or `whsec_…` doesn't match (dashboard → Developers → the delivery log), or the shop has no Redis (deploy check: `order-store`) |
| Payments fail with "relayer unavailable" | `RELAYER_MODE` is off, or the dev relayer's key isn't the one with the testnet roles |
| Links point at `localhost:3000` | `POLARIS_CHECKOUT_ORIGIN` isn't set on Business |
