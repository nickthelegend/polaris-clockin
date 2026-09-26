# Envio HyperIndex on Monad testnet: research for Polaris

Researched Sat 26 Sep 2026 for `docs/plan.md` §3 (the Envio bounty row), §3.3
(the CRE candidate list), §3.4 (Envio stack-on), §5.1 (architecture), §5.6
("Paid" only from indexed events), §5.7 (dashboard), §5.8 (webhooks) and §6
item 10.

**How this was verified.** Every claim comes from one of:

- the npm tarball `envio-3.12.1.tgz` (`index.d.ts`, `evm.schema.json`,
  `src/*.res`);
- the `enviodev/hyperindex` source at tag
  [`v3.12.1`](https://github.com/enviodev/hyperindex/tree/v3.12.1);
- the raw markdown of the docs (`https://docs.envio.dev/docs/<path>.md`),
  fetched 26 Sep 2026;
- a command I ran (listed at the end).

Anything else is marked **UNVERIFIED**. No `envio` command was executed: the
CLI has no Windows build, and the WSL distro on this machine has no Linux Node
yet (§3). The example in §10 was validated against the config JSON schema and
typechecked against the real `envio@3.12.1` types, but not run.

---

## 0. What changes for the plan

1. **HyperIndex is on V3 (released May 2026), and V3 renamed the things the
   task and plan name.** `networks:` is now `chains:`.
   `Contract.Event.handler(...)` is now `indexer.onEvent({ contract, event }, handler)`.
   Loaders are removed. Preload is always on, so **every handler runs twice**.
   The `generated/` package is gone; you import everything from `"envio"`.
2. **The `envio` CLI has no Windows build.** `init`, `codegen`, `test` and
   `dev` all need Linux or macOS, so on Windows they run in WSL2 (or Linux CI).
   Docker is needed only for `envio dev`.
3. **`ENVIO_API_TOKEN` is mandatory** for any local run that reads HyperSync,
   and for non-interactive `init`. Envio Cloud deployments don't need it.
4. **The free Cloud plan has more limits than the 30 days in the plan.** It
   also has soft limits: 100,000 events, 5 GB, or **7 days with no requests**.
   Hitting one starts a 7-day grace period, then 3 days read-only, then
   deletion. Each indexer holds at most 3 deployments. The free endpoint is
   public, because API-key auth needs a paid plan.
5. **`envio init` runs a plain `pnpm install` in the new folder.** Inside our
   pnpm workspace that installs the workspace root, not the indexer (tested,
   §4). Keep the indexer outside the workspace globs and install it with
   `pnpm install --ignore-workspace`.
6. **A docs example is wrong for 3.12.1.** `field_selection.block_fields: [timestamp]`
   in `config.yaml` is rejected by the schema, because `number`, `timestamp`
   and `hash` are always included there. In the handler's `fields` option it's
   the other way round: only `block.number` is implicit, and you must list
   `timestamp` (§5, §7).
7. **Monad testnet is a first-class HyperSync chain.** Its height trailed the
   public RPC by 0 to 3 blocks (median 2, about 0.8 s) over 12 parallel samples.

---

## 1. Packages and versions verified

| Package | Version | How verified |
|---|---|---|
| `envio` (HyperIndex CLI + runtime) | **3.12.1** = npm `latest` (GitHub release 2026-09-18). `3.13.0` is on npm's `next` tag; GitHub marks it released 2026-09-23 | `npm view envio version dist-tags`; `npm pack envio@3.12.1` |
| Native addons (optional deps of `envio`) | `envio-linux-x64`, `-linux-x64-musl`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`, all 3.12.1. **No win32.** (`envio-win32-x64` exists but is a 2023 placeholder at 0.0.4) | `package.json` in the tarball; `npm view envio-win32-x64` |
| `envio-cloud` (hosted-service CLI) | **1.0.0**. Ships `@envio-dev/envio-cloud-win32-x64`, so it runs on native Windows | `npm view envio-cloud@1.0.0 optionalDependencies` |
| `@envio-dev/hypersync-client` | 1.4.1 (not needed; HyperIndex uses HyperSync itself) | `npm view` |
| Node | `envio` declares `engines.node >=22.0.0`; Cloud "strongly" recommends 24+ | tarball `package.json`; hosted-service-deployment doc |
| `init` template dev deps | `typescript 6.0.3`, `vitest 4.1.0`, `@types/node 24.12.2` | `packages/cli/src/hbs_templating/init_templates.rs` @ v3.12.1 |
| Local Docker images used by `envio dev` | `postgres:18.3`, `hasura/graphql-engine:v2.43.0` | `packages/cli/src/docker_env.rs` @ v3.12.1 |

3.13.0's headline change is automatic multiprocess indexing, which doesn't
matter at our volume. **Pin `"envio": "3.12.1"` exactly.** Envio Cloud rejects
ranges anyway (§9).

---

## 2. HyperSync on Monad testnet, and the API token

Source: https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks

| Network | Chain ID | HyperSync | HyperRPC |
|---|---|---|---|
| Monad Testnet | 10143 | `https://monad-testnet.hypersync.xyz` or `https://10143.hypersync.xyz` | `https://monad-testnet.rpc.hypersync.xyz` or `https://10143.rpc.hypersync.xyz` |
| Monad | 143 | `https://monad.hypersync.xyz` or `https://143.hypersync.xyz` | `https://monad.rpc.hypersync.xyz` or `https://143.rpc.hypersync.xyz` |

The CLI knows the chain as `monad-testnet` (`HypersyncChain` in
`packages/cli/src/config_parsing/chain_helpers.rs` @ v3.12.1). Monad has no
built-in `max_reorg_depth` there, so the runtime default of 200 blocks applies
(`Config.res`: `maxReorgDepth->Option.getOr(200)`).

In HyperIndex, HyperSync is the default source for supported chains, so
`config.yaml` needs no `rpc` entry.

Checked live on 26 Sep 2026:

```bash
curl -s https://monad-testnet.hypersync.xyz/height
# {"height":65852691}      (no token needed for /height)

curl -s -X POST https://monad-testnet.hypersync.xyz/query -H 'Content-Type: application/json' \
  -d '{"from_block":65817000,"to_block":65817002,"logs":[{"address":["0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"]}],"field_selection":{"log":["block_number","address"]}}'
# HTTP 401 {"error":"Your token is malformed. API Tokens can be created at https://app.envio.dev/api-tokens. For more info: https://docs.envio.dev/docs/HyperSync/api-tokens."}
```

### 2.1 API token requirements

Source: https://docs.envio.dev/docs/HyperSync/api-tokens

- "An API token is required for HyperSync and HyperRPC. Requests without a
  token are rejected with HTTP 401. Indexers deployed to Envio Cloud have
  special access to HyperSync that does not require a custom API token."
- Create one at https://envio.dev/app/api-tokens (sign-in required).
- Limits are a per-token budget per 60-second window, shared across chains.
  Over budget, the server returns HTTP 429 until the window resets.
- The pricing page (https://envio.dev/pricing/hypersync) lists:
  - Free: "Fair-use based rate limiting" (the exact number is **UNVERIFIED**)
  - 100 rpm, bursting to 250
  - 1,000 rpm, bursting to 2,500
- Errors:
  - 401 `Your token is malformed`: no token was sent
  - 403 `unknown or pending activation`: the token isn't active
  - 403 `does not have access to this product`: e.g. the token doesn't cover HyperRPC

HyperIndex reads the token from **`ENVIO_API_TOKEN`**. Without it, building
the HyperSync source throws. From `packages/envio/src/sources/HyperSync.res`
(tarball, 3.12.1):

```text
An Envio API token is required for using HyperSync as a data-source.
Set the ENVIO_API_TOKEN environment variable in your .env file.
Learn more or get a free Envio API token at: https://envio.dev/app/api-tokens
```

Where it's needed and where it isn't:

- **Not needed for simulate-only tests.** `createTestIndexer` with `simulate`
  swaps the chain's source for a `SimulateSourceConfig`
  (`SimulateItems.res`, `patchConfig`), so the HyperSync source is never built.
  That's from reading the source; I didn't run it.
- **Needed for non-interactive `init`** when the chain uses HyperSync. It
  bails with "Running non-interactively but no Envio API token was provided"
  (`packages/cli/src/cli_args/interactive_init/mod.rs` @ v3.12.1).

`.env` (source: https://docs.envio.dev/docs/HyperIndex/environment-variables):

```bash
# Envio API Token (required for HyperSync access)
ENVIO_API_TOKEN=your-secret-token
```

Our root `.gitignore` already ignores `.env` at any depth.

---

## 3. Running locally on Windows: WSL, Docker, commands

### 3.1 What needs what

| Command | Linux or macOS | Docker | `ENVIO_API_TOKEN` |
|---|---|---|---|
| `envio init ...` (non-interactive) | yes | no | yes (HyperSync chains) |
| `envio codegen` | yes | no | no |
| `pnpm test` (`createTestIndexer` + `simulate`, in-memory) | yes | no | no, per source (§2.1) |
| `pnpm test` against real blocks (`startBlock`/`endBlock`, or auto-detect) | yes | no | yes |
| `envio dev` | yes | **yes** (Postgres + Hasura) | yes |
| `envio start` (production; you supply Postgres through `ENVIO_PG_*`) | yes | no | yes |
| `envio-cloud ...` | **no**, has a win32 binary | no | no |

**Why the CLI can't run on Windows.** Every `envio` subcommand starts in
`src/Bin.res`, which calls `Core.runCli`. That loads a Rust addon from
`envio-{os}-{arch}`. The candidate list has no Windows entry, so on `win32`
`src/Core.res` (tarball, 3.12.1) throws:

```text
envio doesn't support win32-x64. Supported: linux-x64 (glibc/musl), linux-arm64, darwin-x64, darwin-arm64.
```

The docs agree. Source: https://docs.envio.dev/docs/HyperIndex/quickstart,
"Prerequisites":

- Node.js (v22 or newer recommended)
- pnpm (recommended but not required)
- Docker Desktop: "Docker is only required if you plan to run your indexer
  locally ... Podman also works"
- "Additionally for Windows Users: WSL"

**How `envio dev` finds Docker.** It talks to the Docker Engine API through the
`bollard` crate over a Unix socket (`docker_env.rs`). It tries the default
socket, `~/.docker/run/docker.sock`, `~/.docker/desktop/docker.sock` and the
Podman sockets. Inside WSL that means Docker Desktop's **WSL integration must
be on for the distro**, so that `/var/run/docker.sock` exists there.

### 3.2 This machine (observed 26 Sep 2026)

- WSL2 distro `microduck` (Ubuntu 24.04.5), plus `docker-desktop`.
- **No Linux Node inside WSL.** `node` isn't found, and `which pnpm` resolves
  to the Windows shim `/mnt/c/nvm4w/nodejs/pnpm`. Install Node 22+ (24
  recommended) and pnpm *inside* WSL, and put them before the Windows shims on
  `PATH`.
- Docker Desktop 29.1.3 is installed but its engine wasn't running.
  `/var/run/docker.sock` doesn't exist inside `microduck`, and `docker` there
  resolves to the Windows binary. So **WSL integration is not enabled for
  `microduck` yet**. Turn it on in Docker Desktop, Settings, Resources, WSL
  integration.
- The indexer's `node_modules` must be created by *Linux* pnpm. A Windows
  install skips `envio-linux-x64` because of its `os` field.
- Working from `/mnt/e/...` should work, but it's slower, and file watching
  across the Windows/Linux boundary is unreliable. That's general WSL
  behaviour and **UNVERIFIED** for Envio. If hot reload misbehaves, clone the
  repo inside the WSL filesystem.

### 3.3 Commands

Source: https://github.com/enviodev/hyperindex/blob/v3.12.1/packages/cli/CommandLineHelp.md
(also https://docs.envio.dev/docs/HyperIndex/cli-commands).

| Command | What it does |
|---|---|
| `envio codegen` (`pnpm codegen`) | Writes `.envio/types.d.ts` and the root `envio-env.d.ts` shim. Run it after changing `config.yaml`, `schema.graphql` or ABIs |
| `envio dev [-r]` (`pnpm dev`) | Runs codegen, starts Docker Postgres + Hasura, indexes, hot-reloads handler files. `-r` clears the database and re-indexes from scratch |
| `envio start [-r]` (`pnpm start`) | Production run. Runs codegen, then indexes against the Postgres in `ENVIO_PG_*` |
| `envio stop` | Deletes the database and stops all processes, including Docker, for the current folder |
| `envio local docker up` / `down` | Postgres + Hasura only |
| `envio local db-migrate up` / `down` / `setup` | Schema migrations |
| `envio config view` | Prints the resolved config |
| `envio metrics [runtime]` | Prometheus metrics from the running indexer |
| `envio tools search-docs <q>` / `fetch-docs <url>` | Docs search from the terminal |

Global options: `-d/--directory <DIR>` (project folder) and
`--config <FILE>` (env `ENVIO_CONFIG`, default `config.yaml`).

Hot reload covers handler files only. For changes to config, schema or ABI,
restart with `pnpm envio start -r` (source:
https://docs.envio.dev/docs/HyperIndex/running-locally).

The package scripts `init` writes, from `init_templates.rs` @ v3.12.1:

```json
"scripts": {
  "codegen": "envio codegen",
  "dev": "envio dev",
  "start": "envio start",
  "test": "vitest run --test-timeout=20000"
}
```

### 3.4 Local ports and credentials

Sources: https://docs.envio.dev/docs/HyperIndex/navigating-hasura,
https://docs.envio.dev/docs/HyperIndex/observability, and `docker_env.rs` and
`src/Env.res` @ v3.12.1.

- **Hasura:** console at `http://localhost:8080`, GraphQL at
  `http://localhost:8080/v1/graphql`.
  - Admin secret `testing`.
  - Requests without the secret run as role `public`
    (`HASURA_GRAPHQL_UNAUTHORIZED_ROLE=public`), which can select every
    column.
  - Aggregates are off for `public` unless `ENVIO_HASURA_PUBLIC_AGGREGATE`
    lists the entity.
- **Postgres:** host port **5433** (`ENVIO_PG_PORT`); the container listens
  on 5432.
- **Indexer HTTP server:** port **9898** (`ENVIO_INDEXER_PORT`), serving
  `/metrics`, `/metrics/runtime` and `/healthz`.
- **Numbers as strings:** local Hasura sets
  `HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true`, so `BigInt` values come back
  as JSON strings.
- **TUI:** `ENVIO_TUI=false` turns it off. It's also off automatically when
  stdout isn't a TTY, under `CI`, under AI agents, or with `TERM=dumb`.

---

## 4. Non-interactive `init` from an ABI

Sources: `CommandLineHelp.md` @ v3.12.1, plus these files under
`packages/cli/src/` @ v3.12.1: `cli_args/clap_definitions.rs`,
`cli_args/interactive_init/{mod.rs,evm_prompts.rs}`,
`cli_args/init_config.rs`, `executor/init.rs`, `commands.rs`, `evm/abi.rs`.

**Flags.** Most are declared `global = true`, so they can go after the
subcommand:

| Flag | Meaning |
|---|---|
| `-d/--directory` | Where to create the project |
| `-n/--name` | Project name |
| `-l/--language` | `typescript` or `rescript` |
| `--package-manager` | `pnpm` (default), `npm`, `yarn` or `bun` |
| `--api-token` | Falls back to env `ENVIO_API_TOKEN` |
| `-c/--contract-address` | Contract address |

`init contract-import local` adds:

| Flag | Meaning |
|---|---|
| `-a/--abi-file` | Path to the JSON ABI |
| `--contract-name` | Contract name |
| `-b/--blockchain` | Chain name or ID |
| `-r/--rpc-url` | Only for chains without HyperSync |
| `-s/--start-block` | Only for chains without HyperSync |
| `--single-contract` | Don't ask for more contracts |
| `--all-events` | Import every event without asking |

**How non-interactive mode works** (from `executor/init.rs`):

- **It's detected automatically:** when stdout isn't a TTY, or when
  `CLAUDECODE`, `CI` or `TERM=dumb` is set. `ENVIO_TUI=false|0` forces it on,
  and `ENVIO_TUI=true|1` forces it off.
- **Required inputs:** it bails without `-d` or an API token.
- **A bare `envio init`** just prints an agent prompt and exits. That prompt
  suggests `pnpx envio init contract-import explorer -n … -c … -b … --single-contract --all-events -d …`,
  which fetches a verified ABI from a block explorer.
- **Always pass `--all-events` and `--single-contract`.** Without them it
  opens interactive prompts, and the non-interactive path imports exactly one
  contract.

Our contracts will be freshly deployed, so use the **local ABI** form. I
assembled this command from the documented flags; it was **not executed**:

```bash
# inside WSL, in a scratch folder OUTSIDE the pnpm workspace
ENVIO_API_TOKEN=... pnpx envio@3.12.1 init contract-import local \
  -a ./PolarisPayments.json \
  --contract-name PolarisPayments \
  -b monad-testnet \
  -c 0xYourDeployedAddress \
  --single-contract --all-events \
  -n polaris-indexer -l typescript --package-manager pnpm \
  -d polaris-indexer
```

What it produces, per the source:

- **ABI input:** `-a` accepts a plain ABI array **or a Hardhat/Foundry
  artifact** (`{ "abi": [...] }`, the `AbiOrNestedAbi::NestedAbi` case).
  `packages/contracts/artifacts/.../PolarisPayments.json` works as-is.
- **`config.yaml`:**
  - event **signatures written inline** (no `abi_file_path`; only Fuel
    vendors an ABI file);
  - `disable_default_cross_chain: true`;
  - **`start_block: 0`** on HyperSync chains. `-s` only applies to chains
    without HyperSync.
- **`schema.graphql`:** one entity per event, named `<Contract>_<Event>`. An
  event param called `id` becomes `event_id`.
- **Other files:**
  - `src/handlers/<Contract>.ts` and `src/indexer.test.ts`
  - `.env` (with the token), `package.json` (§3.3) and `tsconfig.json`
  - a GitHub Actions test workflow and `.claude/skills/*`
- **Then it runs**, in order: codegen, a plain **`<pm> install`** in the
  project folder, and `git init` unless the folder is already inside a git
  repo.

**The install step is a trap in our repo.** I tested it with pnpm 10.33.0 in a
scratch workspace with the same shape as ours (`packages: ["packages/*"]`):

- Plain `pnpm install` inside a non-member folder reported "Scope: all 2
  workspace projects". It installed the workspace root and created **no**
  `node_modules` in the folder.
- `pnpm install --ignore-workspace` in the same folder installed its
  dependencies locally, with its own `pnpm-lock.yaml`.

---

## 5. `config.yaml` format (V3)

Sources:

- https://docs.envio.dev/docs/HyperIndex/configuration-file
- https://docs.envio.dev/docs/HyperIndex/config-schema-reference
- https://docs.envio.dev/docs/HyperIndex/migrate-to-v3
- the JSON schema shipped in the package, `node_modules/envio/evm.schema.json`

**Top-level keys** in `evm.schema.json` 3.12.1 (`additionalProperties: false`;
`name` and `chains` required):

- `name`, `description`
- `schema` (path to `schema.graphql`), `handlers` (handler folder)
- `contracts`, `chains`
- `field_selection`, `raw_events`
- `address_format` (`checksum` | `lowercase`), `bytes_type` (`hex` | `uint8array`)
- `disable_default_cross_chain`, `rollback_on_reorg`, `save_full_history`
- `full_batch_size`, `storage`, `ecosystem`

**V2 names are rejected** (source: migrate-to-v3, "Step 4"):

- `networks` is now `chains`
- `confirmed_block_threshold` is now `max_reorg_depth`
- `rpc_config` is now `rpc`
- `loaders`, `preload_handlers`, `unordered_multichain_mode` and `output` are
  removed

I checked this with ajv against the 3.12.1 schema. A V2-style file with
`networks:` fails with "must have required property 'chains'" and "must NOT
have additional properties (networks)".

**Canonical example.** Source: https://docs.envio.dev/docs/HyperIndex/configuration-file

```yaml
# yaml-language-server: $schema=./node_modules/envio/evm.schema.json
name: erc20-indexer
description: ERC-20 Indexer
contracts:
  - name: ERC20
    events:
      - event: "Approval(address indexed owner, address indexed spender, uint256 value)"
      - event: "Transfer(address indexed from, address indexed to, uint256 value)"
chains:
  - id: 1 # Ethereum Mainnet
    start_block: 0
    contracts:
      - name: ERC20
        address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" # UNI
  - id: 100 # Gnosis Mainnet
    start_block: 0
    contracts:
      - name: ERC20
        address: "0x4537e328Bf7e4eFA29D05CAeA260D7fE26af9D74" # UNI
```

**`contracts`** (top level; `$defs/GlobalContract`). Each entry defines a
contract once:

- `name` and `events` are required.
- `abi_file_path` and `handler` are optional.

**`events`** (`$defs/EventConfig`):

- `event` is required. Either a human-readable signature (recommended) or an
  event name when `abi_file_path` is set.
- `name` is optional and renames the event.
- `field_selection` is optional.

Source: configuration-file doc, "Using an ABI File":

```yaml
contracts:
  - name: Greeter
    abi_file_path: ./abis/greeter.json
    events:
      - event: NewGreeting # signature comes from the ABI file
```

**`chains`** (`$defs/Chain`): `id` and `start_block` are required.

- **`start_block`**:
  - A number, or since v3.11 the literal `latest` (resolved once at first
    deploy and stored).
  - "Setting it to `0` is a safe default for HyperSync - it will automatically
    skip ahead to the first block that contains data."
  - A chain on `latest` can't carry per-contract `start_block` overrides.
- **Optional keys:** `end_block`, `rpc`, `hypersync_config: { url }`,
  `max_reorg_depth`, `block_lag` (default 0), `skip` and `contracts`.

**`chains[].contracts`** (`$defs/ChainContract`): `name` is required. Optional:

- `address`: a string or a list
- a per-contract `start_block`
- inline `events` / `abi_file_path` / `handler`

Addresses may be checksummed or lowercase.

Source: configuration-file doc, "Multiple addresses for the same contract":

```yaml
chains:
  - id: 1
    start_block: 0
    contracts:
      - name: MyContract
        address:
          - "0xAddress1"
          - "0xAddress2"
```

**Field selection.** By default `event.block` has `number`, `timestamp` and
`hash`, and `event.transaction` is empty. Since v3.7 the recommended way to
get more is the handler's `fields` option (§7). The config-level form still
works, but it applies to every handler of the event. Source: configuration-file
doc, "Global Field Selection":

```yaml
field_selection:
  transaction_fields:
    - hash
    - gasUsed
  block_fields:
    - parentHash
```

> **Gotcha, verified against the schema and the Rust source.** The
> configuration-file doc shows `block_fields: [timestamp]` under an event.
> The 3.12.1 `BlockField` enum doesn't contain `number`, `timestamp` or `hash`,
> because they're always included (`human_config.rs`, `pub enum BlockField`).
> ajv rejects the doc's snippet: "must be equal to one of the allowed
> values". List only non-default fields such as `parentHash`, `miner` or
> `baseFeePerGas` in `block_fields`. Transaction fields are all selectable:
> `hash`, `from`, `to`, `gasUsed`, `transactionIndex`, `status` and so on.

**RPC** is optional on HyperSync chains. Roles are `sync`, `realtime` and
`fallback`. Source: configuration-file doc, "RPC":

```yaml
chains:
  - id: 1
    rpc:
      - url: https://eth-mainnet.your-rpc-provider.com
        for: sync
      - url: wss://eth-mainnet.your-rpc-provider.com
        for: realtime
      - url: https://fallback.example.com
        for: fallback
```

**Other options that matter to us** (source: configuration-file doc):

- **`address_format: lowercase`** lowercases every address the indexer
  surfaces: event params, `srcAddress`, contract addresses and ids.
- **`disable_default_cross_chain: true`** (v3.6) makes entities per-chain,
  with a composite `(id, chainId)` primary key. It reserves the `chainId`
  column, and `@crossChain` opts an entity back into sharing.
- **`block_lag: N`** trades head latency for reorg safety.
- **Env interpolation** (`${ENVIO_VAR}`, `${ENVIO_VAR:-default}`) works
  anywhere in the file. On Envio Cloud every variable must start with
  `ENVIO_`.

Source: configuration-file doc, "Environment Variables":

```yaml
chains:
  - id: ${ENVIO_CHAIN_ID:-ethereum-mainnet}
    contracts:
      - name: Greeter
        address: "${ENVIO_GREETER_ADDRESS}"
```

---

## 6. `schema.graphql` entity conventions

Source: https://docs.envio.dev/docs/HyperIndex/schema

- **Entities.** Each `type X { … }` is an entity: a Postgres table, a
  TypeScript type (`Entity<"X">` or `import type { X } from "envio"`) and a
  GraphQL root field `X`.
- **`id`.** Every entity needs a non-null, non-list `id` of type `ID!`,
  `String!`, `Int!` or `BigInt!`. Numeric ids arrived in v3.5.
- **Scalars → TypeScript:**

  | GraphQL | TypeScript |
  |---|---|
  | `ID`, `String` | `string` |
  | `Int` (**signed 32-bit**) | `number` |
  | `Float` | `number` |
  | `Boolean` | `boolean` |
  | `Bytes` | hex `string` by default, or `Uint8Array` with `bytes_type: uint8array` |
  | `BigInt` | `bigint` |
  | `BigDecimal` | bignumber.js `BigDecimal`, exported from `envio` |
  | `Timestamp` | `Date` |
  | `Json` | `Json` |

  Optional fields are `T | undefined`.
- **Event params in handlers** (`evm/abi.rs` and codegen @ v3.12.1):
  - **every `uintN`/`intN` is `bigint`**, even `uint32`
  - `address` is `Address`, i.e. `` `0x${string}` ``
  - `bytes`, `bytesN` and `string` are `string`
  - `bool` is `boolean`

  Convert with `Number(...)` to store in an `Int!` field.
- **Relationships:**
  - Declare `merchant: Merchant!`, and in handlers set **`merchant_id`** to
    the referenced id.
  - Declare the reverse with `payments: [Payment!]! @derivedFrom(field: "merchant")`.
    It's virtual: it exists only in GraphQL.
- **Indexes:**
  - Put `@index` on fields that GraphQL clients filter or sort by.
  - `id` fields and `@derivedFrom` targets are indexed automatically.
  - Since v3.5, `getWhere` in handlers creates the indexes it needs.
- **Enums** become string unions: `"USER" satisfies Enum<"AccountType">`.
- **`@internal`** (v3.8) keeps an entity out of GraphQL but usable in
  handlers. An exposed entity can't reference an internal one.
- **Precision:** `@config(precision: 76)` on `BigInt`, and
  `@config(precision: 10, scale: 2)` on `BigDecimal`.
- **Documentation:** string descriptions (`"…"`) appear in introspection;
  `#` comments don't. Use camelCase field names.
- **Reserved words** from JS, TS and ReScript are rejected by codegen
  (`EE210`). That includes **`type`**, so name a field `kind` instead (source:
  https://docs.envio.dev/docs/HyperIndex/reserved-words).

Source: schema doc, "Relationships: One-to-Many":

```graphql
type NftCollection {
  id: ID!
  contractAddress: Bytes!
  name: String!
  symbol: String!
  maxSupply: BigInt!
  currentSupply: Int!
  tokens: [Token!]! @derivedFrom(field: "collection")
}

type Token {
  id: ID!
  tokenId: BigInt!
  collection: NftCollection!
  owner: User!
}
```

---

## 7. TypeScript handler API (V3)

Sources:

- https://docs.envio.dev/docs/HyperIndex/event-handlers
- https://docs.envio.dev/docs/HyperIndex/migrate-to-v3
- https://docs.envio.dev/docs/HyperIndex/preload-optimization
- https://docs.envio.dev/docs/HyperIndex/loaders
- `node_modules/envio/index.d.ts` (3.12.1)

### 7.1 Registration

Files under `src/handlers/` are loaded automatically. They're ES modules, so
`package.json` needs `"type": "module"` and top-level `await` works.

Source: event-handlers doc, "Registration":

```typescript
import { indexer } from "envio";

indexer.onEvent(
  { contract: "<CONTRACT_NAME>", event: "<EVENT_NAME>" },
  async ({ event, context }) => {
    // Your logic here
  },
);
```

**The V2 API in the task is removed.** Source: migrate-to-v3, "Rename and
removal cheat sheet":

| V2 (removed) | V3 |
|---|---|
| `Contract.Event.handler(...)` | `indexer.onEvent({ contract, event, ...options }, handler)` |
| `Contract.Event.contractRegister(...)` | `indexer.contractRegister({ contract, event }, handler)` |
| `onBlock({ chain, ... }, handler)` | `indexer.onBlock({ name, where? }, handler)` |
| `context.add<Contract>(addr)` | `context.chain.<Contract>.add(addr)` |
| `eventFilters` option | `where` callback returning `{ params: [...] }` |
| `experimental_createEffect` | `createEffect` |
| `import ... from "generated"` | `import ... from "envio"` |
| `MockDb` in tests | `createTestIndexer()` with `simulate` |

### 7.2 Loaders are gone, and handlers run twice

Source: https://docs.envio.dev/docs/HyperIndex/loaders

> The `handlerWithLoader` API and the `loaders` flag in `config.yaml` were
> removed in HyperIndex V3. Preload Optimization is now always on.

Source: https://docs.envio.dev/docs/HyperIndex/preload-optimization.

1. **Preload phase.** "All event handlers run concurrently for the whole batch
   of events. During the phase all DB write operations are skipped and only
   DB read operations and external calls are performed."
2. **Processing phase.** Handlers run sequentially in on-chain order, reading
   from the in-memory store.

Consequences:

- **Never call `fetch`, send a webhook or write to another system directly
  in a handler.**
- Use the Effect API, or guard with `context.isPreload`.
- Put reads such as `get` and `getWhere` at the top of the handler, so the
  preload phase can batch them.

### 7.3 The event object

Source: event-handlers doc, "Event Object".

- `event.params.<name>`
- `event.chainId`, `event.contractName`, `event.eventName`
- `event.srcAddress` (EIP-55 checksummed unless `address_format: lowercase`)
- `event.logIndex`
- `event.block`: by default `number`, `timestamp` and `hash`
- `event.transaction`: empty by default

Selecting fields inline (v3.7+). Source: event-handlers doc, "Selecting Block
and Transaction Fields":

```typescript
indexer.onEvent(
  {
    contract: "MyContract",
    event: "Transfer",
    fields: { transaction: ["hash", "from"], block: ["timestamp"] },
  },
  async ({ event, context }) => {
    event.transaction.hash; // string
    event.block.timestamp; // number
    event.transaction.gasUsed; // Type error - not listed in fields
  },
);
```

> Verified with `tsc` 6.0.3 against `index.d.ts` 3.12.1. Once `fields` is
> given, **only `block.number` stays implicit**
> (`EvmAlwaysSelectedBlockField = "number"`). Dropping `"timestamp"` from the
> list makes `event.block.timestamp` a type error:
> `FieldNotSelected<"Field 'timestamp' is not selected for this handler. Add it to fields.block …">`.
> The list must be a literal array, or declared `as const`.

### 7.4 `context.<Entity>` operations

The type, as declared in `node_modules/envio/index.d.ts` (envio 3.12.1):

```typescript
type EntityOperations<Entity> = {
  readonly get: (id: EntityId<Entity>) => Promise<Entity | undefined>;
  readonly getOrThrow: (id: EntityId<Entity>, message?: string) => Promise<Entity>;
  readonly getWhere: (filter: GetWhereFilter<Entity>) => Promise<Entity[]>;
  readonly getOrCreate: (entity: Entity) => Promise<Entity>;
  readonly set: (entity: Entity) => void;
  readonly deleteUnsafe: (id: EntityId<Entity>) => void;
};
```

- `set` and `deleteUnsafe` are synchronous: in-memory, no `await`. Entity
  objects are read-only, so update with a spread:
  `context.X.set({ ...x, field: v })`.
- `getOrCreate(defaults)` returns the existing row, or sets and returns
  `defaults`.
- `getWhere` takes the operators `_eq`, `_gt`, `_gte`, `_lt`, `_lte` and
  `_in`. Several fields are ANDed (v3.2+).

Source: event-handlers doc, "Retrieving Entities by Field":

```typescript
const accounts = await context.Account.getWhere({
  id: { _eq: event.params.account },
  balance: { _gte: 1_000_000n, _lte: 10_000_000n },
});
```

The context also has:

- `context.log.{debug,info,warn,error}` (these show up in Cloud logs)
- `context.effect(effect, input)`
- `context.isPreload`
- `context.chain.id`, `context.chain.isRealtime`
- `indexer.chains[chainId].{startBlock, isRealtime, <Contract>.addresses}`

### 7.5 External calls (Effect API)

This snippet comes from the event-handlers doc, "`context.effect`". I added
`async` to the effect handler, because the doc omits it and `index.d.ts`
requires the handler to return a `Promise`. Note that `rateLimit` is
**required** in the type.

```typescript
import { indexer, createEffect, S } from "envio";

const getMetadata = createEffect(
  {
    name: "getMetadata",
    input: S.string,
    output: {
      description: S.string,
      value: S.bigint,
    },
    rateLimit: {
      calls: 5,
      per: "second",
    },
    cache: true,
  },
  async ({ input }) => {
    const response = await fetch(`https://api.example.com/metadata/${input}`);
    const data = await response.json();
    return {
      description: data.description,
      value: data.value,
    };
  }
);
```

Polaris shouldn't need effects if the contracts emit everything (§12).

### 7.6 Tests (Vitest, in-process, no Docker)

Source: https://docs.envio.dev/docs/HyperIndex/testing

```typescript
await indexer.process({
  chains: {
    1: {
      simulate: [
        {
          contract: "ERC20",
          event: "Transfer",
          params: { from: addr1, to: addr2, value: 100n },
        },
      ],
    },
  },
});
```

Other test APIs:

- `createTestIndexer()`
- `indexer.<Entity>.{get,getOrThrow,getAll,getWhere,set}`
- `result.changes[]`
- `TestHelpers.Addresses.{defaultAddress,mockAddresses}`

With per-chain entities, `indexer.X.get(id)` throws if the id exists on more
than one chain.

---

## 8. The GraphQL clients query

Sources:

- https://docs.envio.dev/docs/HyperIndex/query-conversion
- https://docs.envio.dev/docs/HyperIndex/navigating-hasura
- https://docs.envio.dev/docs/HyperIndex/observability
- https://docs.envio.dev/docs/HyperIndex/common-issues
- https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli

The API is Hasura's GraphQL.

### 8.1 Endpoints

- **Local:** `http://localhost:8080/v1/graphql`.
- **Envio Cloud:** a public URL per deployment.
  - The common-issues doc gives the shape
    `https://indexer.dev.hyperindex.xyz/<your-deployment-id>/v1/graphql`.
  - The websockets doc shows `https://indexer.hyperindex.xyz/123abcd/graphql`.
  - The CLI doc: "Read the URL from `deployment endpoint` rather than
    hardcoding a host - it differs per deployment."

  So keep it in an env var:

  ```bash
  # source: https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli
  envio-cloud deployment endpoint <indexer> <commit> [organisation]
  ```

### 8.2 Query shape

- **Root fields:** the root field is the **entity name, singular and
  PascalCase**, as written in the schema: `Payment(where:, order_by:, limit:, offset:)`.
  Primary-key lookup is `Payment_by_pk(id: …)`.
- **Filters:** `where: { field: { _eq | _neq | _gt | _gte | _lt | _lte | _in | _nin | _ilike } }`,
  combined with `_and`, `_or` and `_not`.
- **Sorting and paging:** `order_by: { field: asc | desc }` and `limit` /
  `offset`. The field names in `order_by` must be literals.
- **Variable types:** `String` for ID and Bytes, `numeric` for BigInt and
  BigDecimal, `Int` for Int.

Source: query-conversion doc (the Envio side of each example):

```graphql
query {
  Pool(where: {amount: {_gt: 100}}, order_by: {name: desc}, limit: 10, offset: 20) { id name }
  Pool_by_pk(id: "0x123") { value }
}

query GetTokens($amount: numeric) {
  Token(where: {amount: {_eq: $amount}}) { id amount }
}
```

Behaviour to design around:

- **No aggregates on Cloud.** Source: navigating-hasura, "Aggregations": "On
  Envio Cloud, these aggregate endpoints are intentionally not exposed … The
  recommended approach is to compute and store aggregates at indexing time."
  So keep counters and sums in entities.
- **`BigInt` comes back as a JSON string** locally
  (`STRINGIFY_NUMERIC_TYPES=true`). On Cloud this is **UNVERIFIED**, so parse
  both forms.
- **Per-chain mode changes `_by_pk`.** With `disable_default_cross_chain: true`
  the key is `(id, chainId)`. By Hasura's convention `_by_pk` then needs both
  arguments (**UNVERIFIED** on Envio), so use `where` + `limit: 1`, which
  works in either mode.
- **Address case matters.** `_eq` on strings is case-sensitive, and addresses
  are checksummed by default. Use `address_format: lowercase` and lowercase
  inputs in the gateway.

### 8.3 Indexing progress (`_meta`)

Source: observability doc, "Indexing status".

```graphql
{
  _meta {
    chainId
    progressBlock
    eventsProcessed
    bufferBlock
    firstEventBlock
    sourceBlock
    readyAt
    isReady
    startBlock
    endBlock
  }
}
```

- `progressBlock` and `eventsProcessed` are written in the **same
  transaction** as the entity data, so rows at or below `progressBlock` are
  visible when it moves.
- `sourceBlock` is the chain head as seen by the source.
- `_meta(where: { chainId: { _eq: 10143 } })` narrows to one chain.
- The envio-cloud CLI doc's example queries `_meta { chainMetadata { chainId } }`
  instead. Which shape Cloud serves is **UNVERIFIED**; the observability shape
  is documented as current.

### 8.4 Calling it from a server

Source: https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli, "Get Query
Endpoint":

```bash
curl "$(envio-cloud deployment endpoint hyperindex b3ead3a mjyoung114)" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { chainMetadata { chainId } } }"}'
```

The same request from the gateway in TypeScript. This is my translation of the
curl above into plain `fetch`, not code copied from Envio:

```typescript
export async function envioQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(process.env.ENVIO_GRAPHQL_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors) throw new Error(json.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return json.data as T;
}
```

**Subscriptions.** Swap `https` for `wss` on the same path. Source:
https://docs.envio.dev/docs/HyperIndex/websockets: "WebSocket support is
available but should be used at your own risk on plans other than dedicated …
We don't recommend relying on WebSockets for more than 10 concurrent
connections." **Poll instead.**

---

## 9. Envio Cloud: deploy flow and free-plan retention

Sources:

- https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment
- https://docs.envio.dev/docs/HyperIndex/hosted-service-billing
- https://docs.envio.dev/docs/HyperIndex/hosted-service-features
- https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli
- https://envio.dev/pricing (FAQ)

### 9.1 Deploy flow (git-based, "similar to … Vercel")

1. Log in at https://envio.dev/app/login with GitHub and pick the
   organisation.
2. Install the **Envio Deployments GitHub App** on the repo.
3. Choose Add Indexer and configure it:
   - the **Indexer Directory** (the root dir; "important for monorepos")
   - the config file path, relative to that directory
   - the deployment branch (the CLI default is `envio`)
4. Push to that branch. Each push builds a **new deployment that re-indexes
   from `start_block`**. The previous deployment keeps serving until the new
   one is synced. You can switch between versions or roll back in the
   dashboard.

The same through the CLI, which runs natively on Windows. Source: envio-cloud-cli doc.

```bash
npm install -g envio-cloud          # or: npx envio-cloud <command>
envio-cloud login                   # browser login, 30-day session
envio-cloud indexer add --name my-indexer --repo my-repo --branch main --tier development
envio-cloud indexer settings set myindexer myorg --config-file config.yaml --branch develop
envio-cloud indexer env set myindexer myorg ENVIO_API_KEY=abc123 ENVIO_DEBUG=true
envio-cloud indexer commits myindexer myorg
envio-cloud deployment deploy myindexer abc1234 myorg
envio-cloud deployment status <indexer> <commit> [organisation] --watch-till-synced
envio-cloud deployment endpoint <indexer> <commit> [organisation]
envio-cloud deployment logs myindexer abc1234 myorg --follow
envio-cloud deployment delete myindexer abc1234 myorg --yes
```

`indexer add` also takes:

| Flag | Default |
|---|---|
| `-d/--root-dir` | `./` |
| `-c/--config-file` | `config.yaml` |
| `-a/--access-type` | `public` |
| `--auto-deploy` | `true` |

`envio-cloud login --token <gh token>` (or `ENVIO_GITHUB_TOKEN`) is for CI. The
token needs the scopes `read:org`, `read:user` and `user:email`.

**Build rules that bite a monorepo** (deployment doc, "Troubleshooting"):

- **What gets uploaded:**
  - Only the **Indexer Directory** is uploaded. Imports from above it are
    missing.
  - Only committed files build. Anything gitignored or unpushed is absent.
  - Folders named **`generated` or `node_modules` are skipped at any depth**,
    and so are dotfiles and dot folders except `.npmrc`. Set env vars in the
    dashboard or CLI, not in `.env`.
- **Versions:**
  - `envio` must be in that folder's `package.json` with an **exact version**.
    `~x.y.z`, `latest` and `workspace:*` are rejected as "Invalid version".
  - The minimum is 2.21.5, and `2.29.x` is unsupported.
  - Cloud **ignores `pnpm-lock.yaml`** and resolves dependencies fresh, so pin
    exact versions. The project must work with **pnpm 10.32.0**.
- **Other:**
  - The repo must be 100 MB or less.
  - No `ENVIO_API_TOKEN` is needed on Cloud.

### 9.2 Free "Development" plan limits

Source: deployment doc, "Deployment Limits" and "Development Plan Fair Usage
Policy". The same text is in the FAQ on https://envio.dev/pricing.

| Limit | Value |
|---|---|
| Hard limits (deleted) | **Older than 30 days**, or over 20 GB of storage |
| Soft limits (whichever comes first) | **100,000 events processed**, **5 GB storage**, or **no requests for 7 days** |
| After a soft limit | **Grace period, 7 days**: works normally, and you're notified. Then **read-only, 3 days**: stops indexing, still queryable. Then **full deletion**. "Timeline Subject to Change" |
| Indexers | 3 development-plan indexers per organisation |
| Deployments | 3 per indexer (delete old ones to deploy again) |
| Endpoint security | None: IP allow-lists and API keys are "Paid plans only", and "API key authentication requires a Production tier plan or above" |
| Other paid-only features | Alerts; Effect cache (Medium and up) |
| Guarantees | "Envio makes no guarantees regarding uptime, availability, or data persistence for deployments on the development plan" |

"Indexing hours": the pricing page says "Each plan includes 800 indexing hours
per month" and that one deployment for a full month uses about 730. Whether
that limits the free plan is **UNVERIFIED**.

---

## 10. Minimal working example: one contract

`PolarisPayments.PaymentMade` on Monad testnet. The event signature is copied
from `packages/contracts/contracts/PolarisPayments.sol`:

```solidity
event PaymentMade(bytes32 indexed paymentId, address indexed payer, address indexed merchant, uint256 amount, uint256 fee, string orderId);
```

**Verified:**

- `config.yaml` validates against `evm.schema.json` 3.12.1 (ajv 8, draft
  2020-12).
- The handler and test typecheck with **TypeScript 6.0.3** (the template's
  version), using the template `tsconfig.json` and the real `envio@3.12.1`
  `index.d.ts`. That run used a hand-written stand-in for
  `.envio/types.d.ts`, modelled on the v3.12.1 codegen snapshot.
- Two negative checks behaved as expected: an unselected field and an unknown
  entity field were both rejected.

**Not verified:** `envio codegen`, `pnpm test` and `envio dev` weren't run
(§3.2). Treat the example as unrun until someone runs it in WSL.

`indexer/package.json`. The shape comes from `init_templates.rs` @ v3.12.1,
with `envio` pinned exactly:

```json
{
  "name": "polaris-indexer",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "codegen": "envio codegen",
    "dev": "envio dev",
    "start": "envio start",
    "test": "vitest run --test-timeout=20000"
  },
  "devDependencies": {
    "@types/node": "24.12.2",
    "typescript": "6.0.3",
    "vitest": "4.1.0"
  },
  "dependencies": {
    "envio": "3.12.1"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

`indexer/tsconfig.json` is copied verbatim from
`packages/cli/templates/static/blank_template/typescript/tsconfig.json` @ v3.12.1:

```json
{
  /* For details: https://www.totaltypescript.com/tsconfig-cheat-sheet */
  "compilerOptions": {
    /* Base Options: */
    "esModuleInterop": true,
    "skipLibCheck": true,
    "target": "es2023",
    "allowJs": true,
    "resolveJsonModule": true,
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    /* Strictness */
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    /* For running Envio: */
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,

    /* Code doesn't run in the DOM: */
    "lib": ["es2023"],
    "types": ["node"]
  }
}
```

`indexer/.env` is gitignored by the root `.gitignore` and not used on Cloud.
The template is `blank_template/shared/.env.example` @ v3.12.1:

```bash
# To create or update a token visit https://envio.dev/app/api-tokens
ENVIO_API_TOKEN="<YOUR-API-TOKEN>"
```

`indexer/config.yaml`:

```yaml
# yaml-language-server: $schema=./node_modules/envio/evm.schema.json
name: polaris-indexer
description: Polaris payments on Monad testnet
disable_default_cross_chain: true # per-chain rows, keyed (id, chainId)
address_format: lowercase # every address the indexer surfaces is lowercase
contracts:
  - name: PolarisPayments
    events:
      - event: "PaymentMade(bytes32 indexed paymentId, address indexed payer, address indexed merchant, uint256 amount, uint256 fee, string orderId)"
chains:
  - id: 10143 # Monad testnet; HyperSync (https://monad-testnet.hypersync.xyz) is the default source
    start_block: 0 # replace with the PolarisPayments deployment block
    contracts:
      - name: PolarisPayments
        address: "0x0000000000000000000000000000000000000000" # replace with the deployed address
```

`indexer/schema.graphql`:

```graphql
type Merchant {
  id: ID! # merchant address, lowercase
  paymentCount: Int!
  grossVolume: BigInt!
  payments: [Payment!]! @derivedFrom(field: "merchant")
}

type Payment {
  id: ID! # paymentId (bytes32 hex)
  merchant: Merchant!
  payer: String! @index
  amount: BigInt!
  fee: BigInt!
  orderId: String! @index
  blockNumber: Int! @index
  timestamp: Int!
  txHash: String!
}

"One row per webhook-worthy event, in chain order"
type Activity {
  id: ID! # `${blockNumber}-${logIndex}`
  kind: String! @index # the plan's webhook type, e.g. "payment.succeeded"
  merchant: String! @index
  refId: String!
  orderId: String
  amount: BigInt!
  blockNumber: Int! @index
  logIndex: Int!
  timestamp: Int!
  txHash: String!
}
```

`indexer/src/handlers/PolarisPayments.ts`:

```typescript
import { indexer } from "envio";

indexer.onEvent(
  {
    contract: "PolarisPayments",
    event: "PaymentMade",
    // v3.7+: list the block/transaction fields this handler reads.
    // Only block.number is implicit; anything else unlisted is a type error.
    fields: { block: ["timestamp"], transaction: ["hash"] },
  },
  async ({ event, context }) => {
    const { paymentId, payer, merchant, amount, fee, orderId } = event.params;

    const m = await context.Merchant.getOrCreate({
      id: merchant,
      paymentCount: 0,
      grossVolume: 0n,
    });
    context.Merchant.set({
      ...m,
      paymentCount: m.paymentCount + 1,
      grossVolume: m.grossVolume + amount,
    });

    context.Payment.set({
      id: paymentId,
      merchant_id: merchant,
      payer,
      amount,
      fee,
      orderId,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });

    context.Activity.set({
      id: `${event.block.number}-${event.logIndex}`,
      kind: "payment.succeeded",
      merchant,
      refId: paymentId,
      orderId,
      amount,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);
```

`indexer/src/indexer.test.ts`:

```typescript
import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

describe("PolarisPayments", () => {
  it("indexes a PaymentMade", async (t) => {
    const indexer = createTestIndexer();
    const paymentId = "0x" + "11".repeat(32);
    const merchant = TestHelpers.Addresses.mockAddresses[1]!;

    await indexer.process({
      chains: {
        10143: {
          simulate: [
            {
              contract: "PolarisPayments",
              event: "PaymentMade",
              params: {
                paymentId,
                payer: TestHelpers.Addresses.defaultAddress,
                merchant,
                amount: 200_000_000n,
                fee: 1_000_000n,
                orderId: "order-1",
              },
            },
          ],
        },
      },
    });

    const payment = await indexer.Payment.getOrThrow(paymentId);
    t.expect(payment.amount).toBe(200_000_000n);
    t.expect(payment.orderId).toBe("order-1");
    const activity = await indexer.Activity.getAll();
    t.expect(activity).toHaveLength(1);
  });
});
```

Run it inside WSL (not executed here):

```bash
cd indexer
cp .env.example .env                      # then paste a real token
pnpm install --ignore-workspace           # standalone install, own lockfile
pnpm codegen                              # writes .envio/types.d.ts + envio-env.d.ts
pnpm test                                 # simulate-only: no Docker, no token needed
pnpm dev                                  # needs Docker; Hasura at http://localhost:8080 (secret: testing)
```

The dashboard query that goes with it. Hasura syntax per §8; not executed:

```graphql
query MerchantPayments($merchant: String!, $limit: Int!, $offset: Int!) {
  Payment(
    where: { merchant_id: { _eq: $merchant } }
    order_by: { blockNumber: desc }
    limit: $limit
    offset: $offset
  ) {
    id
    payer
    amount
    fee
    orderId
    timestamp
    txHash
  }
  Merchant(where: { id: { _eq: $merchant } }, limit: 1) {
    paymentCount
    grossVolume
  }
}
```

---

## 11. UNVERIFIED

1. **End-to-end run.** The §10 example was schema-validated and typechecked,
   never run. The same goes for the non-interactive `init contract-import local`
   command in §4.
2. **`_by_pk` in per-chain mode:** whether it needs both `id` and `chainId`.
3. **Cloud response shape:**
   - whether Cloud's Hasura also returns `numeric` as strings;
   - whether Cloud serves the observability `_meta` shape or the
     `chainMetadata` shape from the CLI doc;
   - whether Cloud applies a response row limit (`ENVIO_HASURA_RESPONSE_LIMIT`
     exists in `Env.res`; the Cloud value is unknown).
4. **Free-plan details:**
   - whether the free plan gets the static production endpoint and Promote;
   - what counts as a "request" for the 7-day idle rule;
   - whether a query during the grace period cancels deletion;
   - whether the 800 indexing hours apply to the free plan.
5. **HyperSync:**
   - the free plan's rate limit;
   - end-to-end head latency. HyperSync's height trailed RPC by a median 2
     blocks, the source polls every 400 ms (`HyperSync.res`), and processing
     time was not measured;
   - whether HyperSync serves Monad blocks before they're finalized.
6. **Local run on this machine:**
   - Docker Desktop WSL integration for `microduck`;
   - hot reload and speed when working from `/mnt/e`.
7. **Case of `bytes32` hex strings in `event.params`.** Assumed lowercase.

---

## 12. What Polaris should do (mapped to `docs/plan.md`)

**Fix the plan text:**

- **§3.4 and §10.** Replace "`pnpx envio init` generates the indexer from our
  ABIs" and "Local runs need Docker, which means WSL on Windows" with:
  *HyperIndex V3, `envio` 3.12.1 pinned. Every `envio` command runs in WSL2
  with Node 22+ installed inside WSL; Docker is needed only for `envio dev`;
  `ENVIO_API_TOKEN` is needed locally and not on Cloud.*
- **§3.4.** Add one line for anyone copying old tutorials: *V3: `chains:` not
  `networks:`, `indexer.onEvent` not `Contract.Event.handler`, no loaders,
  handlers run twice.*
- **§10.** Add the free plan's 7-day idle rule next to the 30-day limit.

**Day 0 (§11), role D:**

1. Create an Envio API token and put it in the team's secret store.
2. Install Node 24 and pnpm inside WSL.
3. Turn on Docker Desktop WSL integration for the distro.
4. Run `init` once in a **scratch folder outside the repo** to get the
   scaffold (tests, CI workflow, `.claude/skills`).
5. Then hand-write `indexer/`: non-interactive `init` imports one contract,
   and its install step would hit our workspace.

**Layout (§4, §6 item 1):**

- Put the indexer at repo-root `indexer/`. The root `.gitignore` already
  ignores `indexer/.envio/`.
- Keep it **out of** the `pnpm-workspace.yaml` globs, and install it with
  `pnpm install --ignore-workspace` from WSL.
- Put nothing in it that imports from `packages/*`. Cloud uploads only that
  folder.
- Write event signatures **inline** in `config.yaml`. Hardhat `artifacts/`
  are gitignored, and Cloud builds only committed files.

**One indexer, per-chain entities** (`disable_default_cross_chain: true`,
`address_format: lowercase`):

- List every contract in it: `PolarisPayments` (payments and subscriptions),
  `PolarisCheckout`, `PolarisSend`, `PolarisLoanEngine`, `MerchantRegistry`.
- The weekly and 60-second LoanEngine deployments (§5.2 item 7) share a
  contract entry: `address: [weekly, demo]`.
- Key loans and subscriptions as `${event.srcAddress}-${id}`, because the two
  deployments reuse ids.

**Contracts (§5.2): emit everything the indexer needs, so no handler needs an
`eth_call`.** Today:

- **`LoanCreated`** has no `intervalSeconds` or `startedAt`. Due dates are
  `startedAt + (i+1)·interval` (`PolarisLoanEngine.sol` line 352).
- **`InstallmentPaid`** has no next due date.
- **`SubscriptionCharged` and `ChargeMissed`** have no `nextChargeAt`.
  Skipped periods make it non-trivial to recompute.
- **`Subscribed`** has no merchant. It's reachable only through `PlanCreated`.

Add these while §5.2 is rewritten:

- `interval`/`firstDueAt` on `LoanCreated`
- `nextDueAt` on `InstallmentPaid`
- `nextChargeAt` on `Subscribed`, `SubscriptionCharged` and `ChargeMissed`
- `PolarisCheckout` emits `PlanOpened(loanId, merchant, buyer, orderId)`
- `PolarisSend` emits its full lifecycle: `Sent`, `Claimed`, `Cancelled`,
  `Refunded`

Everything indexed is public on the free plan, and so is anything on chain, so
**no PII in `orderId`**.

**Merchant dashboard (§5.7):**

- The gateway queries GraphQL server-side through `ENVIO_GRAPHQL_URL`, set
  from `envio-cloud deployment endpoint`. The URL changes per deployment.
- Keep per-merchant counters (`paymentCount`, `grossVolume`, open plans,
  at-risk exposure) in entities, because Cloud has no aggregates.

**Webhooks (§5.8):**

- **Never send from handlers.** They run twice, and rows can roll back on a
  reorg.
- The gateway tails `Activity` by `(blockNumber, logIndex)` with a cursor in
  `packages/db`, and dispatches in order.
- Set `block_lag: 2` on chain 10143. That's about 0.8 s, which is Monad's
  finality per the plan's Appendix A, so a webhook never fires for a block
  that later reorgs.

**"Paid only from indexed events" (§5.6):**

- After the relayer's receipt, the app polls the gateway for
  `Payment(where: {orderId: {_eq: $orderId}}, limit: 1)`, or waits for
  `_meta.progressBlock >= receipt.blockNumber`.
- Measure the end-to-end delay on Day 1. The parts are HyperSync's lag (about
  2 blocks), 400 ms polling, and `block_lag`. If it breaks "before the page
  could reload", tell the story as "confirmed in ~2 s" rather than weaken the
  rule.

**CRE candidate list (§3.3):**

- The `collections` workflow's HTTP call posts one query per tick. Store
  timestamps as `Int` so the variable is a plain `Int`. Not executed:

  ```graphql
  query DueCandidates($now: Int!) {
    Loan(where: { status: { _eq: "ACTIVE" }, nextDueAt: { _lte: $now } }, order_by: { nextDueAt: asc }, limit: 50) { id engine loanId nextDueAt }
    Subscription(where: { status: { _eq: "ACTIVE" }, nextChargeAt: { _lte: $now } }, order_by: { nextChargeAt: asc }, limit: 50) { id subId nextChargeAt }
  }
  ```

- The chain still disposes: CRE re-checks `isInstallmentDue` and
  `isChargeDue`.
- The §6 item 10 fallback (viem `getLogs`) stays.

**Envio Cloud schedule (§7, §10). Revise "on or after 5 Oct":**

- Deploy early for testing, deleting old deployments to stay within 3.
- Make the **final deployment at the Fri 9 Oct freeze**. With a 30-day
  lifespan it's deleted around 8 Nov, which covers 3 Nov.
- **Add a keep-alive**, because the 7-day idle rule starts deletion. The CRE
  cron covers it while it runs. After that, add a daily `_meta` query (for
  example a scheduled GitHub Action).
- Stay far below 100,000 events: index only our contracts, never AUSD
  `Transfer`.

**CI and evidence:**

- Run `pnpm test` for `indexer/` on an `ubuntu-latest` GitHub Actions job
  (the `init` scaffold ships one). That's the Windows team's check.
- For the Envio bounty (§9), link `config.yaml`, `schema.graphql`, the
  handlers, the dashboard, `Activity`-tail and `DueCandidates` queries, and
  the Cloud endpoint with a `_meta` result.

---

## Sources

Docs, raw markdown from `https://docs.envio.dev/docs/<path>.md`, fetched 26 Sep
2026:

- HyperIndex:
  - [quickstart](https://docs.envio.dev/docs/HyperIndex/quickstart)
  - [configuration-file](https://docs.envio.dev/docs/HyperIndex/configuration-file)
  - [config-schema-reference](https://docs.envio.dev/docs/HyperIndex/config-schema-reference)
  - [schema](https://docs.envio.dev/docs/HyperIndex/schema)
  - [reserved-words](https://docs.envio.dev/docs/HyperIndex/reserved-words)
  - [event-handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers)
  - [migrate-to-v3](https://docs.envio.dev/docs/HyperIndex/migrate-to-v3)
  - [loaders](https://docs.envio.dev/docs/HyperIndex/loaders)
  - [preload-optimization](https://docs.envio.dev/docs/HyperIndex/preload-optimization)
  - [testing](https://docs.envio.dev/docs/HyperIndex/testing)
  - [generated-files](https://docs.envio.dev/docs/HyperIndex/generated-files)
  - [cli-commands](https://docs.envio.dev/docs/HyperIndex/cli-commands)
  - [running-locally](https://docs.envio.dev/docs/HyperIndex/running-locally)
  - [environment-variables](https://docs.envio.dev/docs/HyperIndex/environment-variables)
  - [common-issues](https://docs.envio.dev/docs/HyperIndex/common-issues)
  - [navigating-hasura](https://docs.envio.dev/docs/HyperIndex/navigating-hasura)
  - [query-conversion](https://docs.envio.dev/docs/HyperIndex/query-conversion)
  - [observability](https://docs.envio.dev/docs/HyperIndex/observability)
  - [websockets](https://docs.envio.dev/docs/HyperIndex/websockets)
  - [latency-at-head](https://docs.envio.dev/docs/HyperIndex/latency-at-head)
- Envio Cloud:
  - [hosted-service-deployment](https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment)
  - [hosted-service-billing](https://docs.envio.dev/docs/HyperIndex/hosted-service-billing)
  - [hosted-service-features](https://docs.envio.dev/docs/HyperIndex/hosted-service-features)
  - [envio-cloud-cli](https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli)
- HyperSync:
  - [api-tokens](https://docs.envio.dev/docs/HyperSync/api-tokens)
  - [hypersync-supported-networks](https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks)
- Pricing: https://envio.dev/pricing and https://envio.dev/pricing/hypersync

Source code at tag [v3.12.1](https://github.com/enviodev/hyperindex/tree/v3.12.1):

- `packages/cli/CommandLineHelp.md`
- Under `packages/cli/src/`:
  - `cli_args/clap_definitions.rs`
  - `cli_args/interactive_init/{mod.rs,evm_prompts.rs}`
  - `cli_args/init_config.rs`
  - `executor/init.rs`
  - `commands.rs`
  - `config_parsing/{human_config.rs,chain_helpers.rs}`
  - `evm/abi.rs`
  - `hbs_templating/init_templates.rs`
  - the codegen snapshot `…envio_types_dts_generated_for_evm…`
  - `docker_env.rs`
- Templates: `packages/cli/templates/static/blank_template/{typescript/tsconfig.json,shared/.env.example}`
- Runtime, from the npm tarball `envio-3.12.1.tgz`:
  - `index.d.ts`
  - `evm.schema.json`
  - `src/{Bin,Core,Env,Hasura,Config,TestIndexer,SimulateItems}.res`
  - `src/sources/HyperSync.res`
- Releases: https://github.com/enviodev/hyperindex/releases (v3.12.1, v3.13.0)

Commands run:

- `npm view` for `envio`, `envio-cloud`, `envio-win32-x64`,
  `@envio-dev/hypersync-client`, `typescript@6.0.3` and `vitest@4.1.0`
- `npm pack envio@3.12.1`
- `curl` against `monad-testnet.hypersync.xyz` (`/height`, and `/query`
  without a token)
- 12 parallel HyperSync-height vs `testnet-rpc.monad.xyz` `eth_blockNumber`
  samples
- a pnpm 10.33.0 workspace-membership install test
- ajv validation of the example config, the V2-style config and the docs'
  `field_selection` snippet
- `tsc` 6.0.3 on the example handler and test, including two negative checks
- `wsl -l -v` and `docker version`

Scratch files are in `E:\Projects\tmp-research\envio` (sandbox:
`verify2/`).
