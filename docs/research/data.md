# Underwriting data: Nansen, Zerion and plain RPC

Researched 26 Sep 2026 for `docs/plan.md` §3.3 (the `underwrite` CRE workflow),
§3.4 (Nansen stack-on), §5.2 item 6 (`ScoreManager.underwrite`) and §5.5
(cold-start credit, *Bring your history*).

The target is the struct the DON attests and `ScoreManager` scores on chain:

```solidity
struct Facts {
    uint32 walletAgeDays;
    uint32 txCount;
    uint64 stableBalance;   // 6 decimals
    uint32 defiTenureDays;
    uint16 priorLiquidations;
    uint16 relatedWallets;
    bool   exchangeFunded;
    uint64 observedAt;
}
```

**Sources.** Everything below comes from one of these:

- Nansen's OpenAPI spec (`https://api.nansen.ai/openapi.json`, fetched today) and the raw
  markdown of docs.nansen.ai.
- Zerion's OpenAPI spec (`https://developers.zerion.io/openapi-v1.yaml`) and the raw
  markdown of developers.zerion.io.
- The npm tarballs listed in §1.
- Keyless requests I sent to the live APIs. They return the `402` payment challenge, which
  carries the real price, but no data.
- Read-only JSON-RPC calls to Monad's public RPC.

I had no Nansen or Zerion API key, and I did not pay for any x402 call. So **no response
body below is a real one.** Every response shape comes from the OpenAPI schema, and values
in `<angle brackets>` are placeholders. Anything I could not check is marked
**UNVERIFIED**.

---

## 0. The short version

1. **Nansen has no Monad testnet.** No chain enum on any endpoint has a testnet value, and
   Nansen's x402 challenge offers payment on `eip155:143` (mainnet). Nansen can only score
   a *linked history wallet* (§5.5), never the buyer's new Mera account on 10143.
2. **The Mera account is gasless, so its nonce is always 0.** The relayer sends every
   transaction (plan §5.3). The account never receives native gas either, so it has no
   "first funder". Nonce-based `txCount` and funder-based sybil checks mean nothing for it.
   Its facts have to come from token transfers (Zerion with `X-Env: testnet`, or an
   Etherscan V2 `tokentx` call on 10143) and from `balanceOf`.
3. **Nansen costs (API key):**
   - `first-funder`, `related-wallets`, `transactions`, `pnl-summary`, `current-balance`:
     **1 credit** each.
   - `counterparties`: **5** credits.
   - `labels`: **100** credits, and **API key only** (no x402).

   **x402 prices, read from the live 402 challenges:** $0.01 for the 1-credit endpoints and
   $0.05 for `counterparties`. You can pay in USDC on Base, on **Monad mainnet**
   (`0x7547…b603`) or on Solana.
4. **Nansen's free plan is small.** It gives 100 one-time trial credits. After that, a daily
   top-up restores the balance to **10** credits; it does not add 10. Our recipe costs
   **2 credits per linked-wallet underwriting**, so that is about 50 underwritings, then
   about 5 a day.
5. **CRE multiplies the cost unless we cache.** By default every DON node runs every HTTP
   request, so 2 credits become 2 × N. Set `cacheSettings` (max age 10 min) on every
   Nansen and Zerion call so that one node fetches and the others reuse the response.
   `cre workflow simulate` runs locally and pays once.
6. **CRE's quotas shape the recipe:**
   - 15 HTTP calls per execution.
   - Responses of at most 250 KB.
   - A 10 s HTTP timeout.
   - 15 EVM reads, and log queries of at most 100 blocks.
   - `EVMClient` has **no nonce method**.

   The recipe in §7 uses 11 to 13 HTTP calls and 2 to 5 EVM reads.
7. **Zerion's testnet support is narrower than the plan says:**
   - `X-Env: testnet` is accepted only on positions, transactions, NFTs and chains.
   - **`/portfolio` and `/pnl` do not take it.**
   - Paths need the **trailing slash**. `/transactions` returns a `301` (I tested this), and
     CRE does not follow redirects.
   - The free Developer plan allows 2,000 requests a day at 3 RPS.
   - Zerion's x402 settles only on Base and Solana, not Monad.
8. **Neither Nansen nor Zerion exposes liquidations.** `priorLiquidations` has to come from
   Aave V3 `LiquidationCall` logs (`user` is `topic3`). Monad's RPC caps `eth_getLogs` at a
   **100-block range** (verified live), and CRE caps log queries at 100 blocks. So use the
   Etherscan V2 logs API, which is free on Ethereum, Arbitrum, Polygon and **Monad (143 and
   10143)**, and count only logs emitted by allowlisted pool addresses. Anyone can emit a
   fake `LiquidationCall`.
9. **`collect.ts` breaks on Monad in three places:**
   - Liquidations: `eth_getLogs` from `earliest`.
   - The explorer calls: a Blockscout `txlist` endpoint that isn't configured.
   - DeFi tenure: an allowance probe that counts protocols, not days.

   §5 maps each signal to its replacement.
10. **Missing data must not read as adverse.** `walletAgeDays = 0` scores as a brand-new
    wallet (−30 in `signals.ts`). If a source fails, the workflow should send no report,
    not attest zeros (§8).

---

## 1. What I verified, and how

| Item | Version or date | How verified |
|---|---|---|
| Nansen API | OpenAPI `1.0.0`, fetched 26 Sep 2026 | `curl https://api.nansen.ai/openapi.json` (805,237 bytes). Parsed each operation's `requestBody`, `responses.200`, `x-credit-cost` and `x-payment-info` |
| Nansen x402 prices and networks | live | Sent each profiler endpoint with no key and decoded the base64 `Payment-Required` header (x402 v2) |
| Nansen docs | live | `https://docs.nansen.ai/<page>.md` for authentication, rate-limits, credits, error-handling, agentic-payments, x402-payments, reference/chains, api/data-coverage and every profiler page |
| `nansen-cli` | **1.46.0** (npm `latest`; repo `github.com/nansen-ai/nansen-cli`) | `npm pack`; read `src/api.js` (request bodies) and `skills/nansen-wallet-clustering` |
| Zerion API | OpenAPI `3.0.3` / `1.0.0`, fetched 26 Sep 2026 | `curl https://developers.zerion.io/openapi-v1.yaml`. Parsed parameters and 200-response schemas |
| Zerion x402 price, redirects | live | Keyless GETs: `402` with `Payment-Required`. No trailing slash: `301` |
| Zerion plans | live | `https://zerion.io/api` pricing section |
| `zerion-cli` | **1.9.1** (repo `github.com/zeriontech/zerion-ai`) | `npm view`, `npm pack` |
| `@x402/fetch`, `@x402/evm`, `@x402/core` | **2.27.0** | `npm pack`; read `dist/cjs/index.d.ts` and `dist/cjs/exact/client/index.d.ts` |
| `@chainlink/cre-sdk` | **1.22.0** (npm `latest`) | `npm view`. API from `https://docs.chain.link/cre/llms-full-ts.txt` (HTTP client, EVM client, service quotas) |
| `@bgd-labs/aave-address-book` | **4.44.22** | `npm pack`; read the `POOL` constants in `dist/AaveV3*.js` |
| Aave V3 `LiquidationCall` | `aave/aave-v3-core@master` | `contracts/interfaces/IPool.sol`. Topic hash computed with `js-sha3@0.8.0` |
| Etherscan V2 API | live docs | `https://docs.etherscan.io/{supported-chains,rate-limits,api-reference/endpoint/getlogs-topics,tokentx,txlist}.md` |
| Monad RPC limits | live docs + live calls | `docs.monad.xyz/reference/json-rpc/overview.md`. `eth_getLogs` over 1,000 blocks on `testnet-rpc.monad.xyz` returned `-32614 "eth_getLogs is limited to a 100 range"`. A historical `eth_getTransactionCount` at block 1 returned "querying historical state that is not available" |
| AUSD and USDC decimals on Monad | live `eth_call decimals()` | All four tokens return `6`: AUSD and USDC on 10143 and on 143 (addresses from plan Appendix A) |
| Multicall3 on Monad testnet | live `eth_getCode` | Code is present at `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Node / npm used | v22.21.1 / 10.9.4 | local |

---

## 2. Nansen API

### 2.1 Base URL, auth, errors, headers

- **Base URL:** `https://api.nansen.ai`. Every profiler endpoint is a **`POST`** with a
  JSON body.
- **Auth header:** `apikey: <key>`. The docs write it in lowercase; header names are
  case-insensitive.

  Source: https://docs.nansen.ai/getting-started/authentication

  ```bash
  curl -X POST 'https://api.nansen.ai/api/v1/smart-money/holdings' \
    -H 'Content-Type: application/json' \
    -H 'apikey: YOUR_API_KEY' \
    -d '{"chains": ["ethereum"]}'
  ```

- **Without a key, you get one of two responses:**
  - A `402 Payment Required` with an x402 challenge, on every endpoint that accepts
    agentic payments.
  - A `401` with `"code":"unauthenticated"`, on key-only endpoints. I got this from
    `profiler/address/labels`: `"API key required. This endpoint does not support paid access."`
- **Error envelope** (every status except 402):
  `{error, message, code, status, request_id, doc_url, param?, retry_after?}`.

  | Code | When it happens |
  |---|---|
  | `invalid_field_value` | e.g. an unsupported chain |
  | `unknown_field` | e.g. a camelCase name, or `page` outside `pagination` |
  | `invalid_date_range` | "Range longer than one year, or beyond the per-address limit" |
  | `insufficient_credits` | returned as 403 |
  | `rate_limit_exceeded` | returned as 429 |
  | `query_timeout` | the query ran too long |

  Source: https://docs.nansen.ai/getting-started/error-handling
- **Credit headers** on successful responses (from the spec):
  - `X-Nansen-Credits-Cost`: the quoted cost.
  - `X-Nansen-Credits-Used`: what was actually deducted; 0 if the request was rejected.
  - `X-Nansen-Credits-Remaining`.

  Log these three in the workflow.
- **x402 validates late.** A keyless request with `"chain":"monad-testnet"` came back as a
  `402` challenge, not a `422`, so validation happens after payment. **UNVERIFIED:** whether
  a paid request that then fails validation is refunded. Validate bodies client-side before
  paying.

### 2.2 Chains: Monad is one value, and it is mainnet

- The chain enums per endpoint in the OpenAPI spec:

  | Endpoint | `monad` | `all` | Notes |
  |---|---|---|---|
  | `first-funder` | via `all` | **only** `all` | Resolved across chains. The response's `chain` says where |
  | `related-wallets` | yes | **no** | One chain per call |
  | `counterparties` | yes | yes | |
  | `transactions` | yes | yes | |
  | `pnl-summary` | yes | yes | |
  | `current-balance` | yes | yes | |
  | `labels` | yes | yes | |

- **No enum anywhere has a Monad testnet value.** The x402 challenge offers Monad payment
  as `eip155:143` with USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, which is the
  mainnet USDC in plan Appendix A.
- Nansen's Monad data starts on **14 May 2025**. Chains onboarded before mid-2023 have 3+
  years of history.

  Source: https://docs.nansen.ai/api/data-coverage
- Chain values in use: `ethereum`, `base`, `arbitrum`, `optimism`, `polygon`, `bnb`,
  `monad`, … (full list: https://docs.nansen.ai/reference/chains). Note Nansen uses
  **`bnb`**, where Zerion uses `binance-smart-chain`.

### 2.3 Credits, plans, rate limits

Source: https://docs.nansen.ai/getting-started/credits, https://docs.nansen.ai/getting-started/rate-limits

| Plan | Credits | Rate limit |
|---|---|---|
| **Free** | **100 one-time trial credits**, then "a daily top-up brings your included credit balance back up to 10 credits if it has fallen below 10". Can buy credits. "Access all API endpoints available in Pro" | **15 req/s, 300 req/min** |
| Pro ($49/mo annual, $69/mo monthly) | 2,000 on subscribing; monthly top-up back to 2,000 | 75 req/s, 1,500 req/min |
| x402 (no account) | pay per call | **5 req/s, 60 req/min per paying wallet** |

Credit cost per call. The Free and Pro prices are the same; this is the spec's
`x-credit-cost`, which matches the docs table.

| Endpoint (`POST /api/v1/…`) | Credits | x402 price (live) | x402? |
|---|---|---|---|
| `profiler/address/first-funder` | **1** | **$0.01** (amount `10000`, 6 dp) | yes |
| `profiler/address/related-wallets` | **1** | $0.01 | yes |
| `profiler/address/transactions` | **1** per page | $0.01 | yes |
| `profiler/address/pnl-summary` | **1** | $0.01 | yes |
| `profiler/address/current-balance` | **1** | $0.01 | yes |
| `profiler/address/counterparties` | **5** | **$0.05** | yes |
| `profiler/address/counterparties/batch` | 5 | $0.05 | yes |
| `profiler/address/labels` | **100** | none | **no, API key only** |
| `profiler/address/premium-labels` | 500 | none | no |

First-funder is missing from the docs' credits table. The spec's `x-credit-cost` gives
`{"free":1,"pro":1}`, and its `x-payment-info` gives `$0.01`.

### 2.4 x402 pay-per-call

Source: https://docs.nansen.ai/getting-started/agentic-payments/x402-payments

**How it works:**

- x402 **V2 only**. The signed payment goes in the `PAYMENT-SIGNATURE` header; the legacy
  `X-PAYMENT` header is rejected.
- If a request carries a valid API key, the key wins and no payment happens.
- Nansen names the Monad facilitator as "Molandak".

**Networks in the live challenge I decoded:**

| Network | Asset | Amount per $0.01 call |
|---|---|---|
| `eip155:8453` (Base) | USDC | `10000` |
| `eip155:143` (**Monad mainnet**) | USDC | `10000` |
| `eip155:196` | USD₮0 | `10000` |
| `eip155:56` (BNB) | several stables | `1e16` |
| Solana | USDC | `10000` |

All options share `payTo: 0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f` and
`maxTimeoutSeconds: 300`.

**Promotion (when enabled):** 50% off each wallet's first 100 settled calls. You have to
send `X-Payer-Address: <payer>` on the *unpaid* request to get it.

**Discovery:** `GET https://api.nansen.ai/.well-known/x402` lists every priced resource,
including `first-funder`. The challenge's `extensions.bazaar` also carries the response
schema, which matches §2.5.

**Client code.** The wiring comes from Zerion's x402 page, and I checked the types against
`@x402/fetch@2.27.0` and `@x402/evm@2.27.0`. The `networks` option is documented in
`EvmClientConfig`: "If not provided, registers wildcard support (eip155:*)". The default
selector takes "the first available option", which in Nansen's challenge is **Base**. To pay
on Monad, restrict `networks`:

```ts
// Source: https://developers.zerion.io/build-with-ai/x402 (wiring)
// Types: @x402/fetch@2.27.0 dist/cjs/index.d.ts, @x402/evm@2.27.0 dist/cjs/exact/client/index.d.ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.X402_PAYER_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account, networks: ["eip155:143"] }); // USDC on Monad mainnet

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const res = await fetchWithPayment("https://api.nansen.ai/api/v1/profiler/address/first-funder", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Payer-Address": account.address },
  body: JSON.stringify({ address: "0x28c6c06298d514db089934071355e5743bf21d60", chain: "all" }),
});
```

**x402 does not belong inside the CRE workflow**, for three reasons:

- Each node would sign its own payment with a fresh nonce, so the requests differ and
  `cacheSettings` can't deduplicate them. Every node would pay.
- The workflow would need a hot private key.
- Nansen's rate limit is per paying wallet.

Use x402 only off-DON: the app's pre-check ("see what you'd get"), or a fallback when the
key's credits run out.

### 2.5 The endpoints we call

The request and response fields below come from the OpenAPI schema. Example bodies are
the spec's own `examples`, or the `bazaar` input from the live 402 challenge.
**Pagination** on every paginated endpoint looks like this:

- Request: `"pagination": {"page": 1, "per_page": N}`.
- Response: `"pagination": {"page", "per_page", "is_last_page"}`.
- `per_page` is capped at 1000 (default 10), except **`transactions`**: max **100**,
  default 20, and anything over 100 is rejected.

#### 2.5.1 First funder: `POST /api/v1/profiler/address/first-funder` (1 credit, $0.01)

Source: https://docs.nansen.ai/api/profiler/address-first-funder

**What it returns:** "the earliest address to send **native gas** to the input EVM address",
across chains, "**not** the USDC (or any stablecoin) source".

**Constraints:**

- The body allows only `address` (required) and `chain` (fixed to `"all"`). The schema sets
  `additionalProperties: false`, so do not send `pagination`.
- There is no date range; it is a point-in-time view.
- An **empty `data: []`** comes back as a normal 200 "when the wallet has no first-funder
  attribution", for example a wallet that was only ever credited by an exchange or bridge
  that paid its gas.

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/first-funder' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"address":"0x28c6c06298d514db089934071355e5743bf21d60","chain":"all"}'
```

The response shape is from the schema `ProfilerAddressFirstFunderResponse`; the values are
placeholders:

```json
{
  "pagination": { "page": 1, "per_page": 10, "is_last_page": true },
  "data": [
    {
      "wallet_address": "<input address>",
      "first_funder_address": "<0x… funder>",
      "first_funder_name": "<Nansen label of the funder, may be absent>",
      "transaction_hash": "<0x… funding tx>",
      "block_timestamp": "<timestamp of the funding tx>",
      "chain": "<chain where the first funding happened>"
    }
  ]
}
```

**UNVERIFIED:**

- The exact `block_timestamp` string format. The spec only says "timestamp", while
  `transactions` says "ISO format". Parse defensively.
- The shape of `first_funder_name` for exchanges. The CLI's clustering skill treats "CEX"
  and "known protocol" as labels you can recognise, but I saw no real value.

#### 2.5.2 Related wallets: `POST /api/v1/profiler/address/related-wallets` (1 credit, $0.01)

Source: https://docs.nansen.ai/api/profiler/address-related-wallets

**Request:**

| Field | Notes |
|---|---|
| `wallet_address` | Required. `address` is a deprecated alias |
| `chain` | Required; one chain, **no `all`** |
| `pagination` | Optional |
| `order_by` | Optional. `[{ "field": "order", "direction": "ASC" \| "DESC" }]` |

It is a point-in-time view with no date range.

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/related-wallets' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"wallet_address":"0x28c6c06298d514db089934071355e5743bf21d60","chain":"ethereum","pagination":{"page":1,"per_page":100}}'
```

The response (schema `ProfilerRelatedWallet`):

```json
{
  "pagination": { "page": 1, "per_page": 100, "is_last_page": false },
  "data": [
    {
      "address": "<0x… related address>",
      "address_label": "<label, may be absent>",
      "relation": "<relation type>",
      "transaction_hash": "<0x…>",
      "block_timestamp": "<…>",
      "order": 1,
      "chain": "ethereum"
    }
  ]
}
```

**UNVERIFIED:** the vocabulary of `relation`. The spec doesn't enumerate it. The CLI's
clustering skill ranks a "First Funder" relation as high confidence. On Day 0, log the
distinct `relation` values from a few real calls before deciding which ones count.

#### 2.5.3 Counterparties: `POST /api/v1/profiler/address/counterparties` (5 credits, $0.05)

Source: https://docs.nansen.ai/api/profiler/address-counterparties

**Request:**

| Field | Notes |
|---|---|
| `address` or `entity_name` | One of the two |
| `chain` | Required; `all` allowed |
| `date` | **Required**, `{from, to}`. High-volume addresses are limited to 180 days |
| `source_input` | `Combined` (default) \| `Tokens` \| `ETH` |
| `group_by` | `wallet` (default) \| `entity` |
| `filters` | `interaction_count`, `total_volume_usd`, `volume_in_usd` and `volume_out_usd` ranges; `include_smart_money_labels`, `exclude_smart_money_labels` |
| `pagination`, `order_by` | Sort fields: `interaction_count`, `total_volume_usd`, `volume_in_usd`, `volume_out_usd` |

`include_smart_money_labels` takes values from the `LabelType` enum, which **includes
`"Exchange"`**.

**Caching:** a settled date range is cached for up to 7 days; a range that includes today,
for up to 5 min.

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/counterparties' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"address":"0x6df064f04ddfb2bb53da21af9d56701726700145","chain":"ethereum","date":{"from":"2025-05-01T00:00:00Z","to":"2025-05-03T23:59:59Z"},"group_by":"wallet","pagination":{"page":1,"per_page":10},"source_input":"Combined"}'
```

The response items (`ProfilerCounterparty`):

- `counterparty_address`
- `counterparty_address_label` (string[])
- `interaction_count`
- `total_volume_usd`, `volume_in_usd`, `volume_out_usd`
- `tokens_info[]`, each with `{token_address, token_symbol, token_name, num_transfer, total_token_amount, token_in_amount, token_out_amount}`

There are **no timestamps**, so counterparties can't give a tenure.

**Why we skip it:** 5 credits each. It could back a stronger `exchangeFunded` check
(`filters.include_smart_money_labels: ["Exchange"]` and look for `volume_in_usd > 0`), or
the funder's out-degree for the sybil check. The recipe uses the cheaper
`first-funder` + `related-wallets` pair instead. **UNVERIFIED:** whether the `Exchange`
filter matches CEX hot wallets the way we'd expect.

#### 2.5.4 Transactions: `POST /api/v1/profiler/address/transactions` (1 credit per page, $0.01)

Source: https://docs.nansen.ai/api/profiler/address-transactions

**Request:**

| Field | Notes |
|---|---|
| `address` | Required |
| `chain` | Required; `all` allowed |
| `date` | Required, `{from, to}` |
| `hide_spam_token` | Default `true` |
| `filters` | `token_symbol`, `token_address`, `counterparty_name`, `counterparty_address`, `volume_usd`, `method` (`sent` \| `received`), `source_type` (the spec's examples are `dex`, `transfer`) |
| `pagination` | **Max 100 per page** |
| `order_by` | `[{ "field": "block_timestamp", "direction": "ASC" \| "DESC" }]` |

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/transactions' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"address":"0x28c6c06298d514db089934071355e5743bf21d60","chain":"ethereum","date":{"from":"2025-08-01T00:00:00Z","to":"2025-08-10T23:59:59Z"},"hide_spam_token":true,"filters":{"volume_usd":{"min":100}},"pagination":{"page":1,"per_page":100},"order_by":[{"field":"block_timestamp","direction":"ASC"}]}'
```

The response items (`ProfilerTransaction`):

- `chain`, `method`, `volume_usd`, `block_timestamp`, `transaction_hash`, `source_type`
- `tokens_sent[]` and `tokens_received[]`, each with `{token_symbol, token_amount, price_usd, value_usd, token_address, chain, from_address, to_address, from_address_label, to_address_label}`

**Useful trick:** `order_by` `block_timestamp ASC` with `per_page: 1` returns the *oldest*
transaction in the date range for **1 credit**.

**UNVERIFIED:** whether this endpoint accepts ranges longer than a year. The error doc lists
`invalid_date_range` for "longer than one year". The spec gives the explicit 366-day cap
(`DateRangeMaxOneYear`) only to `tgm/transfers`, and gives `transactions` a plain
`DateRange`.

**Why we don't count with it:** counting a whole history this way costs one credit per 100
rows. A wallet with thousands of transactions costs tens of credits. Use RPC nonces (§4.1).

#### 2.5.5 PnL summary: `POST /api/v1/profiler/address/pnl-summary` (1 credit, $0.01)

Source: https://docs.nansen.ai/api/profiler/address-pnl-and-trade-performance

- **Request:** `wallet_address` (`address` is a deprecated alias), `chain` (required;
  `all` and `monad` allowed), `date` (required).
- **Response:** `{pagination, top5_tokens[{realized_pnl, realized_roi, token_address, token_symbol, chain}], traded_token_count, traded_times, realized_pnl_usd, realized_pnl_percent, win_rate}`.
- Served from a cache of up to about an hour.
- `traded_times` counts "sales (outflow or dex sell)", so plain transfers out count too. It
  is not a clean DeFi-tenure signal.
- **It isn't a `Facts` field.** Keep it off the DON path. If we want a "profitable trader"
  reason line in the app, fetch it there.

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/pnl-summary' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"chain":"ethereum","date":{"from":"2025-05-01T00:00:00Z","to":"2025-05-03T23:59:59Z"},"wallet_address":"0x39d52da6beec991f075eebe577474fd105c5caec"}'
```

#### 2.5.6 Current balance: `POST /api/v1/profiler/address/current-balance` (1 credit, $0.01)

- **Request:** `address`, `chain` (`all` allowed), `hide_spam_token` (default `true`),
  `filters.{token_symbol, token_address, token_name, value_usd, price_usd, token_amount}`,
  `pagination`, `order_by`.
- **Response items:** `{chain, address, token_address, token_symbol, token_name, token_amount (number), price_usd, value_usd}`.
- `token_amount` is a float. Zerion's `quantity.int` (§3.3) is exact, so the recipe uses
  Zerion for stables.

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/current-balance' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"address":"0x28c6c06298d514db089934071355e5743bf21d60","chain":"ethereum","hide_spam_token":true,"pagination":{"page":1,"per_page":10}}'
```

#### 2.5.7 Labels: `POST /api/v1/profiler/address/labels` (100 credits, API key only)

- **Request:** `address`, `chain` (`all` allowed), `pagination`.
- **Response:** `data[{label, category (smart_money | behavioral | defi | social | cefi | nft | others), kind[]}]`.
- `category: "cefi"` would be the clean exchange test for a funder.
- **Skip it.** 100 credits is ten free days, and it has no x402 path.
- **UNVERIFIED:** whether a Free-plan key can call it. The credits table lists "Free: 100",
  but the agentic-payments page calls the labels endpoints "Pro subscription only".

```bash
curl -X POST 'https://api.nansen.ai/api/v1/profiler/address/labels' \
  -H 'Content-Type: application/json' \
  -H "apikey: $NANSEN_API_KEY" \
  -d '{"address":"0x4a7c6899cdcb379e284fbfd045462e751da4c7ce","chain":"ethereum","pagination":{"page":1,"per_page":100}}'
```

---

## 3. Zerion API

### 3.1 Base URL, auth, testnet, chain IDs

Source: https://developers.zerion.io/authentication

**Base URL:** `https://api.zerion.io`, all `GET`.

**Auth:** HTTP Basic with the key as the username and an empty password, i.e.
`Authorization: Basic base64("<key>:")`.

```js
// Source: https://developers.zerion.io/authentication
const apiKey = 'YOUR_API_KEY';
const apiKeyTransformed = btoa(apiKey + ':');
const response = await fetch(
  'https://api.zerion.io/v1/wallets/0x42b9df65b219b3dd36ff330a4dd8f327a6ada990/portfolio',
  { headers: { 'Authorization': `Basic ${apiKeyTransformed}`, 'accept': 'application/json' } }
);
```

**Testnet:** "Zerion serves testnet data from a separate environment. Pass the
`X-Env: testnet` header". The Monad Testnet chain ID is **`monad-test-v2`**; Monad mainnet
is **`monad`**, and it supports tokens, transactions, DeFi and NFTs.

Source: https://developers.zerion.io/supported-blockchains

**Which endpoints accept `X-Env`** (from the spec's parameter lists):

| Endpoint | `X-Env` |
|---|---|
| `GET /v1/wallets/{address}/positions/` | yes |
| `GET /v1/wallets/{address}/transactions/` | yes |
| `nft-positions/`, `nft-collections/`, `nft-portfolio` | yes |
| `GET /v1/chains/`, `GET /v1/chains/{chain_id}` | yes |
| **`GET /v1/wallets/{address}/portfolio`** | **no** |
| **`GET /v1/wallets/{address}/pnl`** | **no** |
| `charts/{period}` | no |

So the plan's "Zerion: … holdings, including Monad testnet" holds for **positions**, not
for **portfolio**.

**Trailing slash.** I tested this live:

- `GET …/transactions` → `301` to `…/transactions/`.
- `GET …/positions` → `301` to `…/positions/`.

CRE's HTTP client does not follow redirects ("HTTP requests to URLs that return redirects
(3xx status codes) will fail"), so **always write the slash**.

**Per-chain capability.** `GET /v1/chains/{id}` returns
`attributes.flags.{supports_transactions, supports_positions, …}`. If you name a chain whose
flag is false in `filter[chain_ids]`, you get a `400`; if you omit the filter, that chain is
silently dropped. **UNVERIFIED:** the flags for `monad-test-v2`, and whether Zerion
indexes AUSD transfers there. Day 0:
`curl -H 'X-Env: testnet' -u "$ZERION_KEY:" https://api.zerion.io/v1/chains/monad-test-v2`.

### 3.2 Plans, limits, x402

- **Plans**, from https://zerion.io/api:

  | Plan | Price | Requests | Rate |
  |---|---|---|---|
  | **Developer** | $0 | **2,000 / day** | **3 RPS** |
  | Builder | $149/mo | 250K / month | 10 RPS |
  | Startup | $499/mo | 1M / month | 25 RPS |

  The same page says: "DeFi Positions, Wallet Portfolio Chart, and Wallet P&L endpoints are
  limited to 25% of every plan quota". **UNVERIFIED:** whether `positions/` with the
  default `only_simple` counts against that 25%.
- **Rate-limit headers:** `RateLimit-Org-{Second,Day,Month}-{Limit,Remaining,Reset}` and
  `RateLimit-Org-Tier`. Too many requests gets a `429`.

  Source: https://developers.zerion.io/rate-limits
- **x402:** $0.01 per call. The live challenge showed amount `10000` on `eip155:8453` and on
  Solana, **with no Monad option**. There are no rate limits under x402.

  Source: https://developers.zerion.io/build-with-ai/x402

### 3.3 Endpoints

#### Portfolio: `GET /v1/wallets/{address}/portfolio` (mainnet only)

**Parameters:** `filter[positions]` (`only_simple` default | `only_complex` | `no_filter`),
`currency`.

**Response** (`data.attributes`):

- `positions_distribution_by_type{wallet, deposited, borrowed, locked, staked}`
- `positions_distribution_by_chain{<chain>: value}`
- `total.positions`
- `changes{absolute_1d, percent_1d}`

It gives USD totals, not stablecoin amounts, so the recipe doesn't use it. `borrowed > 0`
could hint at an open debt.

#### Positions: `GET /v1/wallets/{address}/positions/` (testnet OK)

**Parameters:**

- `filter[positions]`, `filter[position_types]` (`deposit`, `loan`, `locked`, `staked`,
  `reward`, `wallet`, `investment`)
- `filter[chain_ids]`, `filter[fungible_ids]`, `filter[dapp_ids]`
- `filter[trash]` (default `only_non_trash`)
- `sort` (`value` | `-value`)
- `currency`, `X-Env`

**Behaviour:**

- **Not paginated.** Every matching position comes back in one response, and
  `page[size]` is ignored.
- A wallet's **first** request can return **`503` with `Retry-After`** (typically 10 s)
  while Zerion computes it (https://developers.zerion.io/error-handling).

**Items:**

- `attributes.{position_type, quantity{int, decimals, float, numeric}, value, price}`
- `attributes.fungible_info{symbol, flags.verified, implementations[{chain_id, address, decimals}]}`
- `attributes.flags.is_trash`, `attributes.application_metadata.name`
- `relationships.chain.data.id`

```bash
# Source: https://developers.zerion.io/api-reference/wallets/get-wallet-fungible-positions (parameters)
curl -g -u "$ZERION_API_KEY:" -H 'accept: application/json' \
  "https://api.zerion.io/v1/wallets/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/positions/?filter[positions]=only_simple&filter[trash]=only_non_trash&currency=usd"
# testnet:
curl -g -u "$ZERION_API_KEY:" -H 'accept: application/json' -H 'X-Env: testnet' \
  "https://api.zerion.io/v1/wallets/<mera address>/positions/?filter[chain_ids]=monad-test-v2"
```

#### Transactions: `GET /v1/wallets/{address}/transactions/` (testnet OK)

**Parameters:**

| Parameter | Notes |
|---|---|
| `page[size]` | 1–100, default 100 |
| `page[after]` | Opaque. Follow `links.next`; don't build it yourself |
| `filter[operation_types]` | `approve`, `bid`, `burn`, `claim`, `delegate`, `deploy`, `deposit`, `execute`, `mint`, `receive`, `revoke`, `revoke_delegation`, `send`, `trade`, `withdraw` |
| `filter[asset_types]` | |
| `filter[chain_ids]` | |
| `filter[fungible_ids]`, `filter[fungible_implementations]` | |
| `filter[min_mined_at]`, `filter[max_mined_at]` | **Unix ms, exactly 13 digits** |
| `filter[trash]` | Default `no_filter` |
| `filter[search_query]` | |
| `X-Env` | |

**There is no `sort` parameter.** The recipe's sample output lists the newest first
(**UNVERIFIED** as a contract; the docs never state an order).

**Items (`attributes`):**

- `operation_type`, `hash`, `mined_at_block`, `mined_at` (ISO 8601)
- `sent_from`, `sent_to`, `status` (`confirmed` \| `failed` \| `pending`), `nonce`
- `fee`, `transfers[{direction in|out|self, quantity, sender, recipient, fungible_info}]`
- `approvals[]`, `application_metadata{name, contract_address, method}`
- `flags.is_trash`, `acts[]`

`relationships.chain.data.id` gives the chain, and `relationships.dapp.data.id` gives the
dapp, e.g. `aave-v3`.

**Pagination** is cursor-based: repeat until `links.next` is absent.

Source: https://developers.zerion.io/pagination-and-filtering

```js
// Source: https://developers.zerion.io/pagination-and-filtering
async function fetchAll(url, apiKey) {
  const results = [];
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}` }
    });
    const json = await response.json();
    results.push(...json.data);
    url = json.links.next || null;
  }
  return results;
}
```

```bash
# Source: https://developers.zerion.io/recipes/transaction-history (curl form); X-Env from supported-blockchains
curl -g -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/transactions/?currency=usd&filter[operation_types]=trade"
curl -g -u "$ZERION_API_KEY:" -H 'X-Env: testnet' \
  "https://api.zerion.io/v1/wallets/<mera address>/transactions/?filter[chain_ids]=monad-test-v2&page[size]=100"
```

**Edge cases** (https://developers.zerion.io/error-handling):

- An address Zerion doesn't track gets a `400`: "address … is not trackable". That covers
  token contracts, routers, burn addresses, **exchange hot wallets and mining pools**.
  Treat it as "no data", not as a failure to retry.
- `filter[trash]` on transactions is **wallet-contextual**: the same airdrop can be spam
  for one wallet and not for another.
- **UNVERIFIED:** response size. Each transaction carries full `fungible_info` including
  `implementations[]` for every chain, so a 100-row page of mainnet history can plausibly
  pass CRE's 250 KB limit. Inside CRE, use `page[size]=1` probes (§6) and small pages.

**Wallets with thousands of transactions:** there is no count field and no ascending sort.
Finding the *oldest* transaction by paging costs `ceil(n/100)` calls. Instead,
**bracket it in time**: `filter[max_mined_at]=<t>&page[size]=1` returns data exactly when
some transaction happened at or before `t`. A few such probes answer "older than 30, 180 or
365 days?" in O(1) calls whatever the history length (§6.1, §6.4).

---

## 4. Plain RPC and explorer: where they beat both APIs

### 4.1 What RPC does better

**`txCount`:** `eth_getTransactionCount(addr, "latest")` gives the number of transactions
an EOA has *sent*. It costs one free call per chain and ignores history length.

- It can't see received transfers.
- It returns 0 for our gasless Mera accounts.
- A contract wallet (Safe) reports its contract nonce, not activity.

**`stableBalance`:** `balanceOf` on AUSD and USDC, both 6 decimals (verified live):

| | Testnet (10143) | Mainnet (143) |
|---|---|---|
| AUSD | `0xa9012a05…5322dC` | `0x00000000eFE3…9012a` |
| USDC | `0x534b2f3A…3943A3` | `0x754704Bc…afb603` |

In CRE, use `EVMClient.callContract` on chain selector `monad-testnet` (2 EVM reads), or 1
read through Multicall3, which is deployed on testnet (verified). The selector is
`balanceOf(address)` = `0x70a08231`.

```ts
// Source: https://docs.chain.link/cre/reference/sdk/evm-client-ts (callContract)
import { EVMClient, getNetwork, encodeCallMsg, LAST_FINALIZED_BLOCK_NUMBER } from "@chainlink/cre-sdk"
import { encodeFunctionData, zeroAddress, erc20Abi } from "viem"

const network = getNetwork({ chainFamily: "evm", chainSelectorName: "monad-testnet" })
const evmClient = new EVMClient(network!.chainSelector.selector)
const reply = evmClient
  .callContract(runtime, {
    call: encodeCallMsg({
      from: zeroAddress,
      to: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", // AUSD, Monad testnet
      data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [user] }),
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  })
  .result()
// reply.data: ABI-encoded uint256
```

**UNVERIFIED:** that `erc20Abi` is exported by the `viem` version the CRE template pins.
Any ERC-20 ABI fragment works.

### 4.2 What RPC can't do on Monad (verified)

- **`eth_getLogs` block-range caps.** Public testnet RPC: **100 blocks**, tested live.
  Mainnet by provider: QuickNode 100, Alchemy 1,000 blocks or 10,000 logs, Ankr 1,000, the
  Monad Foundation RPC 100 (https://docs.monad.xyz/reference/json-rpc/overview). With
  sub-second blocks, a year of history is tens of millions of blocks, so `collect.ts`'s
  `fromBlock: "earliest"` fails on Monad.
- **No archive state.** "Monad full nodes do not provide access to arbitrary historic
  state" (https://docs.monad.xyz/developer-essentials/historical-data), and I confirmed it
  live. You can't binary-search nonce history for a first-transaction date.
- **CRE limits** (https://docs.chain.link/cre/service-quotas):

  | Quota | Value |
  |---|---|
  | `ChainRead.CallLimit` | 15 per execution |
  | `ChainRead.LogQueryBlockLimit` | **100 blocks** |
  | `HTTPAction.CallLimit` | 15 per execution |
  | `HTTPAction.ResponseSizeLimit` | 250 KB |
  | `HTTPAction.CacheAgeLimit` | 10 min |
  | HTTP timeout | 5 s default, 10 s max |
  | `Consensus.ObservationSizeLimit` | 25 KB |
  | `Secrets.CallLimit` | 5 per execution |
  | HTTP trigger rate | **1 per 30 s** |

- **`EVMClient` has no nonce method.** Its reads are `callContract`, `filterLogs`,
  `balanceAt`, `estimateGas`, `getTransactionByHash`, `getTransactionReceipt` and
  `headerByNumber`. A nonce has to come from a JSON-RPC `POST` through `HTTPClient`.

### 4.3 Liquidations: Etherscan V2 logs by topic

**The event**, verified in `aave-v3-core/contracts/interfaces/IPool.sol`:

```solidity
event LiquidationCall(
  address indexed collateralAsset,
  address indexed debtAsset,
  address indexed user,          // topic3
  uint256 debtToCover,
  uint256 liquidatedCollateralAmount,
  address liquidator,
  bool receiveAToken
);
// topic0 = keccak256("LiquidationCall(address,address,address,uint256,uint256,address,bool)")
//        = 0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286  (matches collect.ts)
```

**Aave V3 `POOL` addresses** (`@bgd-labs/aave-address-book@4.44.22`):

| Chain | Pool |
|---|---|
| Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Arbitrum | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Polygon | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Optimism | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |

The address book has **no `AaveV3Monad`**. **UNVERIFIED:** which Aave-V3-compatible
lending markets exist on Monad mainnet, and their pool addresses.

**Etherscan V2:**

- **Free-tier chains:** Ethereum 1, Arbitrum 42161, Polygon 137, **Monad 143 and Monad
  Testnet 10143**. Base 8453, OP 10, BNB 56 and Avalanche 43114 are **paid only**
  (https://docs.etherscan.io/supported-chains).
- **Free-tier limits:** 3 calls/s and 100,000 calls/day
  (https://docs.etherscan.io/rate-limits).
- **Auth:** the key goes in the `apikey` query parameter.

```bash
# Source: https://docs.etherscan.io/api-reference/endpoint/getlogs-topics
# Every LiquidationCall where user == borrower, from any emitter, on one chain:
curl "https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs\
&fromBlock=0&toBlock=<head>\
&topic0=0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286\
&topic0_3_opr=and\
&topic3=0x000000000000000000000000<borrower without 0x>\
&page=1&offset=1000&apikey=$ETHERSCAN_API_KEY"
```

**Security edge case:** anyone can deploy a contract that emits `LiquidationCall` with a
victim's address as `user` and so grief their score. **Count a log only if its `address` is
on an allowlist** of Aave V3 pools and vetted forks. You could instead use the
address-and-topics variant (`getlogs-address-topics`), which takes one pool per call.

**UNVERIFIED:**

- Whether `toBlock=latest` is accepted. The spec types it as an integer. Read the head with
  CRE `headerByNumber` (an EVM read) or send a large integer.
- How a full-range topic query performs. The docs say "Keep the range narrow to avoid
  timeouts". If it times out, HyperSync (see `docs/research/envio.md`) is the fallback.

### 4.4 Wallet age for a gasless account: Etherscan V2 `tokentx`

The Mera account's history is ERC-20 transfers the relayer sent on its behalf. One call
returns its first one:

```bash
# Source: https://docs.etherscan.io/api-reference/endpoint/tokentx
curl "https://api.etherscan.io/v2/api?chainid=10143&module=account&action=tokentx\
&address=<mera address>&page=1&offset=1&sort=asc&apikey=$ETHERSCAN_API_KEY"
```

The same call with `sort=desc&offset=100` gives a transfer count, up to 100. This is the
fallback if Zerion's `monad-test-v2` turns out not to index AUSD.

---

## 5. What `packages/underwriting` does today, and what breaks on Monad

`collect.ts` builds seven `Signal`s. `signals.ts` turns them into points: baseline 600,
clamp 300–780, and a decline at 2 or more liquidations or at 25 or more sybil siblings.

| Signal in `signals.ts` | `collect.ts` source today | Problem on Monad / in CRE | `Facts` field it becomes |
|---|---|---|---|
| `wallet_age` (days; <7 → −30 … ≥365 → +60) | Blockscout `txlist sort=asc offset=1` | No `explorerApi` configured; `fetch` isn't allowed in CRE | `walletAgeDays` |
| `transaction_count` (<5, <50, <250, ≥250) | `eth_getTransactionCount` | Always 0 for gasless Mera accounts | `txCount` |
| `stablecoin_balance` (units; 6 dp) | `balanceOf(stablecoin)` | Works; needs AUSD **and** USDC | `stableBalance` |
| `defi_tenure` (protocol count × 12) | Non-zero `allowance(stablecoin, protocol)` | Counts protocols, not days. Permit-based flows leave no allowance; one token only | `defiTenureDays` (**semantics change**: days) |
| `aave_history` | `getUserAccountData` | Not in `Facts`; drop it or add a field | none |
| `liquidation_history` (≥2 declines) | `eth_getLogs` `earliest`→`latest` on one pool | Fails against a 100-block cap; one pool only; no emitter allowlist | `priorLiquidations` |
| `funding_concentration` (siblings; infra if ≥60) | Blockscout: the funder's last 100 txs → distinct recipients | No explorer on Monad; the Mera account has no native funder | `relatedWallets` + `exchangeFunded` (the infra exemption) |

`INFRASTRUCTURE_OUTDEGREE = 60` and the "exchange funding is mildly reassuring" rule carry
over. `ScoreManager` should ignore `relatedWallets` when `exchangeFunded` is true, or when
`relatedWallets >= 60`.

---

## 6. Deriving each `Facts` field

Every underwriting has **two subjects**:

- **The Mera account** on Monad testnet. It always exists, is new and is gasless.
- **An optional linked history wallet**, proven by signature (plan §5.5), with mainnet
  history on any chain.

Nansen can only see the linked wallet. Each field below says how to merge the two.

Let `now` be `runtime.now()` in seconds. It is DON time, the same on every node.

### 6.1 `walletAgeDays`

**Linked wallet: Nansen `first-funder` (1 credit).**

- `walletAgeDays = floor((now - parse(block_timestamp)) / 86400)`.
- It is resolved across Nansen's EVM chains, whatever the history length.
- If `data` is empty (a CEX or bridge paid the gas), fall back to **Zerion probes**:
  `GET /v1/wallets/{a}/transactions/?filter[max_mined_at]=<(now-T)·1000>&page[size]=1`.
  - Binary-search `T` over the `signals.ts` bucket edges `{30, 180, 365}`: 2 calls.
  - Report the largest `T` that has data. This is a conservative floor.
  - If Zerion returns `400 not trackable`, report 0 **and** flag the source as missing (§8).

**Mera account: Zerion testnet** (`X-Env: testnet`,
`filter[chain_ids]=monad-test-v2&page[size]=100`, 1 call).

- If `links.next` is absent, the last row is the oldest and gives the exact age.
- Otherwise, take the age from probes.
- Fallback: Etherscan `tokentx` on 10143 with `sort=asc&offset=1` (1 call).

**Merge:** `max(mera, linked)`.

**Edge cases:**

- An aged wallet can be bought; no source detects that.
- Nansen's Monad data starts 14 May 2025.
- A first funding on a chain Nansen doesn't index makes the age an underestimate, which is
  the safe direction.

### 6.2 `txCount`

**Linked wallet:** JSON-RPC `eth_getTransactionCount(addr,"latest")`, summed over a
configured chain list. Recommended: Ethereum, Base and Monad, which is 3 HTTP `POST`s
through `HTTPClient`. Only `rpc.monad.xyz` is verified here; put the others in config.

- It is O(1) whatever the history length. It counts *sent* transactions only, which is what
  `signals.ts` means ("transaction(s) sent from this address").
- **Contract wallets:** the nonce is not activity. If `eth_getCode` isn't empty, use the
  Zerion count capped at 100 instead.

**Mera account:** the nonce is always 0. Use the Zerion testnet row count from §6.1's call,
capped at 100 (a next page exists means ≥ 100). Or count Polaris events from our own
indexer.

**Why not Nansen or Zerion paging:** 1 credit per 100 rows, or 1 request per 100 rows,
unbounded for active wallets.

**Merge:** the sum, capped at `2^32-1`.

### 6.3 `stableBalance` (6 dp)

**Mera account:** `balanceOf` on AUSD and USDC on 10143, through CRE `callContract`
(2 EVM reads, free). The result is exact, and both tokens have 6 decimals.

**Linked wallet: Zerion `positions/`** with `filter[positions]=only_simple` (1 request, not
paginated).

- Keep rows where all of these hold:
  - `fungible_info.flags.verified`
  - `!flags.is_trash`
  - the `symbol` is one of USDC, USDT, AUSD, DAI, *or* the
    `(relationships.chain.data.id, implementation address)` pair is on a configured
    allowlist (safer)
- Sum `quantity.int · 10^6 / 10^quantity.decimals` as BigInt, which stays exact across 18-dp
  DAI.
- Nansen `current-balance` (1 credit) works too, but returns floats and spends a scarce
  credit.
- A first request may `503` while Zerion computes the wallet (see §8, warm-up).

**Merge:** the sum, capped at `2^64-1`.

### 6.4 `defiTenureDays`

**Linked wallet: Zerion probes** with
`filter[operation_types]=trade,deposit,withdraw&filter[trash]=only_non_trash&filter[max_mined_at]=<(now-T)·1000>&page[size]=1`.

- Binary-search `T` over `{30, 180, 365}`: 2 calls, each response tiny.
- `defiTenureDays` is the largest `T` with a hit, or 0.
- Why it works: Zerion's `operation_type` already separates trades, deposits and
  withdrawals from plain sends. A probe answers "a DeFi action at least T days ago", so the
  cost doesn't depend on history length and nobody can backdate it.
- **If the contract needs exact days**, add one final page: `filter[min_mined_at]=<now-T_next>`
  with `page[size]=25`, and take the last row. **UNVERIFIED:** the newest-first order that
  this relies on.

**Mera account:** 0. The testnet has no DeFi history worth scoring.

**Alternatives we rejected:**

- Nansen `transactions` with `filters.source_type:"dex"` and `order_by` ASC. The
  `source_type` vocabulary is **UNVERIFIED**, and deposits and withdrawals wouldn't match.
- `pnl-summary` window probes. `traded_times` counts plain outflows.

### 6.5 `priorLiquidations`

**Linked wallet: Etherscan V2 `getLogs`** (§4.3).

- Filter on `topic0` = `LiquidationCall` and `topic3` = the padded borrower.
- One call per chain: Ethereum 1, Arbitrum 42161 and Monad 143. That is 3 HTTP calls, all
  on the free tier.
- Count only logs whose `address` is in the pool allowlist.
- Neither Nansen nor Zerion has a liquidation fact. **UNVERIFIED:** how Zerion labels the
  borrower's side of a liquidation (there is no `liquidation` operation type).

**Mera account:** 0.

**Merge:** the sum, capped at `2^16-1`.

**Scope:**

- Aave V3 and its same-event forks only.
- Compound v3 has an `AbsorbDebt` event with the borrower indexed, if we want it later.
  **UNVERIFIED:** its exact signature. I did not read Comet's source.
- Morpho Blue's `Liquidate` has a different layout; **UNVERIFIED** here.

### 6.6 `relatedWallets`

This is the sybil cluster size, measured the way `signals.ts` measures it: how many
wallets the **same funder** is tied to.

**Linked wallet:**

1. From §6.1, take `first_funder_address` and its `chain`.
2. If `exchangeFunded` is true, or the chain isn't in the related-wallets enum, set it to 0
   and skip.
3. Otherwise call Nansen `related-wallets` on the **funder**, with
   `wallet_address: funder`, `chain: <that chain>` and `pagination: {page:1, per_page:100}`.
   That is 1 credit.
4. `relatedWallets` = the number of distinct `address` values, minus the borrower. If
   `is_last_page` is false, report 100: at 60 or more the funder is infrastructure, so the
   exact count doesn't matter.

**UNVERIFIED:** which `relation` values mean "funded by". Until we've seen real rows,
count every relation. A cheaper, weaker version calls `related-wallets` on the borrower
itself.

**Stronger alternative, 5 credits:** Nansen `counterparties` on the funder, with
`source_input:"ETH"`, a `date` window of ±30 days around the funding transaction and
`order_by volume_out_usd DESC`. Count distinct counterparties with `volume_out_usd > 0`.

**Mera account:** 0. It has no native funder. Sybil risk on our side, like one sender
funding many claim links, is for our own indexer to measure, not Nansen.

### 6.7 `exchangeFunded`

**Linked wallet:** `first_funder_name` from §6.1, matched case-insensitively against a
maintained CEX allowlist (Binance, Coinbase, Kraken, OKX, Bybit, Bitget, KuCoin, Gate,
HTX, Crypto.com, …).

- Cost: 0 extra.
- **UNVERIFIED:** the label format, so check it on Day 0 against a known CEX-funded wallet.

**If the name is missing or ambiguous:**

- Nansen `counterparties` on the borrower with
  `filters.include_smart_money_labels:["Exchange"]` and look for `volume_in_usd > 0`
  (5 credits). This checks "has received from an exchange", not "first funded by".
- Or `labels` on the funder, where `category == "cefi"`. That costs **100 credits**, so
  don't.

**Mera account:** false.

**Merge:** the linked value.

### 6.8 `observedAt`

`BigInt(Math.floor(runtime.now().getTime() / 1000))`, which is DON time. Never use
`Date.now()`: nodes disagree and consensus fails.

`ScoreManager` refuses evidence older than 15 minutes (§5.2 item 6). Every cache we use is
at most 10 minutes (CRE's `CacheAgeLimit`), so the two are consistent.

---

## 7. Cost of one underwriting, and the recommended recipe

### 7.1 The recipe (cheapest reliable)

| # | Call | Subject | Facts | Nansen credits | Zerion req | HTTP calls | EVM reads |
|---|---|---|---|---|---|---|---|
| 1 | AUSD + USDC `balanceOf` on 10143 | Mera | `stableBalance` | – | – | – | 2 |
| 2 | Zerion `transactions/` `X-Env: testnet`, `monad-test-v2`, `page[size]=100` | Mera | `txCount`, `walletAgeDays` | – | 1 | 1 | – |
| 3 | Nansen `first-funder` | linked | `walletAgeDays`, `exchangeFunded`, funder | **1** | – | 1 | – |
| 4 | Nansen `related-wallets` on the funder (skip if exchange) | linked | `relatedWallets` | **0–1** | – | 0–1 | – |
| 5 | `eth_getTransactionCount` on 3 chains (JSON-RPC over HTTP) | linked | `txCount` | – | – | 3 | – |
| 6 | Zerion DeFi probes (binary search, `page[size]=1`) | linked | `defiTenureDays` | – | 2 | 2 | – |
| 7 | Zerion `positions/` `only_simple` | linked | `stableBalance` | – | 1 | 1 | – |
| 8 | Etherscan V2 `getLogs` LiquidationCall on 3 chains (+ head via `headerByNumber`) | linked | `priorLiquidations` | – | – | 3 | 0–3 |
| 9 | Fallback age probes (only if first-funder is empty) | linked | `walletAgeDays` | – | 0–2 | 0–2 | – |

**Totals:**

| Case | Nansen | Zerion | HTTP calls | EVM reads |
|---|---|---|---|---|
| **Mera account only** (no linked wallet) | 0 credits, $0 | 1 request | 1 | 2 |
| **With a linked wallet** (typical) | **2 credits**, or $0.02 over x402 | 4 requests | **12** (11 if exchange-funded) | 2–5 |
| **Worst case** (no first-funder attribution) | 1–2 credits | 6 requests | **13** | 2–5 |

The worst case is within the 15-call cap, but leaves little room for retries. To make room,
drop Arbitrum from step 8 or Base from step 5.

**Budget against the free tiers:**

- **Nansen Free:** 100 trial credits cover about 50 linked-wallet underwritings; after that
  the daily top-up allows about 5 a day. `cre workflow simulate` executes on one machine,
  so each call is paid once. On a deployed DON **without** `cacheSettings`, multiply by the
  node count. Ask Nansen for hackathon credits (plan §3.4).
- **Zerion Developer:** 2,000 requests a day ÷ 4–6 ≈ 330–500 underwritings a day. The 3 RPS cap
  is the real constraint if nodes don't share the cache.
- **Etherscan Free:** 3 calls per underwriting, against 100k/day at 3 calls/s.
- **RPC and EVM reads:** free.

**Ideas we priced out:**

- Adding `counterparties` (+5 credits, +$0.05) or `labels` (+100 credits) makes each
  underwriting 3–50× more expensive for a marginal signal.
- `pnl-summary` isn't a `Facts` field.

### 7.2 Calling the APIs from CRE

These are the verified CRE APIs:

- `HTTPClient.sendRequest(nodeRuntime, req).result()`
- `runtime.runInNodeMode(fn, consensusIdenticalAggregation<T>())().result()`
- `nodeRuntime.getSecret({ id }).result().value`
- The request fields `multiHeaders`, `body` (base64), `timeout` (max `"10s"`) and
  `cacheSettings: { readFromCache, maxAgeMs ≤ 600000 }`

Sources:
- https://docs.chain.link/cre/reference/sdk/http-client-ts
- https://docs.chain.link/cre/guides/workflow/using-http-client/post-request-ts (single-execution pattern)
- https://docs.chain.link/cre/guides/workflow/secrets

```ts
import { HTTPClient, consensusIdenticalAggregation, type Runtime, type NodeRuntime } from "@chainlink/cre-sdk"

type Funder = { funder: string; name: string; chain: string; fundedAt: number } // fundedAt: unix s, 0 if none

export function nansenFirstFunder(runtime: Runtime<unknown>, address: string): Funder {
  const run = (nodeRuntime: NodeRuntime<unknown>): Funder => {
    const apiKey = nodeRuntime.getSecret({ id: "NANSEN_API_KEY" }).result().value
    const res = new HTTPClient()
      .sendRequest(nodeRuntime, {
        url: "https://api.nansen.ai/api/v1/profiler/address/first-funder",
        method: "POST",
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
          apikey: { values: [apiKey] },
        },
        body: Buffer.from(JSON.stringify({ address: address.toLowerCase(), chain: "all" })).toString("base64"),
        timeout: "10s",
        // One node fetches; the rest reuse it. Needs byte-identical requests on every node.
        cacheSettings: { readFromCache: true, maxAgeMs: 600_000 },
      })
      .result()
    if (res.statusCode !== 200) throw new Error(`nansen first-funder ${res.statusCode}`)
    const row = JSON.parse(new TextDecoder().decode(res.body as Uint8Array)).data?.[0]
    // Return small, deterministic values: consensus observations are capped at 25 KB.
    return row
      ? {
          funder: String(row.first_funder_address).toLowerCase(),
          name: row.first_funder_name ?? "",
          chain: row.chain,
          fundedAt: Math.floor(Date.parse(row.block_timestamp) / 1000), // format UNVERIFIED (§2.5.1)
        }
      : { funder: "", name: "", chain: "", fundedAt: 0 }
  }
  return runtime.runInNodeMode(run, consensusIdenticalAggregation<Funder>())().result()
}
```

**For Zerion,** use the same shape with:

- `method: "GET"`, and no body
- `multiHeaders: { Authorization: { values: ["Basic " + Buffer.from(key + ":").toString("base64")] }, accept: { values: ["application/json"] } }`
- `"X-Env": { values: ["testnet"] }` for testnet calls
- A URL with the **trailing slash** and percent-encoded brackets
  (`filter%5Bchain_ids%5D=monad-test-v2`). This is how Zerion's own `links.next` encodes
  them.

**Secrets:** read the Nansen, Zerion and Etherscan keys through one `getSecrets` batch;
CRE allows 5 secret fetches per execution. Confidential HTTP (`vaultDonSecrets` with
`{{.key}}` templates) keeps keys out of node memory and makes exactly one call by design.
It's worth it after the hackathon, but I didn't verify its TypeScript request shape here.

---

## 8. Failure semantics, and the edge cases that matter

1. **Don't attest missing data as zero.** In `collect.ts` a failed source scores zero
   points. In `Facts`, zero age is adverse and zero liquidations is favourable, so a
   silent failure can hurt the borrower or hide a risk. Pick one of these:
   - **The workflow throws, so no report is sent and the app retries.** This is simplest.
   - Or add a `uint8 missingMask` to `Facts`, so `ScoreManager` applies neutral points for
     the flagged fields.

   Treat Zerion's `400 not trackable` and Nansen's empty `first-funder` as *known empty*.
   Treat 5xx, 429 and timeouts as *missing*.
2. **Warm Zerion up.** `positions/` answers a wallet's first request with a `503` and
   `Retry-After` of about 10 s. When the buyer taps *Pay in 4*, have the Polaris API make
   one `positions/` call for the Mera account and any linked wallet before it fires the HTTP
   trigger. The DON call then hits a computed wallet. The CRE HTTP trigger fires at most
   once per 30 s anyway.
3. **Wallets with thousands of transactions.** Every call in the recipe costs the same
   whatever the history length:
   - `first-funder` and `related-wallets` are single rows or pages.
   - Nonces are O(1).
   - The Zerion probes use `page[size]=1`.
   - The Etherscan logs are filtered by borrower.

   Only step 2 pages, and only for the new Mera account.
4. **Exchange hot wallets and contracts as the linked wallet:**
   - Zerion rejects them with `400 not trackable`.
   - Nansen `counterparties` limits them to 180 days and may time out. We don't call it.
   - A Safe's nonce isn't its activity.
   - Proving ownership of a contract wallet needs ERC-1271. Plan for EOAs only in the
     hackathon.
5. **One linked wallet, one Polaris account.** Otherwise a single old wallet opens many
   credit lines. `ScoreManager` (or `PolarisCollector`) should store
   `linkedWallet → user` and refuse a second link.
6. **Spoofed adverse facts.** Liquidations are counted only from allowlisted pool
   addresses (§4.3). The first funder can't be rewritten after the fact.
7. **Determinism across nodes:**
   - Build every request byte-identically: lowercase addresses, and dates from
     `runtime.now()` rounded to the minute.
   - Parse inside node mode and return small plain objects. Numbers and strings only; don't
     rely on `bigint` in consensus (**UNVERIFIED**).
8. **Nansen data is Monad *mainnet*.** A linked wallet's Monad-mainnet history counts. The
   Mera account's testnet history never reaches Nansen.

---

## 9. UNVERIFIED items (check on Day 0 with real keys)

1. Nansen `first-funder.block_timestamp` format and `first_funder_name` values for CEX
   funders.
2. The Nansen `related-wallets.relation` vocabulary, and whether the funder's related
   wallets include the wallets it funded.
3. Whether Nansen `transactions` accepts `date` ranges longer than 366 days.
4. Whether a Free-plan Nansen key can call `profiler/address/labels`.
5. Whether a paid x402 request that then fails validation is charged.
6. The Zerion `monad-test-v2` flags (`supports_transactions`, `supports_positions`) and
   whether it indexes AUSD and USDC testnet transfers.
7. Zerion transactions' newest-first order, and page sizes under 250 KB for mainnet
   wallets.
8. Whether Zerion's `positions/ only_simple` counts against the 25% DeFi quota.
9. Etherscan V2 `getLogs`: `toBlock=latest`, and full-range performance with `topic3`.
10. Aave-V3-compatible lending markets on Monad mainnet and their pool addresses.
11. That `viem`'s `erc20Abi` is available in the CRE template's pinned `viem`.

---

## 10. What Polaris should do

1. **Fix the plan's data claims** (§3.3, §3.4, Appendix A):
   - Nansen is mainnet-only. That is right as written; make it explicit that Nansen scores
     **linked history wallets only**.
   - Zerion's testnet support covers `positions/` and `transactions/`, **not `portfolio`**.
   - Write the Zerion paths with trailing slashes.
   - Nansen's free plan "tops up to a 10-credit balance daily"; it doesn't add 10 a day.
   - x402 for Nansen can settle in USDC **on Monad mainnet**. Zerion's can't.
2. **Build `cre/underwrite/` on the §7.1 recipe:**
   - 2 Nansen credits per linked wallet, and 0 for Mera-only buyers.
   - 11–13 HTTP calls and 2–5 EVM reads.
   - `cacheSettings` on every Nansen and Zerion call.
   - Keys in CRE secrets.
   - No x402 inside the DON.
3. **Port `collect.ts` to the `Facts` model** (§5.2 item 6 says "the TypeScript mirror and
   the contract agree"):
   - Replace `explorerApi` with Nansen, Zerion and Etherscan.
   - Replace the one-pool `getLogs` with Etherscan logs plus a pool allowlist.
   - Change `defi_tenure` from a protocol count to days.
   - Map `funding_concentration` to `relatedWallets` + `exchangeFunded`, keeping
     `INFRASTRUCTURE_OUTDEGREE = 60`.
   - Drop `aave_history`, or add a field for it.
   - Score age and tenure in the same buckets the probes produce: 30, 180 and 365 days.
4. **Contract rules for `ScoreManager.underwrite`:**
   - Ignore `relatedWallets` when `exchangeFunded` is true or when it is 60 or more.
   - Decline at `priorLiquidations >= 2` and at a non-exchange cluster of 25 or more,
     keeping today's rules.
   - Refuse a reused linked wallet.
   - Keep the 15-minute freshness check on `observedAt`.
5. **Reasons in the app** (§5.5 "Every limit explains itself"): every line is backed by one
   attested fact. For example:
   - "Funded from a major exchange · +10" comes from Nansen `first-funder`, which serves the
     Nansen bounty's "beyond raw data".
   - "Wallet active for 2 years" comes from Nansen `first-funder`.
   - "No liquidations on Aave" comes from Etherscan.
   - "Using DeFi for over a year" comes from Zerion.
6. **Day 0 (§11), before writing the workflow:**
   - Create keys for Nansen (Free), Zerion (Developer) and Etherscan (Free).
   - Ask Nansen for hackathon credits.
   - Run the nine UNVERIFIED checks in §9 against one known CEX-funded wallet, one sybil-ish
     wallet and one fresh Mera account.
   - Record real responses as fixtures for the TypeScript mirror's tests.
7. **Budget a real-money fallback.** If Nansen credits run out during judging, the app's
   pre-check (not the DON) can pay per call over x402 from a small Monad-mainnet USDC
   wallet. $0.02 covers one linked-wallet check, and the first 100 calls are half price
   with `X-Payer-Address`.
