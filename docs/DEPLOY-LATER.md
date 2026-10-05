# Deploy later: the runbook for "go"

Everything here waits for the team's go. Until then, work stays on the local
chain: no Monad testnet transactions and no new hosting deploys. Each block is
independent; do them in this order, and stop after any block. From "go" to
live is under an hour for blocks 1 to 3; block 4 (real AUSD) is a half-day,
because the evidence is redone.

**Who does what.** The team sets every secret (🔑); Claude runs the commands
once told to. Never paste a secret into chat or commit it: each one goes into
the git-ignored file or the platform variable named below.

## 0. Where things stand (6 Oct 2026)

| | State |
|---|---|
| Contracts | 12 live on Monad testnet (chain 10143), the record in [`packages/contracts/deployments/monad-testnet.json`](../packages/contracts/deployments/monad-testnet.json); 65 of 65 read back; 14 sources verified on Monadscan |
| Deployer | `0x6Df4a0b84BD608123D1f3412709AcaC69523c115`, key `DEPLOYER_PRIVATE_KEY` in the git-ignored repo-root `.env`; about 0.30 MON on 6 Oct |
| Relayer | Privy server wallet `0x8366916019bc5452e62A0D36418ABebB45396aE2` (policy-locked), keys in `apps/business/.env.local` / `.env.privy` and on Railway |
| CRE transmitter | `0xBBb420B7e4b0263d053e00bFD363eD7cF21e2EA6`, `CRE_ETH_PRIVATE_KEY` in `workflows/.env`; simulation forwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| Hosting | Polaris for Business on Railway (https://business-production-c0b6.up.railway.app), the app (https://polaris-monad-app.vercel.app) and the landing page (https://polaris-monad-landing.vercel.app) on Vercel; `pnpm deploy:check` passes for those three. The shop is not deployed |
| Stablecoin | A labelled MockAUSD. Real AUSD is rehearsed on a local fork (block 4) |
| PolarisSplit | Not on testnet (block 2) |
| Envio | Indexer built and tested; not deployed (block 5) |

Keep the Vercel projects deploying from a clean export, never the working
tree: the Vercel CLI uploads git-ignored files such as `.env` and the Android
keystore.

```bash
rm -rf /tmp/polaris-export && mkdir /tmp/polaris-export && git archive HEAD | tar -x -C /tmp/polaris-export
cd /tmp/polaris-export && VERCEL_ORG_ID=team_gwapD8j8P5T3NxIU746NjNxe VERCEL_PROJECT_ID=<project id> vercel deploy --prod --yes
```

Project ids: app `prj_rZfPkBDv1rJ4g5D8RqeLmVIAHi9K`, landing
`prj_iq33SV1xATn63kc42gJ89bZswQ9r`, shop `prj_QACjDoAqIAOhnWamzDhJSyOfIJE9`.
Business redeploys with `railway up --detach` from the repository root (the
folder is linked to Railway project `polaris-business`; `.gitignore` keeps
`.env` files out of the upload, and `.dockerignore` keeps them out of the
image).

## 1. Finish hosting (≈ 20 min) 🔑 then Claude

1. 🔑 **Privy dashboard → Domains:** add the Business and app URLs above
   (and the custom domains if block 6 is done). Google login on.
2. 🔑 **Sign in** at `<BUSINESS>/login`, name the business; in
   **Developers** create an API key pair and a webhook endpoint
   `https://polaris-monad-shop.vercel.app/api/webhooks/polaris`. Write the
   four values to `apps/shop/.env.production` (git-ignored):
   `POLARIS_SECRET_KEY`, `NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY`,
   `POLARIS_WEBHOOK_SECRET`, `POLARIS_MERCHANT_ADDRESS` (the payout address,
   Settings).
3. 🔑 **Upstash Redis:** Vercel → project `polaris-monad-shop` → Storage →
   Upstash for Redis (free) → connect (adds `KV_REST_API_URL`,
   `KV_REST_API_TOKEN`).
4. Claude: load step 2's values into the shop project (Sensitive), deploy the
   shop from a clean export, then:

   ```bash
   node scripts/deploy-check.mjs --app https://polaris-monad-app.vercel.app \
     --business https://business-production-c0b6.up.railway.app \
     --landing https://polaris-monad-landing.vercel.app \
     --shop https://polaris-monad-shop.vercel.app \
     --cron-secret "$(grep '^CRON_SECRET=' apps/business/.env.production | cut -d= -f2-)"
   ```

   Expect every line PASS except the `rp-id` warning until block 6.

## 2. PolarisSplit on testnet (≈ 15 min) Claude, on go

One transaction, about 1.89M gas (measured locally); nothing else moves. The
script refuses mainnet, a record that already has a split, uncommitted
`contracts/`, and a deployer short of MON.

```bash
pnpm --filter @polarispay/contracts deploy-split:monad
pnpm --filter @polarispay/contracts check:deployment:monad
ETHERSCAN_API_KEY=… pnpm --filter @polarispay/contracts verify:monad   # the key is in the root .env
```

Then: commit the updated record and `monad-testnet.transactions.json`; add
the split to the SDK presets
(`pnpm --filter polarispay-sdk gen:deployments`) and the indexer
(`pnpm --filter polaris-indexer generate`); redeploy Business
(`railway up --detach`; the image carries the record) so
`/api/public/network` serves the split address and the app shows Split; run
`pnpm demo:e2e:split` locally once more; update the README's deployment
table, `docs/submission/bounty-fields.md` (Agora), and `pnpm docs:check`.

## 3. The demo video (≈ 2 h) 🔑

Follow [`submission/video-script.md`](submission/video-script.md) (nine
scenes, ≤ 3:00) and, if the portal asks for it,
[`submission/pitch-script.md`](submission/pitch-script.md) (≤ 2:00). Shot list:

| # | Shot | Where |
|---|---|---|
| 1 | Halcyon product → Polaris checkout popup | local stack (`pnpm demo:local`), or the hosted shop after block 1 |
| 2 | Face ID sign-up, Pay now, the receipt | an iPhone on the hosted app (after block 6), else local with the dev-signer caption |
| 3 | Pay in 4: Raise your limit (CRE underwriting), the plan opening | local |
| 4 | The merchant dashboard: payments, plans, payouts | hosted Business or local |
| 5 | Send by link → claim, the local-currency line | local or hosted |
| 6 | Guardian pause and resume ("Threshold raised for demo") | local |
| 7 | A sealed receipt: locked, then opened with Face ID | local |
| 8 | Monad testnet: the Privy relayer's transactions, CRE reports, verified source on Monadscan | the explorer |
| 9 | End card: one-liner, app URL, repository | — |

Then fill `<VIDEO_URL>` and the `[m:ss]` timestamps in
`docs/submission/bounty-fields.md`, run `pnpm docs:diffstat` and
`pnpm docs:check`.

## 4. Real AUSD on testnet (≈ half a day) Claude, on go

A full redeploy with Agora's AUSD (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`,
EIP-712 "Agora Dollar" v1). Every address moves. Rehearse first on a local
fork; it passed 14 of 14 on 6 Oct ([contracts README](../packages/contracts/README.md)):

```bash
anvil --port 18555 --fork-url https://testnet-rpc.monad.xyz --chain-id 10143 --prune-history 300 &
pnpm --filter @polarispay/contracts deploy:fork
pnpm --filter @polarispay/contracts fund-pool:fork
pnpm --filter @polarispay/contracts check:deployment:fork
pnpm --filter @polarispay/contracts fork:smoke
```

**MON:** the 12 contracts used about 27M gas on 28 Sep, plus PolarisSplit
(1.9M) and the role grants. Monad charges the gas **limit**, so
`deploy:monad` prints its own estimate and refuses to start short of it;
top up the deployer from faucet.monad.xyz if the estimate exceeds its
balance.

**AUSD:** the deployer asks Agora's faucet
(`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`, `requestFunds(address)`) for
10,000 AUSD per call, 60 s global cooldown, 100k per address; that is the
credit pool's seed.

```bash
AUSD_MODE=ausd pnpm --filter @polarispay/contracts deploy:monad
pnpm --filter @polarispay/contracts fund-pool:monad
RELAYER_ADDRESS=0x8366916019bc5452e62A0D36418ABebB45396aE2 pnpm --filter @polarispay/contracts grant-relayer:monad
pnpm --filter @polarispay/contracts check:deployment:monad
pnpm --filter @polarispay/contracts verify:monad
```

Then update everything that pins an address: the SDK presets
(`pnpm --filter polarispay-sdk gen:deployments`),
the indexer (`pnpm --filter polaris-indexer generate`, start block),
the CRE configs (`pnpm --filter @polaris/cre-workflows configure staging`), the
Privy relayer policy if it names contract addresses
(`privy:setup-relayer`, which needs the admin key: 🔑 the team writes
`apps/business/.privy-admin.key` for that run only and deletes it after),
`apps/app/.env.example`, and the tests that pin addresses
(`apps/app/test/build-info.test.ts`,
`apps/business/test/verify-testnet-results.test.ts`,
`packages/contracts/test/metropolis/Verify.test.js`). Redeploy Business and
the app. Re-run the evidence: `pnpm --filter @polaris/business smoke:testnet`
(the 14-action gasless run), the three CRE simulations with `--broadcast`,
and rewrite the README's deployment section and the submission kit with the
new hashes. `pnpm docs:check` must pass.

## 5. Envio indexer (≈ 30 min) 🔑 then Claude

🔑 `ENVIO_API_TOKEN` (envio.dev/app/api-tokens) in
`packages/indexer/.env`: HyperSync on Monad testnet refuses requests without
one. Then either Envio Cloud (🔑 log in, install its GitHub app, deploy
`packages/indexer`; the free plan deletes a deployment after 30 days, so
deploy after ~5 Oct) or self-host beside Business. Then Claude sets
`POLARIS_INDEXER_URL` on Railway, `candidates.indexerUrl` in the CRE configs,
`<ENVIO_GRAPHQL_URL>` in the kit, and checks that webhooks and collection
candidates come from it.

## 6. The Face ID domain (≈ 20 min) 🔑 then Claude

🔑 Move `polarispay.app` onto the Vercel team that hosts the apps. Then:
`app.polarispay.app` → the app with `NEXT_PUBLIC_RP_ID=polarispay.app`;
`polarispay.app` → landing; `shop.polarispay.app` → shop. Update
`POLARIS_CHECKOUT_ORIGIN` (Railway), `NEXT_PUBLIC_CONSUMER_APP_URL` and
`NEXT_PUBLIC_DEMO_SHOP_URL` (Railway build variables), the landing page's and
shop's URL variables; redeploy all four; add the new origins in Privy; run the
deploy check. Face ID accounts made on `vercel.app` before this stay there.

## 7. After any block

`pnpm deploy:check` (hosting), `check:deployment:monad` (contracts),
`pnpm docs:check`, and update [`TODO.md`](TODO.md) and
[`SPONSOR-GAP.md`](SPONSOR-GAP.md).
