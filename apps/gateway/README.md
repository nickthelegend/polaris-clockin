# @polarispay/gateway

Serves the Polaris underwriting API: a buyer's score, credit line, Pay in 4
decision and plain-language reasons, from Nansen, Zerion, Etherscan and RPC
data. The logic lives in [`@polarispay/underwriting`](../../packages/underwriting/README.md);
this app is the process that serves it.

## Run it (one command)

```bash
pnpm install && pnpm --filter @polarispay/gateway start
```

It listens on `http://127.0.0.1:3510`. With no keys every provider reads the
synthesized fixtures in `packages/underwriting/fixtures`; the startup log and
every response (`dataMode: "fixture"`) say so. To go live, copy
[`.env.example`](.env.example) to `.env` and add `NANSEN_API_KEY`,
`ZERION_API_KEY` and `ETHERSCAN_API_KEY`. Set `UNDERWRITING_API_TOKEN` before
it listens anywhere but localhost.

```bash
curl -s localhost:3510/health
curl -s localhost:3510/v1/underwrite -H 'content-type: application/json' \
  -d '{"account":"0xacc0000000000000000000000000000000000001","purchase":"200.00"}'
```

## Routes

`GET /health`, `POST /v1/underwrite`, `POST /v1/explain` and
`GET /v1/link-message`; see the package README for bodies and responses.

## Score explanations

[`src/score.ts`](src/score.ts) keeps the gateway's `explain()`: facts in,
lines like `You've used this account for 2 years · +48` out. It no longer
carries weights of its own; it calls the package's mirror of
`ScoreManager.scoreFromFacts`, which the contract suite holds to the
bytecode.

```bash
pnpm --filter @polarispay/gateway test
```
