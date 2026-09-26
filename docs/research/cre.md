# Chainlink CRE on Monad testnet: research for Polaris

Researched 26 Sep 2026 for `docs/plan.md` §3.3 (the CRE bounty and the two
workflows), §5.2 item 8 (`PolarisCollector`), §5.4 (the credit engine on CRE),
§6 items 7 and 9, and Appendix A (forwarders).

Everything below comes from one of these, and each section says which:

- the `@chainlink/cre-sdk@1.22.0` npm tarball (types and compiled JS);
- the `smartcontractkit/cre-cli` source at tag `v1.35.0` and the signed
  `cre_windows_amd64.zip` from that release, which I ran;
- `smartcontractkit/cre-templates` (main, 3 Sep 2026), `smartcontractkit/chain-selectors`,
  and `smartcontractkit/chainlink-evm` (develop);
- the docs, read as the site's own LLM bundle `https://docs.chain.link/cre/llms-full-ts.txt`
  (each section cites the page URL it came from);
- read-only JSON-RPC calls against Monad testnet and mainnet;
- a throwaway CRE project outside the repo (`E:\Projects\tmp-research\cre\proj`)
  where both Polaris workflows below were **type-checked and compiled to WASM
  with `cre workflow build`**, and the Solidity below was compiled with solc 0.8.24.

Anything I could not check is marked **UNVERIFIED**. I could not run
`cre workflow simulate` end to end, because it needs a CRE login (§6.1).

---

## 0. The short version (read this if nothing else)

1. **Versions.** CRE CLI **v1.35.0** (latest, released 17 Sep 2026) and
   `@chainlink/cre-sdk` **1.22.0** (npm `latest`, 17 Sep 2026). Monad testnet
   needs at least CLI v1.30.0 and TS SDK v1.19.0.
2. **Monad testnet** is chain name **`monad-testnet`**, selector
   **`2183018362218727504`**, chain id 10143. RPCs go in `project.yaml` under
   `rpcs: - chain-name: monad-testnet`.
3. **Both forwarders are verified on chain,** not only in the docs.
   - `0xB9F79d863261869B234c481D1f9A7af84AeAd192` answers `MockKeystoneForwarder 1.0.0`.
     It is also hard-coded in the CLI's simulator.
   - `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` answers `KeystoneForwarder 1.0.0`,
     and a live DON is delivering signed reports through it on Monad testnet today.
   - The mainnet pair in Appendix A checks out as well.
4. **`cre workflow simulate` needs `cre login`**, and so does `cre init`.
   - The alternative is `CRE_API_KEY`, but an API key needs deploy access, so
     for us it means a browser login.
   - `cre workflow build`, `cre workflow hash`, `cre workflow limits export` and
     `cre templates list` work without a login.
5. **Windows works natively,** unlike Envio.
   - The CLI ships an Authenticode-signed Windows binary.
   - `cre workflow build` compiled both Polaris workflows to WASM on this
     machine, using Bun 1.4.2.
6. **The simulation forwarder is permissionless.** An `eth_call` on Monad testnet
   shows it accepts an unsigned report and delivers it to the receiver.
   - While any receiver trusts the mock, anyone can write to it.
   - For `collections` that's harmless, because every action is permissionless.
     For `underwrite` it means **anyone could write credit facts**, so guard it
     (§7.7).
7. **A simulated `onReport` revert is reported as success.**
   - The mock forwarder swallows the receiver's revert.
   - The simulator then sets both `txStatus` and
     `receiverContractExecutionStatus` to SUCCESS.
   - So in simulation, judge success from our own contract events or the
     forwarder's `ReportProcessed(..., result)`.
8. **Limits set the batch size.** Per execution:
   - **15 EVM reads**;
   - **15 HTTP calls**;
   - **5 KB per EVM read request**. That caps Multicall3 at about 20
     `isInstallmentDue` calls, while a purpose-built `dueOf(uint256[])` view fits
     about 150 IDs;
   - a **50 KB report** and **10M gas** per write;
   - **5 minutes** per execution.

   Triggers are rate-limited too: the HTTP trigger fires **once per 30 s**, and
   cron no faster than every **30 s**.
9. **Cron doesn't schedule in simulation.** Each `simulate` run fires the handler
   once. "Every minute" under simulation means a shell loop (§6.5).
10. **Where the docs and the code disagree,** the code wins (§10). In short:
    - the `cacheSettings` field names;
    - the `--listen` endpoint (`POST /trigger` with a body of `{"input": ...}`);
    - the docs' "override `onReport`" example, which does not compile against the
      docs' own `ReceiverTemplate`;
    - the docs' `msg.data[4:]` metadata example, which decodes the wrong bytes.

---

## 1. Packages and versions verified

| Thing | Version | How verified |
|---|---|---|
| CRE CLI | **v1.35.0** (GitHub "Latest", 2026-09-17) | `gh release list -R smartcontractkit/cre-cli`; downloaded `cre_windows_amd64.zip`, SHA-256 `3a03ec4045673db3b816b3e8ab9a8576931e40a94eaebf358a75bcf46a41760f` matches the release `checksums.txt`; Authenticode `Valid`, signer `CN=SmartContract Inc`; `cre version` prints `CRE CLI version v1.35.0` |
| `@chainlink/cre-sdk` | **1.22.0** = npm `latest` (2026-09-17). Other tags: `alpha` 1.17.1-alpha.stellar.1, `solana` 1.14.0-solana-alpha-1 | `npm view`, `npm pack`; read `dist/**/*.d.ts` and JS |
| its deps | `viem ^2.54.2`, `zod 3.25.76`, `@chainlink/cre-sdk-javy-plugin 1.7.0`, `@bufbuild/protobuf 2.6.3`; `engines.bun >=1.2.21` | `npm view @chainlink/cre-sdk dependencies engines` |
| Bun | 1.4.2 (npm package `bun`, installed locally in the temp dir) | `bun --version`; used by `cre workflow build` |
| Javy (WASM compiler, fetched by the SDK) | v8.1.0, cached in `~/.cache/javy/v8.1.0` | appeared after the first build |
| TypeScript | 5.9.3 (what the CLI's hello-world template pins) | `tsc -p` over both workflows: exit 0 |
| solc | 0.8.24 (solc-js), `@openzeppelin/contracts` 5.6.1 (the version installed in `packages/contracts`) | compiled `ReceiverTemplate` and the receivers in §7.7 |
| chain-selectors | main (10 Sep 2026); `cre-cli/go.mod` pins v1.0.111 | `selectors.yml`, `generated_chains_evm.go`; the SDK tarball's generated `monad-testnet.js` agrees |

**Licences, for the README attribution:**

- `@chainlink/cre-sdk` is **BUSL-1.1**. Its grant allows copying, modification
  and non-production use, and it converts to MIT on 20 May 2029. We depend on
  it; we don't vendor it.
- The CLI and `ReceiverTemplate.sol` are MIT.
- `cre-sdk-typescript/packages/cre-http-trigger`, the JWT reference, is BUSL-1.1
  and `private`, so reimplement it from the spec rather than copying it.

---

## 2. Installing the CLI on Windows

Source: https://docs.chain.link/cre/getting-started/cli-installation/windows and
`cre-cli/install/install.ps1` at v1.35.0.

**Automatic install (the docs' one-liner),** in PowerShell:

```powershell
irm https://app.chain.link/cre/install.ps1 | iex
# then open a NEW terminal
cre version        # -> CRE CLI version v1.35.0
```

What I checked about it:

- The URL `307`-redirects to
  `https://raw.githubusercontent.com/smartcontractkit/cre-cli/refs/heads/main/install/install.ps1`.
  The older URL, `https://app.chain.link/install.ps1`, `308`s to the one above.
- The script:
  1. downloads the latest `cre_windows_amd64.zip`;
  2. extracts `cre_<tag>_windows_amd64.exe`;
  3. **fails unless the Authenticode signer contains "SmartContract"**;
  4. copies it to `%LOCALAPPDATA%\Programs\cre\cre.exe`;
  5. **prepends that folder to the *user* PATH**;
  6. warns if `bun` is missing.
- ARM64 Windows gets the amd64 build.

**Manual install** (what I ran; it doesn't touch PATH):

```powershell
$tag = "v1.35.0"
Invoke-WebRequest "https://github.com/smartcontractkit/cre-cli/releases/download/$tag/cre_windows_amd64.zip" -OutFile cre_windows_amd64.zip
Invoke-WebRequest "https://github.com/smartcontractkit/cre-cli/releases/download/$tag/checksums.txt" -OutFile checksums.txt
Get-FileHash cre_windows_amd64.zip -Algorithm SHA256   # compare with checksums.txt
Expand-Archive cre_windows_amd64.zip -DestinationPath .
Get-AuthenticodeSignature .\cre_v1.35.0_windows_amd64.exe   # Status: Valid, CN=SmartContract Inc
Rename-Item .\cre_v1.35.0_windows_amd64.exe cre.exe
.\cre.exe version
```

One quirk: `checksums.txt` names the entry `cre_v1.35.0_windows_amd64.zip`, but
the asset is called `cre_windows_amd64.zip`. The hash matched the asset.

**Bun is required for TypeScript workflows.**

- The SDK declares `bun >=1.2.21`.
- `cre workflow build` shells out to `bun x cre-compile`, and the CLI runs
  `bun install --ignore-scripts` when scaffolding.
- I used Bun 1.4.2 from npm, in a temp folder put on PATH:
  `npm install bun` and then `node_modules/.bin`.
- **UNVERIFIED:** Bun's own Windows installer, which the CRE docs don't cover.
- `cre update` upgrades the CLI in place.

---

## 3. Project layout

### 3.1 What `cre init` creates

Source: the CLI source at v1.35.0, which is more exact than the docs:

- `internal/templaterepo/builtin/hello-world-ts/*`
- `internal/settings/template/{project.yaml,workflow.yaml,.env,.gitignore}.tpl`
- `cmd/creinit/creinit.go`

Docs: https://docs.chain.link/cre/reference/cli/project-setup-ts and
https://docs.chain.link/cre/reference/project-configuration-ts.

```text
<project>/                  # the "project root": every cre command runs from here
├── project.yaml            # generated; targets -> rpcs (defaults to ethereum-testnet-sepolia)
├── secrets.yaml            # "secretsNames:" (empty)
├── .env                    # CRE_ETH_PRIVATE_KEY=<placeholder>
├── .gitignore              # "*.env"
└── <workflow-name>/
    ├── main.ts
    ├── main.test.ts        # bun test with @chainlink/cre-sdk/test
    ├── package.json        # "@chainlink/cre-sdk": "^1.22.0", typescript 5.9.3
    ├── tsconfig.json
    ├── config.staging.json     # {"schedule": "*/30 * * * * *"}
    ├── config.production.json
    ├── workflow.yaml       # generated
    └── README.md
```

- `cre init` **requires a login.** It isn't in the CLI's list of commands that
  skip credentials.
- Run inside an existing project, it adds another workflow folder.
- The non-interactive form, from the docs and `cre init --help` (**UNVERIFIED**:
  not run, because it needs a login):

```bash
cre init --non-interactive -p cre -w collections -t hello-world-ts --deployment-registry private
# then, from inside cre/:
cre init --non-interactive -w underwrite -t hello-world-ts --deployment-registry private
```

`--rpc-url monad-testnet=...` does nothing for `hello-world-ts`, because that
template declares no networks and the CLI falls back to Sepolia. **Edit
`project.yaml` by hand.**

### 3.2 The Polaris files

These are exactly the files `cre workflow build` and `cre workflow hash` accepted.

`cre/project.yaml`:

```yaml
# Targets. RPC URLs may use ${VAR} from .env or the shell.
staging-settings:
  rpcs:
    - chain-name: monad-testnet
      url: https://testnet-rpc.monad.xyz

production-settings:
  rpcs:
    - chain-name: monad-testnet
      url: ${MONAD_TESTNET_RPC}
```

`cre/secrets.yaml` maps logical secret IDs to environment-variable names:

```yaml
secretsNames:
  NANSEN_API_KEY:
    - NANSEN_API_KEY_VAR
  ZERION_API_KEY:
    - ZERION_API_KEY_VAR
```

`cre/.env` (never commit it; the generated `.gitignore` has `*.env`):

```bash
# 64 hex chars, 0x prefix allowed, no quotes. Funded with testnet MON for --broadcast.
CRE_ETH_PRIVATE_KEY=<simulation broadcaster key>
NANSEN_API_KEY_VAR=<key>
ZERION_API_KEY_VAR=<key>
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
```

`cre/collections/workflow.yaml`. `underwrite/workflow.yaml` is the same, with
`secrets-path: "../secrets.yaml"`:

```yaml
staging-settings:
  user-workflow:
    workflow-name: "polaris-collections-staging"
    # deployment-registry: "private"   # set when deploying; omitted = onchain:ethereum-mainnet
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.staging.json"
    secrets-path: ""

production-settings:
  user-workflow:
    workflow-name: "polaris-collections"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.production.json"
    secrets-path: ""
```

`cre/collections/package.json`. Pin exact versions; `underwrite/` is the same
apart from `name`:

```json
{
  "name": "polaris-collections",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@chainlink/cre-sdk": "1.22.0", "viem": "2.54.2", "zod": "3.25.76" },
  "devDependencies": { "typescript": "5.9.3" }
}
```

`cre/collections/tsconfig.json`, as in the CLI template:

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  },
  "include": ["main.ts"]
}
```

`cre/collections/config.staging.json`, parsed by the zod schema in §5.5:

```json
{
  "schedule": "0 * * * * *",
  "chainSelectorName": "monad-testnet",
  "collector": "0x<PolarisCollector>",
  "loanEngine": "0x<PolarisLoanEngine>",
  "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
  "indexerUrl": "https://<envio-endpoint>/v1/graphql",
  "maxBatch": 20,
  "gasLimit": "3000000"
}
```

`cre/underwrite/config.staging.json`:

```json
{
  "chainSelectorName": "monad-testnet",
  "collector": "0x<PolarisUnderwriter>",
  "authorizedKey": "0x<address our API signs HTTP-trigger JWTs with>",
  "gasLimit": "500000",
  "nansenBase": "https://api.nansen.ai/api/v1",
  "zerionBase": "https://api.zerion.io/v1"
}
```

Notes:

- **Target names must match** in `project.yaml` and `workflow.yaml`, or the CLI
  aborts.
- The target comes from `--target` / `-T`, or from the `CRE_TARGET` environment
  variable.
- Keys set in `workflow.yaml` win over `project.yaml`.
- **Where it lives:** `cre/` at the repo root, as §5.4 of the plan says. It sits
  outside `pnpm-workspace.yaml`'s globs (`packages/*`, `apps/*`, `services/*`),
  so pnpm leaves it alone. Install each workflow with `bun install` inside its
  folder.
- Add `cre/**/node_modules/`, `cre/**/binary.wasm` and `cre/.env` to `.gitignore`.

---

## 4. Monad testnet: chain name, selector, RPCs, forwarders

| | Value | Verified in |
|---|---|---|
| CRE chain name | **`monad-testnet`** | chain-selectors `selectors.yml`; SDK `EVMClient.SUPPORTED_CHAIN_SELECTORS`; docs forwarder directory |
| Chain selector | **`2183018362218727504`** (`2183018362218727504n` in TS) | chain-selectors `MONAD_TESTNET = Chain{EvmChainID: 10143, Selector: 2183018362218727504, Name: "monad-testnet"}`; SDK `dist/generated/chain-selectors/testnet/evm/monad-testnet.js` |
| Mainnet | `monad-mainnet`, `8481857512324358265` | same |
| Minimum versions | testnet: CLI v1.30.0+, TS SDK v1.19.0+; mainnet: CLI v1.29.0+, TS SDK v1.18.0+ | https://docs.chain.link/cre/supported-networks-ts |

**Getting the selector in code.** Both lines below type-check against 1.22.0.
The release notes promise a `MonadTestnet` constant, but **1.22.0's types don't
export one**, so use either of these:

```ts
import { cre, getNetwork } from "@chainlink/cre-sdk";

const net = getNetwork({ chainFamily: "evm", chainSelectorName: "monad-testnet", isTestnet: true });
const evm = new cre.capabilities.EVMClient(net!.chainSelector.selector);
// or: new cre.capabilities.EVMClient(cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-testnet"])
```

**RPCs** go per target in `project.yaml` (§3.2). The docs say:

- they're required whenever a workflow uses the EVM capability;
- without one, "the simulator cannot register the EVM capability";
- `${VAR}` interpolation works in every CLI command.

Source: https://docs.chain.link/cre/reference/project-configuration-ts.

The public RPC limits `eth_getLogs` to a 100-block range, which I hit while
probing. It doesn't matter for CRE, but it does for any backfill script.

**Forwarders**, all four checked with `typeAndVersion()` over JSON-RPC:

| Network | Use | Address | On-chain `typeAndVersion()` | Also listed in |
|---|---|---|---|---|
| Monad testnet | `simulate --broadcast` | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` | `MockKeystoneForwarder 1.0.0` | docs directory; CLI `cmd/workflow/simulate/chain/evm/supported_chains.go` (v1.35.0) |
| Monad testnet | deployed workflows | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `KeystoneForwarder 1.0.0` | docs directory |
| Monad mainnet | `simulate --broadcast` | `0x9eF6468C5f37b976E57d52054c693269479A784d` | `MockKeystoneForwarder 1.0.0` | docs; CLI source |
| Monad mainnet | deployed workflows | `0x76c9cf548b4179F8901cda1f8623568b58215E62` | `KeystoneForwarder 1.0.0` | docs |

Source for the directory:
https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts.
It says your tenant's list may differ, and `cre workflow supported-chains` (which
needs a login) is the authoritative per-organisation list.

**A DON is live on the Monad testnet production forwarder.** I scanned the last
6,000 blocks for `ReportProcessed` events:

- There were recent deliveries with `result = true` to receiver
  `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1`.
- Each was sent by a different node address, for example `0x926ee6a7…`,
  `0xc8dbafe6…` and `0x5e0c21db…`.
- Transaction gas limits were about 319.5k, **with `gasUsed == gasLimit` in
  every receipt**. That fits Monad charging for the gas limit.

**UNVERIFIED:** whether *our* organisation's deployed workflows may write to
Monad testnet. Run `cre workflow supported-chains` after `cre login`.

Appendix A also asked about Multicall3: it **is deployed on Monad testnet** at
`0xcA11bde05977b3631167028862bE2a173976CA11`. `eth_getCode` returns code.

---

## 5. Workflow code (TypeScript, SDK 1.22.0)

Every call below type-checks against the 1.22.0 tarball. §5.5 and §5.6 also
**compiled to WASM** with `cre workflow build`, which runs the SDK's type check,
its runtime-compatibility validator and its determinism warnings.

What the runtime does and doesn't provide
(https://docs.chain.link/cre/concepts/typescript-wasm-runtime and the SDK's
`dist/sdk/types/global.d.ts`):

- It is **QuickJS in WASM, not Node.** There's no `fetch`, `setTimeout` or
  `node:crypto`.
- `Buffer`, `TextEncoder` and `TextDecoder` exist.
- Capability calls are synchronous: `.result()`, not `await`.
- Use `runtime.now()`, never `Date.now()`.
- A top-level `main()` call is optional. The compiler wraps it as
  `main().catch(sendErrorResponse)`.

### 5.1 Skeleton and cron trigger

Sources:

- the CLI's built-in `hello-world-ts/workflow/main.ts` (v1.35.0);
- https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts
- SDK `dist/generated/capabilities/scheduler/cron/v1/trigger_pb.d.ts`
  (`CronPayload.scheduledExecutionTime: Timestamp`).

```ts
import { cre, type CronPayload, Runner, type Runtime } from "@chainlink/cre-sdk";
import { z } from "zod";

export const configSchema = z.object({ schedule: z.string() });
type Config = z.infer<typeof configSchema>;

export const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log(`fired for ${payload.scheduledExecutionTime?.seconds}`);
  return "ok";
};

export const initWorkflow = (config: Config) => [
  cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron),
];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
```

Cron rules (docs):

- **5 or 6 fields**; the optional 6th is *seconds* and comes first.
  `0 * * * * *` means every minute at second 0.
- UTC by default; `TZ=<IANA> ...` changes the zone.
- **You can't fire faster than every 30 s.**

### 5.2 EVM read: `callContract` with viem encoding

Sources:

- SDK `dist/generated-sdk/capabilities/blockchain/evm/v1alpha/client_sdk_gen.d.ts`
  (`callContract`, `estimateGas`, `writeReport`, ...);
- SDK `dist/sdk/utils/capabilities/blockchain/evm/evm-helpers.d.ts`
  (`encodeCallMsg`, `LAST_FINALIZED_BLOCK_NUMBER`, `LATEST_BLOCK_NUMBER`,
  `blockNumber(n)`);
- https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-read-ts

```ts
import { bytesToHex, cre, encodeCallMsg, LAST_FINALIZED_BLOCK_NUMBER, type Runtime } from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress } from "viem";

const LOAN_ENGINE_ABI = parseAbi(["function isInstallmentDue(uint256 loanId) view returns (bool)"]);

const reply = evm
  .callContract(runtime, {
    call: encodeCallMsg({
      from: zeroAddress,
      to: runtime.config.loanEngine as Address,
      data: encodeFunctionData({ abi: LOAN_ENGINE_ABI, functionName: "isInstallmentDue", args: [42n] }),
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER, // or LATEST_BLOCK_NUMBER, or blockNumber(123n)
  })
  .result(); // CallContractReply { data: Uint8Array }

const isDue = decodeFunctionResult({ abi: LOAN_ENGINE_ABI, functionName: "isInstallmentDue", data: bytesToHex(reply.data) });
```

**Batching is capped by the 5 KB read-payload limit.** Measured with viem:

- A Multicall3 `aggregate3` of N `isInstallmentDue` calls is **224 bytes per
  call plus 68**: 20 calls are 4,548 bytes and 25 calls are 5,668.
- A single custom view `dueOf(uint256[])` is **32 bytes per ID plus 68**: 150
  IDs are about 4.9 KB.

§5.5 uses Multicall3 with `maxBatch ≤ 20`, which follows the plan as written.
This drop-in replacement also type-checks, and is the better choice (§12):

```ts
// dueOf.ts: type-checked against @chainlink/cre-sdk 1.22.0
import { bytesToHex, cre, encodeCallMsg, LAST_FINALIZED_BLOCK_NUMBER, type Runtime } from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress } from "viem";

const COLLECTOR_ABI = parseAbi([
  "function dueOf(uint256[] loanIds) view returns (uint256[] due)",
]);

export const readDue = (
  runtime: Runtime<{ collector: string }>,
  evm: InstanceType<typeof cre.capabilities.EVMClient>,
  candidates: bigint[],
): readonly bigint[] => {
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.collector as Address,
        data: encodeFunctionData({ abi: COLLECTOR_ABI, functionName: "dueOf", args: [candidates] }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi: COLLECTOR_ABI, functionName: "dueOf", data: bytesToHex(reply.data) });
};

// Optional: size the write from an estimate of onReport as called by the forwarder.
export const estimateOnReportGas = (
  runtime: Runtime<{ collector: string; forwarder: string }>,
  evm: InstanceType<typeof cre.capabilities.EVMClient>,
  reportPayload: `0x${string}`,
): bigint => {
  const RECEIVER_ABI = parseAbi(["function onReport(bytes metadata, bytes report)"]);
  const est = evm
    .estimateGas(runtime, {
      msg: encodeCallMsg({
        from: runtime.config.forwarder as Address,
        to: runtime.config.collector as Address,
        data: encodeFunctionData({
          abi: RECEIVER_ABI,
          functionName: "onReport",
          args: [`0x${"00".repeat(64)}`, reportPayload],
        }),
      }),
    })
    .result();
  return est.gas;
};
```

### 5.3 HTTP with consensus

Sources:

- SDK `client_sdk_gen.d.ts` for `networking/http/v1alpha`;
- `http-helpers.d.ts` (`ok`, `text`, `json`, `getHeader`, `getHeaders`);
- `consensus_aggregators.d.ts`;
- https://docs.chain.link/cre/reference/sdk/consensus-ts
- https://docs.chain.link/cre/guides/workflow/using-http-client/post-request-ts

There are two shapes:

- **High level:** `new cre.capabilities.HTTPClient().sendRequest(runtime, fn, aggregation)(...args).result()`.
  `fn(sendRequester, ...args)` runs on every node and may call
  `sendRequester.sendRequest(req).result()` several times.
- **Low level:** `runtime.runInNodeMode(fn, aggregation)(...args).result()`,
  where `fn(nodeRuntime, ...args)` builds its own client.

**Aggregation helpers in 1.22.0,** taken from the `.d.ts`:

| Helper | For | Notes |
|---|---|---|
| `consensusMedianAggregation<T>()` | `number`, `bigint`, `Date` (and SDK `Decimal`, `Int64`, `UInt64`) | median across nodes |
| `consensusIdenticalAggregation<T>()` | primitives, and objects or arrays of them | needs a Byzantine quorum of identical values |
| `consensusCommonPrefixAggregation<T>()` / `consensusCommonSuffixAggregation<T>()` | `T[]` | longest common prefix or suffix |
| `consensusFrequencyListAggregation<T>()` | `T[]` → `FrequencyListEntry<T>[]` | in the SDK, not in the docs table |
| `ConsensusAggregationByFields<T>({ field: median, other: identical, ... })` | objects | field functions: **`median`, `identical`, `commonPrefix`, `commonSuffix`, `frequencyList`, `ignore`**. Pass the functions themselves (`median`, not `median()`) |
| `.withDefault(v)` | any of the above | used if nodes fail or can't agree |

Request details that matter, from the SDK's `RequestJson`:

- **`body` is base64** (proto `bytes`). Use
  `Buffer.from(JSON.stringify(x)).toString("base64")`.
- **`headers` is deprecated.** Use `multiHeaders: { name: { values: [...] } }`.
- `timeout` is a proto Duration string such as `"8s"`.
- **`cacheSettings` is `{ store: boolean, maxAge: "60s" }`** in 1.22.0, which is
  what the templates use.
  - The docs' `{ readFromCache: true, maxAgeMs: 60000 }` **fails to type-check**:
    I tried it, and got `Type 'true' is not assignable to type 'never'`.
  - Caching makes one node do the call and the others reuse its response. The
    docs call this best effort.
  - It matters for us twice over: a paid Nansen call isn't made once per node,
    and identical consensus holds even when the upstream changes between node
    calls.
- **Redirects (3xx) fail.** Use the final URL.
- **Secrets are DON-mode only.** `NodeRuntime` has no `getSecret` in the types,
  so read keys in the handler and pass them into `fn` as arguments. §5.6 shows
  how.

### 5.4 `runtime.report()` and `evmClient.writeReport()` with a gas limit

Sources:

- SDK `runtime.d.ts` (`report(input: ReportRequest | ReportRequestJson)`);
- `evm-helpers.d.ts` (`prepareReportRequest(hex)`, which uses
  `{ encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" }`);
- `client_sdk_gen.d.ts` (`WriteCreReportRequestJson = { receiver: string; report?: Report; gasConfig?: { gasLimit?: string } }`);
- https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/writing-data-onchain

```ts
import { bytesToHex, prepareReportRequest, TxStatus } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const payload = encodeAbiParameters(parseAbiParameters("uint8 kind, uint256[] loanIds"), [1, [7n, 9n]]);
const report = runtime.report(prepareReportRequest(payload)).result();
const write = evm
  .writeReport(runtime, {
    receiver: runtime.config.collector,           // 0x-address string
    report,
    gasConfig: { gasLimit: runtime.config.gasLimit }, // decimal STRING, e.g. "3000000"
  })
  .result(); // { txStatus, receiverContractExecutionStatus?, txHash?, transactionFee?, errorMessage? }

if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`${write.txStatus} ${write.errorMessage ?? ""}`);
const txHash = bytesToHex(write.txHash ?? new Uint8Array(32));
```

- `TxStatus` is `FATAL = 0`, `REVERTED = 1`, `SUCCESS = 2`.
- `ReceiverContractExecutionStatus` is `SUCCESS = 0`, `REVERTED = 1`.
- **In simulation the receiver status isn't trustworthy** (§6.4).
- What reaches our contract as `report` is exactly `payload`: the forwarder
  passes `rawReport[109:]`, and the SDK's `Report.body()` is
  `rawReport.subarray(109)`.
- **Always set `gasConfig`.** Monad charges the limit, and the production cap is
  10,000,000.
  - **UNVERIFIED:** what a deployed DON uses when `gasConfig` is absent.
  - In simulation, the fake chain passes `gasConfig.gasLimit` to go-ethereum's
    transactor, which estimates the limit when none is set.
  - To size it, `evm.estimateGas()` exists (`dueOf.ts` above shows an estimate of
    `onReport` called from the forwarder address). Add the forwarder's own
    overhead (§7.5), then about 15%.

### 5.5 `cre/collections/main.ts` (compiled to WASM)

This follows plan §3.3: the indexer proposes, the chain disposes, one report per
run.

- The Envio GraphQL query shape is a placeholder that depends on our indexer
  schema (see `docs/research/envio.md`).
- `isInstallmentDue(uint256)` exists in `PolarisLoanEngine` today.
- `collectInstallment` is the new function from plan §5.2 item 5.

```ts
import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  type CronPayload,
  encodeCallMsg,
  getNetwork,
  type HTTPSendRequester,
  json,
  LAST_FINALIZED_BLOCK_NUMBER,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import {
  type Address,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import { z } from "zod";

// ---------- config (config.staging.json / config.production.json) ----------
export const configSchema = z.object({
  schedule: z.string(), // "0 * * * * *" = every minute at second 0 (min interval is 30 s)
  chainSelectorName: z.string(), // "monad-testnet"
  collector: z.string(), // PolarisCollector, the ReceiverTemplate consumer
  loanEngine: z.string(), // PolarisLoanEngine
  multicall3: z.string(), // 0xcA11bde05977b3631167028862bE2a173976CA11
  indexerUrl: z.string(), // Envio HyperIndex GraphQL endpoint
  maxBatch: z.number().int().positive(), // items per report, bounded by gas (see limits)
  gasLimit: z.string(), // decimal string, e.g. "3000000"
});
type Config = z.infer<typeof configSchema>;

// ---------- ABIs (viem human-readable) ----------
const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const LOAN_ENGINE_ABI = parseAbi([
  "function isInstallmentDue(uint256 loanId) view returns (bool)",
]);

// Report kinds understood by PolarisCollector._processReport
const KIND_COLLECT = 1;

// ---------- step 1: the indexer proposes (HTTP + consensus) ----------
const fetchCandidates = (
  sendRequester: HTTPSendRequester,
  config: Config,
  limit: number,
): string[] => {
  // GraphQL is POST; the body is base64 in the request JSON.
  const query = {
    query: `query Due($limit: Int!) { Loan(where: { status: { _eq: "active" } }, order_by: { nextDueAt: asc }, limit: $limit) { loanId } }`,
    variables: { limit },
  };
  const resp = sendRequester
    .sendRequest({
      url: config.indexerUrl,
      method: "POST",
      body: Buffer.from(JSON.stringify(query)).toString("base64"),
      multiHeaders: { "content-type": { values: ["application/json"] } },
      // Share one response across nodes so identical consensus holds even if the
      // indexer moves between node calls.
      cacheSettings: { store: true, maxAge: "30s" },
    })
    .result();
  if (!ok(resp)) throw new Error(`indexer HTTP ${resp.statusCode}`);
  const body = json(resp) as { data?: { Loan?: { loanId: string }[] } };
  return (body.data?.Loan ?? []).map((l) => String(l.loanId)).sort();
};

// ---------- step 2: the chain disposes (one EVM read via Multicall3) ----------
const filterDueOnChain = (
  runtime: Runtime<Config>,
  evm: InstanceType<typeof cre.capabilities.EVMClient>,
  candidates: bigint[],
): bigint[] => {
  const { multicall3, loanEngine } = runtime.config;
  const calls = candidates.map((loanId) => ({
    target: loanEngine as Address,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: LOAN_ENGINE_ABI,
      functionName: "isInstallmentDue",
      args: [loanId],
    }),
  }));
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: multicall3 as Address,
        data: encodeFunctionData({
          abi: MULTICALL3_ABI,
          functionName: "aggregate3",
          args: [calls],
        }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const results = decodeFunctionResult({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    data: bytesToHex(reply.data),
  });
  const due: bigint[] = [];
  results.forEach((r, i) => {
    if (!r.success) return;
    const isDue = decodeFunctionResult({
      abi: LOAN_ENGINE_ABI,
      functionName: "isInstallmentDue",
      data: r.returnData,
    });
    if (isDue) due.push(candidates[i]);
  });
  return due;
};

// ---------- handler ----------
export const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const cfg = runtime.config;
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: cfg.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const http = new cre.capabilities.HTTPClient();
  const candidateIds = http
    .sendRequest(
      runtime,
      fetchCandidates,
      consensusIdenticalAggregation<string[]>(),
    )(cfg, cfg.maxBatch)
    .result();
  if (candidateIds.length === 0) return "nothing due";

  const due = filterDueOnChain(runtime, evm, candidateIds.map((s) => BigInt(s)));
  if (due.length === 0) return "nothing due on chain";

  // abi.encode(uint8 kind, uint256[] loanIds) -> PolarisCollector._processReport
  const payloadHex = encodeAbiParameters(
    parseAbiParameters("uint8 kind, uint256[] loanIds"),
    [KIND_COLLECT, due],
  );
  const report = runtime.report(prepareReportRequest(payloadHex)).result();

  const write = evm
    .writeReport(runtime, {
      receiver: cfg.collector,
      report,
      gasConfig: { gasLimit: cfg.gasLimit },
    })
    .result();

  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`write failed: ${write.txStatus} ${write.errorMessage ?? ""}`);
  }
  // Forwarder tx can succeed while onReport reverted: check the receiver status too.
  if (write.receiverContractExecutionStatus !== undefined && write.receiverContractExecutionStatus !== 0) {
    throw new Error("PolarisCollector.onReport reverted");
  }
  const tx = bytesToHex(write.txHash ?? new Uint8Array(32));
  runtime.log(`collected ${due.length} loans, scheduled ${payload.scheduledExecutionTime?.seconds}, tx ${tx}`);
  return tx;
};

export const initWorkflow = (config: Config) => [
  cre.handler(
    new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }),
    onCron,
  ),
];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
```

### 5.6 `cre/underwrite/main.ts` (compiled to WASM)

The HTTP trigger payload is `payload.input`: the JSON body as bytes, decoded with
`decodeJson`. The config type is `{ authorizedKeys: [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: "0x…" }] }`.
Sources: SDK `http_sdk_gen.d.ts` and `trigger_pb.d.ts`;
https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/configuration-ts

- **The Nansen and Zerion paths, bodies, auth and response fields are
  placeholders** here. They belong to their own research notes. What this file
  shows is the CRE mechanics around them.
- The report is a flat static tuple. I checked with viem that it is
  byte-identical to `abi.encode(uint8, address, Facts)`, which is how §7.7
  decodes it.

```ts
import {
  bytesToHex,
  ConsensusAggregationByFields,
  cre,
  decodeJson,
  getNetwork,
  type HTTPPayload,
  type HTTPSendRequester,
  identical,
  json,
  median,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import { type Address, encodeAbiParameters, isAddress, parseAbiParameters } from "viem";
import { z } from "zod";

export const configSchema = z.object({
  chainSelectorName: z.string(), // "monad-testnet"
  collector: z.string(), // PolarisCollector (forwards to ScoreManager.underwrite)
  authorizedKey: z.string(), // EVM address allowed to fire the HTTP trigger (our API's signer)
  gasLimit: z.string(),
  nansenBase: z.string(), // "https://api.nansen.ai/api/v1"
  zerionBase: z.string(), // "https://api.zerion.io/v1"
});
type Config = z.infer<typeof configSchema>;

type Keys = { nansen: string; zerion: string };

// Everything the DON agrees on. Numbers -> median, flags/strings -> identical.
type Facts = {
  walletAgeDays: number;
  txCount: number;
  portfolioUsd: number;
  counterparties: number;
  relatedWallets: number;
  firstFunderIsExchange: boolean;
};

const KIND_UNDERWRITE = 2;

// Runs on every node. Several requests in one function are fine; each one counts
// toward the 15-calls-per-execution HTTP quota.
const fetchFacts = (
  sendRequester: HTTPSendRequester,
  config: Config,
  keys: Keys,
  wallet: string,
): Facts => {
  const post = (path: string, body: unknown) => {
    const resp = sendRequester
      .sendRequest({
        url: `${config.nansenBase}${path}`,
        method: "POST",
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
        multiHeaders: {
          "content-type": { values: ["application/json"] },
          apikey: { values: [keys.nansen] },
        },
        // one paid call shared by all nodes (best effort), not one per node
        cacheSettings: { store: true, maxAge: "300s" },
      })
      .result();
    if (!ok(resp)) throw new Error(`nansen ${path} HTTP ${resp.statusCode}`);
    return json(resp) as any;
  };
  const get = (path: string) => {
    const resp = sendRequester
      .sendRequest({
        url: `${config.zerionBase}${path}`,
        method: "GET",
        multiHeaders: {
          accept: { values: ["application/json"] },
          authorization: { values: [`Basic ${Buffer.from(`${keys.zerion}:`).toString("base64")}`] },
        },
        cacheSettings: { store: true, maxAge: "300s" },
      })
      .result();
    if (!ok(resp)) throw new Error(`zerion ${path} HTTP ${resp.statusCode}`);
    return json(resp) as any;
  };

  // Endpoint paths and response fields below are placeholders: see the Nansen and
  // Zerion research notes. The CRE mechanics around them are what this file shows.
  const funder = post("/profiler/address/first-funder", { address: wallet });
  const cps = post("/profiler/address/counterparties", { address: wallet });
  const related = post("/profiler/address/related-wallets", { address: wallet });
  const portfolio = get(`/wallets/${wallet}/portfolio`);

  return {
    walletAgeDays: Number(funder?.data?.age_days ?? 0),
    txCount: Number(portfolio?.data?.attributes?.tx_count ?? 0),
    portfolioUsd: Math.floor(Number(portfolio?.data?.attributes?.total?.positions ?? 0)),
    counterparties: Number(cps?.data?.length ?? 0),
    relatedWallets: Number(related?.data?.length ?? 0),
    firstFunderIsExchange: Boolean(funder?.data?.is_exchange ?? false),
  };
};

export const onUnderwrite = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const cfg = runtime.config;
  const input = decodeJson(payload.input) as { user?: string; wallet?: string };
  if (!input.user || !isAddress(input.user)) throw new Error("bad user");
  const wallet = input.wallet && isAddress(input.wallet) ? input.wallet : input.user;

  // Secrets are read in DON mode (NodeRuntime has no getSecret) and passed down.
  const secrets = runtime.getSecrets([{ id: "NANSEN_API_KEY" }, { id: "ZERION_API_KEY" }]).result();
  const keys: Keys = {
    nansen: secrets["NANSEN_API_KEY"].value,
    zerion: secrets["ZERION_API_KEY"].value,
  };

  const facts = new cre.capabilities.HTTPClient()
    .sendRequest(
      runtime,
      fetchFacts,
      ConsensusAggregationByFields<Facts>({
        walletAgeDays: median,
        txCount: median,
        portfolioUsd: median,
        counterparties: median,
        relatedWallets: median,
        firstFunderIsExchange: identical,
      }),
    )(cfg, keys, wallet)
    .result();

  const observedAt = BigInt(Math.floor(runtime.now().getTime() / 1000)); // DON time
  const payloadHex = encodeAbiParameters(
    parseAbiParameters(
      "uint8 kind, address user, uint32 walletAgeDays, uint32 txCount, uint64 portfolioUsd, uint32 counterparties, uint32 relatedWallets, bool firstFunderIsExchange, uint64 observedAt",
    ),
    [
      KIND_UNDERWRITE,
      input.user as Address,
      facts.walletAgeDays,
      facts.txCount,
      BigInt(facts.portfolioUsd),
      facts.counterparties,
      facts.relatedWallets,
      facts.firstFunderIsExchange,
      observedAt,
    ],
  );

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const report = runtime.report(prepareReportRequest(payloadHex)).result();
  const write = evm
    .writeReport(runtime, { receiver: cfg.collector, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`write failed: ${write.txStatus}`);
  return bytesToHex(write.txHash ?? new Uint8Array(32));
};

export const initWorkflow = (config: Config) => [
  cre.handler(
    new cre.capabilities.HTTPCapability().trigger({
      authorizedKeys: [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.authorizedKey }],
    }),
    onUnderwrite,
  ),
];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
```

### 5.7 Secrets (API keys)

Sources:

- https://docs.chain.link/cre/guides/workflow/secrets
- https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-simulation-ts
- https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-deployed
- `cre secrets --help` (v1.35.0).

The code is the same in simulation and deployment:

```ts
const one = runtime.getSecret({ id: "NANSEN_API_KEY" }).result().value;
const many = runtime.getSecrets([{ id: "NANSEN_API_KEY" }, { id: "ZERION_API_KEY" }]).result(); // Record<id, Secret>
```

`getSecrets` is all-or-nothing: it throws `SecretsBatchError`. `namespace`
defaults to `"main"`.

**In simulation:**

1. `secrets.yaml` maps an ID to an environment-variable name.
2. The value comes from `.env` at the project root, or from the shell.
3. `workflow.yaml` needs `secrets-path: "../secrets.yaml"`.

No Vault is involved and no login is needed for the secrets themselves, though
`simulate` itself needs one.

**Deployed:**

- Values live in the **Vault DON**, pushed with the same YAML file:

  ```bash
  cre secrets create ../secrets.yaml --target production-settings --secrets-auth=browser   # private registry
  cre secrets create ../secrets.yaml --target production-settings                          # onchain registry (default --secrets-auth=onchain)
  cre secrets list   --target production-settings --secrets-auth=browser
  ```

- Other `cre secrets` flags: `--timeout` (default `48h`), `--unsigned`, `--yes`.
- Subcommands: `create`, `update`, `delete`, `list`, `execute`.
- Quotas: 100 secrets per owner, 2 KB per encrypted value, and 5 secret-fetch
  calls per execution.

---

## 6. Simulation

Source: https://docs.chain.link/cre/guides/operations/simulating-workflows,
`cre workflow simulate --help` (v1.35.0), and the CLI source.

### 6.1 Does simulate need `cre login`? Yes

- **Evidence:** in `cmd/root.go`, `isLoadCredentials()` exempts `version`,
  `login`, `logout`, `workflow build`, `workflow hash`, `workflow limits`,
  `templates …` and a few others. It does not exempt `workflow simulate` or
  `init`.
- Running `cre workflow simulate ./collections` on this machine, logged out,
  printed: `✗ Authentication required: not logged in and no CRE_API_KEY set`.
- The docs list "CRE account & authentication" as a prerequisite too.
- **`CRE_API_KEY` doesn't get us out of it.** The docs say API-key auth
  "requires your account to have deploy access approval". Until access arrives,
  it's `cre login` in a browser, with a CRE account and 2FA from
  app.chain.link/cre/discover.
- The session lives in `~/.cre/cre.yaml`, with tenant context in
  `~/.cre/context.yaml`.
- **UNVERIFIED:** how long a session lasts. That matters for an unattended
  loop.

### 6.2 Flags, from `cre workflow simulate --help` (v1.35.0)

| Flag | Meaning |
|---|---|
| `--broadcast` | Broadcast transactions to configured chains (default false = dry run; the tx hash prints as `0x000…0`) |
| `--config string` / `--default-config` / `--no-config` | config file override, `workflow.yaml` path (default), or none |
| `-g, --engine-logs` | engine logging |
| `--evm-event-index int`, `--evm-tx-hash string` | replay an EVM log trigger |
| `--evm-receipt-timeout string` | wait for a write receipt (default `1m`) |
| `--http-payload string` | HTTP trigger payload: a JSON string, or the path to a JSON file (docs: an `@` prefix is optional) |
| `--http-trigger-port int` | local HTTP trigger server port (default 2000) |
| `--limits string` | `default` (production quotas, the default), `none`, or a path to a JSON file |
| `--listen` | stay up and run once per incoming HTTP request or matching log; **not supported by cron** |
| `--skip-type-checks` | pass through to `cre-compile` |
| `--trigger-index int` | which handler to run (0-based) |
| `--wasm string` | pre-built WASM path or URL (skips compiling) |
| global: `-T/--target`, `-R/--project-root`, `-e/--env`, `-E/--public-env`, `--non-interactive`, `-v` | |

### 6.3 The private key: `CRE_ETH_PRIVATE_KEY`

Source: `cmd/workflow/simulate/chain/evm/chaintype.go`, `ResolveKey` (v1.35.0).

- It's read from `.env` (project root, or `-e`) or the environment.
  - 64 hex characters; a `0x` prefix is stripped; **no quotes**.
- **With `--broadcast`, a valid key is mandatory.** Without one the CLI says "a
  private key is required for --broadcast mode", and it refuses the built-in
  sentinel key.
- The account must hold testnet MON.
- **Without `--broadcast`,** a missing key falls back to a sentinel key with the
  warning "Using default private key for chain write simulation".

What `--broadcast` does (source:
`chainlink/core/capabilities/fakes/evm_chain.go`, `FakeEVMChain.WriteReport`):

1. From that key, it calls
   `MockKeystoneForwarder.report(receiver, rawReport, reportContext, sigs)` on
   the configured RPC.
2. It sets `GasLimit = gasConfig.gasLimit` when you give one.
3. It waits for the receipt.

### 6.4 In simulation, "success" only means the transaction didn't revert

`FakeEVMChain.WriteReport` sets `ReceiverContractExecutionStatus = SUCCESS`
whenever the receipt status is 1. But the mock forwarder never reverts when the
receiver does: `route()` returns `false` and `report()` emits
`ReportProcessed(receiver, executionId, reportId, false)`.

I confirmed this on Monad testnet with `eth_call` and state overrides:

- An ERC-165-correct receiver whose `onReport` reverts made `route()` return
  `false`, and the unsigned `report()` still succeeded.
- A receiver that doesn't revert made `route()` return `true`.

**So a simulated write "succeeds" even when `PolarisCollector` reverted.** Check
our own events (`Collected`, `Skipped`), or the forwarder's
`ReportProcessed.result`.

### 6.5 Commands for our two workflows

Run from `cre/`, the project root.

```bash
bun install --cwd collections && bun install --cwd underwrite

# collections: one run, real transaction on Monad testnet
cre workflow simulate ./collections -T staging-settings --non-interactive --trigger-index 0 --broadcast

# underwrite: one run with a payload file (easier than quoting JSON in PowerShell)
cre workflow simulate ./underwrite -T staging-settings --non-interactive --trigger-index 0 \
  --http-payload ./underwrite/payload.json --broadcast

# underwrite, live: the simulator stays up and our API POSTs to it
cre workflow simulate ./underwrite -T staging-settings --listen --broadcast
curl -X POST http://localhost:2000/trigger -H "Content-Type: application/json" \
  -d '{"input":{"user":"0xBuyer","wallet":"0xHistoryWallet"}}'
```

**Listen mode:** the endpoint is **`POST /trigger`** and the body is
**`{"input": <payload>}`**. Source: `startHTTPListenPayloadServer` and
`parseHTTPTriggerRequest` in `cmd/workflow/simulate/simulate.go` at v1.35.0,
which also prints this exact `curl` hint.

- The docs' example posts the raw payload to `http://localhost:2000`, and that
  won't match the handler.
- The server answers `200` as soon as the request is **queued**, with a queue
  of 16 and `429` when full. It doesn't return the workflow's result.

**Cron under simulation fires once per run.** The docs: "Time-based triggers
(cron) execute immediately when selected, not on a schedule." `--listen` doesn't
support cron. For the demo's "every minute", loop it and reuse the built WASM:

```powershell
cre workflow build ./collections      # -> collections/binary.wasm (no login needed)
while ($true) {
  cre workflow simulate ./collections -T staging-settings --non-interactive --trigger-index 0 --broadcast --wasm ./collections/binary.wasm
  Start-Sleep -Seconds 60
}
```

**UNVERIFIED:** the loop itself, since simulate needs a login. `--wasm` and the
other flags come from `--help`.

Also worth knowing:

- **Simulation is one node,** so there's no real consensus. Every aggregation
  sees one observation.
- By default it **enforces production limits** (`--limits default`). Keep that
  on, so batch sizes that pass locally also pass on the DON.

---

## 7. Consumer contracts

Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts,
and `smartcontractkit/cre-templates`. The template copy is **byte-identical** to
the docs' at
`starter-templates/prediction-market/prediction-market-ts/contracts/evm/src/ReceiverTemplate.sol`;
some other templates differ only in comments.

The three files below are MIT-licensed. I copied them by script from those
sources, so they're exact, and compiled them with solc 0.8.24 and OpenZeppelin
5.6.1.

### 7.1 `IReceiver.sol`, verbatim from the docs page

The on-chain original in `chainlink-evm` imports `@openzeppelin/contracts@5.0.2/.../IERC165.sol`
instead of `./IERC165.sol`, and is otherwise the same interface.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from "./IERC165.sol";

/// @title IReceiver - receives keystone reports
/// @notice Implementations must support the IReceiver interface through ERC165.
interface IReceiver is IERC165 {
  /// @notice Handles incoming keystone reports.
  /// @dev If this function call reverts, it can be retried with a higher gas
  /// limit. The receiver is responsible for discarding stale reports.
  /// @param metadata Report's metadata.
  /// @param report Workflow report.
  function onReport(
    bytes calldata metadata,
    bytes calldata report
  ) external;
}
```

### 7.2 `IERC165.sol`

The docs link to OpenZeppelin's; this is the copy the templates ship
(`cre-templates/.../prediction-market-ts/contracts/evm/src/IERC165.sol`, OZ v5.4.0):

```solidity
// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
  /**
   * @dev Returns true if this contract implements the interface defined by
   * `interfaceId`. See the corresponding
   * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
   * to learn more about how these ids are created.
   *
   * This function call must use less than 30 000 gas.
   */
  function supportsInterface(
    bytes4 interfaceId
  ) external view returns (bool);
}
```

With OpenZeppelin 5.x already in `packages/contracts`, you can equally point
the import at `@openzeppelin/contracts/utils/introspection/IERC165.sol`. It's the
same interface, and using it avoids a second `IERC165` in the compilation.

### 7.3 `ReceiverTemplate.sol`, verbatim from the docs page

SHA-256 of this text: `cebb2e698a20ca6ba41e8bff1777a537df0715c923d9e263f2b5b3f8fe06677d`.
It needs OpenZeppelin 5.x for `Ownable(msg.sender)`, which our repo has (5.6.1),
and solc 0.8.24 compiles it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from "./IERC165.sol";
import {IReceiver} from "./IReceiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReceiverTemplate - Abstract receiver with optional permission controls
/// @notice Provides flexible, updatable security checks for receiving workflow reports
/// @dev The forwarder address is required at construction time for security.
///      Additional permission fields can be configured using setter functions.
abstract contract ReceiverTemplate is IReceiver, Ownable {
  // Required permission field at deployment, configurable after
  address private s_forwarderAddress; // If set, only this address can call onReport

  // Optional permission fields (all default to zero = disabled)
  address private s_expectedAuthor; // If set, only reports from this workflow owner are accepted
  bytes10 private s_expectedWorkflowName; // Only validated when s_expectedAuthor is also set
  bytes32 private s_expectedWorkflowId; // If set, only reports from this specific workflow ID are accepted

  // Hex character lookup table for bytes-to-hex conversion
  bytes private constant HEX_CHARS = "0123456789abcdef";

  // Custom errors
  error InvalidForwarderAddress();
  error InvalidSender(address sender, address expected);
  error InvalidAuthor(address received, address expected);
  error InvalidWorkflowName(bytes10 received, bytes10 expected);
  error InvalidWorkflowId(bytes32 received, bytes32 expected);
  error WorkflowNameRequiresAuthorValidation();

  // Events
  event ForwarderAddressUpdated(address indexed previousForwarder, address indexed newForwarder);
  event ExpectedAuthorUpdated(address indexed previousAuthor, address indexed newAuthor);
  event ExpectedWorkflowNameUpdated(bytes10 indexed previousName, bytes10 indexed newName);
  event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId);
  event SecurityWarning(string message);

  /// @notice Constructor sets msg.sender as the owner and configures the forwarder address
  /// @param _forwarderAddress The address of the Chainlink Forwarder contract (cannot be address(0))
  /// @dev The forwarder address is required for security - it ensures only verified reports are processed
  constructor(
    address _forwarderAddress
  ) Ownable(msg.sender) {
    if (_forwarderAddress == address(0)) {
      revert InvalidForwarderAddress();
    }
    s_forwarderAddress = _forwarderAddress;
    emit ForwarderAddressUpdated(address(0), _forwarderAddress);
  }

  /// @notice Returns the configured forwarder address
  /// @return The forwarder address (address(0) if disabled)
  function getForwarderAddress() external view returns (address) {
    return s_forwarderAddress;
  }

  /// @notice Returns the expected workflow author address
  /// @return The expected author address (address(0) if not set)
  function getExpectedAuthor() external view returns (address) {
    return s_expectedAuthor;
  }

  /// @notice Returns the expected workflow name
  /// @return The expected workflow name (bytes10(0) if not set)
  function getExpectedWorkflowName() external view returns (bytes10) {
    return s_expectedWorkflowName;
  }

  /// @notice Returns the expected workflow ID
  /// @return The expected workflow ID (bytes32(0) if not set)
  function getExpectedWorkflowId() external view returns (bytes32) {
    return s_expectedWorkflowId;
  }

  /// @inheritdoc IReceiver
  /// @dev Performs optional validation checks based on which permission fields are set
  function onReport(
    bytes calldata metadata,
    bytes calldata report
  ) external override {
    // Security Check 1: Verify caller is the trusted Chainlink Forwarder (if configured)
    if (s_forwarderAddress != address(0) && msg.sender != s_forwarderAddress) {
      revert InvalidSender(msg.sender, s_forwarderAddress);
    }

    // Security Checks 2-4: Verify workflow identity - ID, owner, and/or name (if any are configured)
    if (s_expectedWorkflowId != bytes32(0) || s_expectedAuthor != address(0) || s_expectedWorkflowName != bytes10(0)) {
      (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

      if (s_expectedWorkflowId != bytes32(0) && workflowId != s_expectedWorkflowId) {
        revert InvalidWorkflowId(workflowId, s_expectedWorkflowId);
      }
      if (s_expectedAuthor != address(0) && workflowOwner != s_expectedAuthor) {
        revert InvalidAuthor(workflowOwner, s_expectedAuthor);
      }

      // ================================================================
      // WORKFLOW NAME VALIDATION - REQUIRES AUTHOR VALIDATION
      // ================================================================
      // Do not rely on workflow name validation alone. Workflow names are unique
      // per owner, but not across owners.
      // Furthermore, workflow names use 40-bit truncation (bytes10), making collisions possible.
      // Therefore, workflow name validation REQUIRES author (workflow owner) validation.
      // The code enforces this dependency at runtime.
      // ================================================================
      if (s_expectedWorkflowName != bytes10(0)) {
        // Author must be configured if workflow name is used
        if (s_expectedAuthor == address(0)) {
          revert WorkflowNameRequiresAuthorValidation();
        }
        // Validate workflow name matches (author already validated above)
        if (workflowName != s_expectedWorkflowName) {
          revert InvalidWorkflowName(workflowName, s_expectedWorkflowName);
        }
      }
    }

    _processReport(report);
  }

  /// @notice Updates the forwarder address that is allowed to call onReport
  /// @param _forwarder The new forwarder address
  /// @dev WARNING: Setting to address(0) disables forwarder validation.
  ///      This makes your contract INSECURE - anyone can call onReport() with arbitrary data.
  ///      Only use address(0) if you fully understand the security implications.
  function setForwarderAddress(
    address _forwarder
  ) external onlyOwner {
    address previousForwarder = s_forwarderAddress;

    // Emit warning if disabling forwarder check
    if (_forwarder == address(0)) {
      emit SecurityWarning("Forwarder address set to zero - contract is now INSECURE");
    }

    s_forwarderAddress = _forwarder;
    emit ForwarderAddressUpdated(previousForwarder, _forwarder);
  }

  /// @notice Updates the expected workflow owner address
  /// @param _author The new expected author address (use address(0) to disable this check)
  function setExpectedAuthor(
    address _author
  ) external onlyOwner {
    address previousAuthor = s_expectedAuthor;
    s_expectedAuthor = _author;
    emit ExpectedAuthorUpdated(previousAuthor, _author);
  }

  /// @notice Updates the expected workflow name from a plaintext string
  /// @param _name The workflow name as a string (use empty string "" to disable this check)
  /// @dev IMPORTANT: Workflow name validation REQUIRES author validation to be enabled.
  ///      The workflow name uses only 40-bit truncation, making collision attacks feasible
  ///      when used alone. However, since workflow names are unique per owner, validating
  ///      both the name AND the author address provides adequate security.
  ///      You must call setExpectedAuthor() before or after calling this function.
  ///      The name is hashed using SHA256 and truncated to bytes10.
  function setExpectedWorkflowName(
    string calldata _name
  ) external onlyOwner {
    bytes10 previousName = s_expectedWorkflowName;

    if (bytes(_name).length == 0) {
      s_expectedWorkflowName = bytes10(0);
      emit ExpectedWorkflowNameUpdated(previousName, bytes10(0));
      return;
    }

    // Convert workflow name to bytes10:
    // SHA256 hash → hex encode → take first 10 chars → hex encode those chars
    bytes32 hash = sha256(bytes(_name));
    bytes memory hexString = _bytesToHexString(abi.encodePacked(hash));
    bytes memory first10 = new bytes(10);
    for (uint256 i = 0; i < 10; i++) {
      first10[i] = hexString[i];
    }
    s_expectedWorkflowName = bytes10(first10);
    emit ExpectedWorkflowNameUpdated(previousName, s_expectedWorkflowName);
  }

  /// @notice Updates the expected workflow ID
  /// @param _id The new expected workflow ID (use bytes32(0) to disable this check)
  function setExpectedWorkflowId(
    bytes32 _id
  ) external onlyOwner {
    bytes32 previousId = s_expectedWorkflowId;
    s_expectedWorkflowId = _id;
    emit ExpectedWorkflowIdUpdated(previousId, _id);
  }

  /// @notice Helper function to convert bytes to hex string
  /// @param data The bytes to convert
  /// @return The hex string representation
  function _bytesToHexString(
    bytes memory data
  ) private pure returns (bytes memory) {
    bytes memory hexString = new bytes(data.length * 2);

    for (uint256 i = 0; i < data.length; i++) {
      hexString[i * 2] = HEX_CHARS[uint8(data[i] >> 4)];
      hexString[i * 2 + 1] = HEX_CHARS[uint8(data[i] & 0x0f)];
    }

    return hexString;
  }

  /// @notice Extracts all metadata fields from the onReport metadata parameter
  /// @param metadata The metadata bytes encoded using abi.encodePacked(workflowId, workflowName, workflowOwner)
  /// @return workflowId The unique identifier of the workflow (bytes32)
  /// @return workflowName The name of the workflow (bytes10)
  /// @return workflowOwner The owner address of the workflow
  function _decodeMetadata(
    bytes memory metadata
  ) internal pure returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner) {
    // Metadata structure (encoded using abi.encodePacked by the Forwarder):
    // - First 32 bytes: length of the byte array (standard for dynamic bytes)
    // - Offset 32, size 32: workflow_id (bytes32)
    // - Offset 64, size 10: workflow_name (bytes10)
    // - Offset 74, size 20: workflow_owner (address)
    assembly {
      workflowId := mload(add(metadata, 32))
      workflowName := mload(add(metadata, 64))
      workflowOwner := shr(mul(12, 8), mload(add(metadata, 74)))
    }
    return (workflowId, workflowName, workflowOwner);
  }

  /// @notice Abstract function to process the report data
  /// @param report The report calldata containing your workflow's encoded data
  /// @dev Implement this function with your contract's business logic
  function _processReport(
    bytes calldata report
  ) internal virtual;

  /// @inheritdoc IERC165
  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override returns (bool) {
    return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
  }
}
```

### 7.4 How metadata is laid out and decoded

**The signed `rawReport` header is 109 bytes.** Sources:
`KeystoneForwarder._getMetadata` in `chainlink-evm`
(`contracts/cre/src/v1/KeystoneForwarder.sol`), and the SDK's
`REPORT_METADATA_OFFSETS` in `dist/sdk/report.js`.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | version |
| 1 | 32 | workflow execution id |
| 33 | 4 | timestamp |
| 37 | 4 | DON id |
| 41 | 4 | DON config version |
| **45** | **32** | **workflow id** |
| **77** | **10** | **workflow name** (bytes10) |
| **87** | **20** | **workflow owner** |
| **107** | **2** | **report id** |
| 109 | … | body = what our workflow encoded |

**What `onReport` receives.** Both forwarders call
`onReport(rawReport[45:109], rawReport[109:])`:

- **`metadata` is 64 bytes:**
  `workflowId (32) ‖ workflowName (10) ‖ workflowOwner (20) ‖ reportId (2)`.
  The docs warn that `require(metadata.length == 62)` breaks delivery.
- **`report`** is the raw ABI payload.

**How `_decodeMetadata` reads it.** It takes `bytes memory` and reads the first
62 bytes:

- the workflow id with `mload(add(metadata, 32))`;
- the workflow name with `mload(add(metadata, 64))`, keeping the top 10 bytes;
- the owner with `shr(96, mload(add(metadata, 74)))`.

The report id is `bytes2(metadata[62:64])`.

**Workflow-name encoding** follows the docs:

1. `sha256(name)`;
2. take the first 10 characters of its lowercase hex;
3. use those 10 ASCII bytes.

I reproduced the docs' example: `"my_workflow"` gives `0x62373666336165316465`.
For our names:

- `polaris-collections` → `0x38323961376630323863`
- `polaris-underwrite` → `0x39333731613831386437`

(They're the `workflow-name` values in `workflow.yaml`. **UNVERIFIED** that the
engine hashes exactly that string.)

**The workflow id** changes with the binary, the config and the owner.
`cre workflow hash <folder> --public_key 0x…` computes it offline, without a
login. It printed binary, config and workflow hashes for `collections`.

**In simulation,** don't set `setExpectedWorkflowId`, `setExpectedAuthor` or
`setExpectedWorkflowName`. The docs say the mock doesn't provide that metadata
and "Setting any of these will cause your simulation to fail". (**UNVERIFIED**:
what bytes the simulator actually puts there.)

### 7.5 What the forwarders actually do

Read in source, and probed on chain where marked.

| | `KeystoneForwarder` (production) | `MockKeystoneForwarder` (simulation) |
|---|---|---|
| Who may call `report()` | anyone, but it **verifies f+1 DON signatures** against the stored config (`InvalidConfig`, `InvalidSignatureCount`, `InvalidSigner`) | **anyone, with no signature checks**. Probed on chain: an unsigned `report()` goes through on Monad testnet, while production reverts with `InvalidConfig(uint64)` (`0xdf3b81ea`) |
| Receiver reverts | tx succeeds; `ReportProcessed(..., result=false)`; the transmission can be retried | the same (probed); **the simulator still reports SUCCESS** (§6.4) |
| Replay | `transmissionId = keccak256(receiver ‖ executionId ‖ reportId)`; once it succeeds, `AlreadyAttempted` | no replay guard in `route()`; `route()` is public and permissionless too |
| Gas | `route` needs `gasleft() − 30,000 ≥ 130,000` or it reverts `InsufficientGasForRouting`; the ERC-165 check can use about 90k; the receiver gets `gasleft() − 5,000` | no minimum |

So the transaction gas limit has to cover:

- the intrinsic cost and calldata;
- the signature checks;
- about 160k before `route` runs;
- our `onReport`.

That arithmetic is **derived from source, not measured.**

### 7.6 Two traps in the docs page

1. **§5.1 "Custom Validation Logic" doesn't compile** against the docs'
   `ReceiverTemplate`. `onReport` is `external override`, not `virtual`, and
   `super.onReport` isn't allowed on an external function. solc 0.8.24 says:
   `TypeError: Trying to override non-virtual function` and
   `Member "onReport" not found or not visible after argument-dependent lookup in type(contract super AdvancedConsumer)`.
   To hook in, edit our copy, for example make `onReport` `public virtual`, or
   don't override at all (§7.7).
2. **§5.2 "Using Metadata Fields" reads the wrong bytes.** It passes
   `msg.data[4:]` to `_decodeMetadata`, but that slice starts with the ABI head,
   not the metadata. With viem, `msg.data[4:36]` is `0x…0040`, the offset of
   `metadata`, so "workflowId" comes back as `0x40`. Decode the `metadata`
   argument instead.

### 7.7 Polaris receivers (compiled sketch)

This compiles with solc 0.8.24 against the verbatim template above. It follows
plan §5.2 item 8, with one change I recommend (§12):

- **split into two receivers,** each a plain `ReceiverTemplate`;
- a **simulation-only `tx.origin` guard** on the one that writes credit.

`ScoreManager` and `collectInstallment` are the plan's contracts; only their
interfaces are assumed here.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

interface ILoanEngine {
  function collectInstallment(uint256 loanId) external;
}

/// Receives the `collections` workflow's report: abi.encode(uint8 kind, uint256[] loanIds)
contract PolarisCollector is ReceiverTemplate {
  uint8 internal constant KIND_COLLECT = 1;
  ILoanEngine public immutable loanEngine;

  event Collected(uint256 indexed loanId);
  event Skipped(uint256 indexed loanId, bytes reason);
  error UnknownKind(uint8 kind);

  constructor(address forwarder, ILoanEngine engine) ReceiverTemplate(forwarder) {
    loanEngine = engine;
  }

  function _processReport(bytes calldata report) internal override {
    (uint8 kind, uint256[] memory loanIds) = abi.decode(report, (uint8, uint256[]));
    if (kind != KIND_COLLECT) revert UnknownKind(kind);
    for (uint256 i; i < loanIds.length; ++i) {
      try loanEngine.collectInstallment(loanIds[i]) {
        emit Collected(loanIds[i]);
      } catch (bytes memory reason) {
        emit Skipped(loanIds[i], reason); // "short on funds" vs "allowance lost" is in the revert data
      }
    }
  }
}

struct Facts {
  uint32 walletAgeDays;
  uint32 txCount;
  uint64 portfolioUsd;
  uint32 counterparties;
  uint32 relatedWallets;
  bool firstFunderIsExchange;
  uint64 observedAt;
}

interface IScoreManager {
  function underwrite(address user, Facts calldata facts) external;
}

/// Receives the `underwrite` workflow's report:
/// abi.encode(uint8 kind, address user, <Facts fields in order>) -- a static tuple, so it
/// decodes as (uint8, address, Facts).
contract PolarisUnderwriter is ReceiverTemplate {
  uint8 internal constant KIND_UNDERWRITE = 2;
  IScoreManager public immutable scoreManager;
  /// While wired to the permissionless MockKeystoneForwarder (simulation), only the
  /// simulator's broadcaster may deliver. Zero once on the real KeystoneForwarder.
  address public simulationTransmitter;

  error UnknownKind(uint8 kind);
  error NotSimulationTransmitter(address origin);

  constructor(address forwarder, IScoreManager sm, address simTransmitter) ReceiverTemplate(forwarder) {
    scoreManager = sm;
    simulationTransmitter = simTransmitter;
  }

  function setSimulationTransmitter(address t) external onlyOwner {
    simulationTransmitter = t;
  }

  function _processReport(bytes calldata report) internal override {
    if (simulationTransmitter != address(0) && tx.origin != simulationTransmitter) {
      revert NotSimulationTransmitter(tx.origin);
    }
    (uint8 kind, address user, Facts memory facts) = abi.decode(report, (uint8, address, Facts));
    if (kind != KIND_UNDERWRITE) revert UnknownKind(kind);
    scoreManager.underwrite(user, facts); // ScoreManager enforces freshness (observedAt) and one-shot
  }
}
```

**Why a `tx.origin` guard is sound here.** During simulation the only
legitimate sender is the `CRE_ETH_PRIVATE_KEY` account that calls
`mock.report()`, so `tx.origin` is that key. A stranger calling `mock.report()`
or `mock.route()` has their own `tx.origin`.

Before switching to the real forwarder:

1. set `simulationTransmitter` to zero;
2. `setForwarderAddress(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`;
3. `setExpectedAuthor(<our workflow owner>)` and `setExpectedWorkflowName("polaris-underwrite")`.

**UNVERIFIED:** how to read the org-derived owner address for the private
registry. Try `cre workflow hash` after login, or the deploy output.

---

## 8. Execution limits and what they mean for batch size

**Sources:** `cre workflow limits export` (CLI v1.35.0, verbatim below; these are
the limits `simulate` enforces by default) and
https://docs.chain.link/cre/service-quotas (updated 2026-09-16).

```json
{
  "TriggerRegistrationsTimeout": "10s",
  "TriggerSubscriptionTimeout": "15s",
  "TriggerSubscriptionLimit": "10",
  "TriggerEventQueueLimit": "50",
  "TriggerEventQueueTimeout": "10m0s",
  "CapabilityConcurrencyLimit": "30",
  "CapabilityCallTimeout": "3m0s",
  "SecretsConcurrencyLimit": "5",
  "ExecutionConcurrencyLimit": "50",
  "ExecutionTimeout": "5m0s",
  "ExecutionResponseLimit": "100kb",
  "ExecutionTimestampsEnabled": "false",
  "WASMMemoryLimit": "100mb",
  "WASMBinarySizeLimit": "100mb",
  "WASMCompressedBinarySizeLimit": "20mb",
  "WASMConfigSizeLimit": "1mb",
  "WASMSecretsSizeLimit": "1mb",
  "LogLineLimit": "1kb",
  "LogEventLimit": "1000",
  "CRONTrigger": {
    "FastestScheduleInterval": "30s"
  },
  "HTTPTrigger": {
    "RateLimit": "every30s:1"
  },
  "LogTrigger": {
    "EventRateLimit": "every6s:10",
    "EventSizeLimit": "5kb",
    "FilterAddressLimit": "5",
    "FilterTopicsPerSlotLimit": "10"
  },
  "ChainWrite": {
    "TargetsLimit": "10",
    "ReportSizeLimit": "50kb",
    "EVM": {
      "TransactionGasLimit": "10000000",
      "ReportSizeLimit": "50000",
      "GasLimit": {
        "Default": "10000000",
        "Values": {}
      }
    },
    "Solana": {
      "ReportSizeLimit": "265b",
      "GasLimit": {
        "Default": "300000",
        "Values": {}
      }
    }
  },
  "ChainRead": {
    "CallLimit": "15",
    "LogQueryBlockLimit": "100",
    "PayloadSizeLimit": "5kb"
  },
  "Consensus": {
    "ObservationSizeLimit": "25kb",
    "CallLimit": "50"
  },
  "HTTPAction": {
    "CallLimit": "15",
    "CacheAgeLimit": "10m0s",
    "ConnectionTimeout": "10s",
    "RequestSizeLimit": "120kb",
    "ResponseSizeLimit": "250kb"
  },
  "ConfidentialHTTP": {
    "CallLimit": "15",
    "ConnectionTimeout": "90s",
    "RequestSizeLimit": "125kb",
    "ResponseSizeLimit": "500kb"
  },
  "Secrets": {
    "CallLimit": "5"
  }
}
```

| Limit | Value | What it means for Polaris |
|---|---|---|
| Cron fastest interval | 30 s | "every minute" is fine |
| HTTP trigger rate | **1 per 30 s, burst 1** (per workflow) | `underwrite` can't serve two buyers inside 30 s; our API must queue |
| Execution timeout | 5 min; each capability call 3 min | a whole run, including the write receipt, fits |
| Concurrent executions | 50 per workflow; 200 per owner | overlapping cron runs are possible, and collection is idempotent anyway |
| EVM reads (`ChainRead.CallLimit`) | **15 per execution** | one batched read per run |
| EVM read payload | **5 KB** ("maximum size of an EVM read request payload") | Multicall3: at most about 20 `isInstallmentDue` calls; `dueOf(uint256[])`: about 150 IDs (§5.2) |
| Log query range | 100 blocks | don't page history in-workflow; that's the indexer's job |
| Report size | **50 KB** (`ReportSizeLimit: 50000`) | `uint256[]` IDs: about 1,500. Not the binding limit |
| EVM tx gas | **10,000,000** | **the binding limit** for collections: measure `collectInstallment` gas; `maxBatch ≈ (10M − overhead) / perItem`, and keep it well below |
| Write targets | 10 chains | n/a |
| HTTP calls | **15 per execution**; 10 s connect; request 120 KB; response **250 KB**; cache at most 10 min | `underwrite`: 4–6 calls per wallet, so two or three wallets per run. Keep Nansen responses small |
| Consensus | 50 calls per execution; **25 KB per observation** | reduce raw API data to numbers *before* consensus, as §5.6 does |
| Secrets | 5 fetch calls per execution; 100 per owner; 2 KB each | use one `getSecrets([...])` |
| Logs | 1 KB per line; 1,000 per execution | don't log whole API responses |
| Execution result | 100 KB | return a tx hash, not data |
| WASM | 100 MB raw, 20 MB compressed; memory 100 MB | ours are about 2.6 MB |
| Config size | **the docs say 50 KB; the CLI export says `1mb`** | small either way |
| Secrets size | **the docs say 27 KB; the CLI export says `1mb`** | small either way |
| Registry | **private registry: 3 workflows per organisation** | `collections` + `underwrite` fits. Don't also deploy `-staging` copies |

The quota enforcement note from the docs: over-quota executions queue and retry
for up to 10 minutes, then they're dropped.

---

## 9. Deploying later (Early Access)

Sources:

- https://docs.chain.link/cre/account/deploy-access
- https://docs.chain.link/cre/guides/operations/deploying-workflows
- https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows

**Deploy access:**

- `cre account access` checks access and requests it; `cre whoami` shows
  `Deploy Access: Enabled` once it's granted.
- Access is needed **only for `cre workflow deploy`**. Simulation doesn't need it.

**Registry:** use `deployment-registry: "private"` in `workflow.yaml`. It's
authorised by the login session and needs no wallet, no ETH and no mainnet RPC.

```bash
cre workflow deploy ./collections -T production-settings
```

**The HTTP trigger once deployed:**

- `authorizedKeys` is mandatory; `{}` works only in simulation.
- Our API calls `POST https://01.gateway.zone-a.cre.chain.link` with this body:

  ```json
  {"jsonrpc":"2.0","id":"…","method":"workflows.execute","params":{"input":{…},"workflow":{"workflowID":"<64 hex>"}}}
  ```

- It sends `Authorization: Bearer <JWT>`, built like this:
  - header `{"alg":"ETH","typ":"JWT"}`;
  - payload `{digest:"0x"+sha256(key-sorted JSON body), iss, iat, exp (at most 5 min), jti}`;
  - signed with EIP-191 over `b64url(header).b64url(payload)` as `r‖s‖v`.
- The response is **asynchronous**: `result.status: "ACCEPTED"` plus a
  `workflow_execution_id`. The credit line therefore reaches the app from the
  indexed `ScoreManager` event, which fits plan §5.6's "only from chain events"
  rule.

---

## 10. Where the docs and the code disagree (the code wins)

| Topic | Docs | Code (v1.35.0 CLI / 1.22.0 SDK) |
|---|---|---|
| HTTP `cacheSettings` | `{ readFromCache: true, maxAgeMs: 60000 }` | `{ store: true, maxAge: "60s" }`; the docs form doesn't type-check |
| `--listen` HTTP endpoint | `POST http://localhost:2000` with the raw payload | `POST http://localhost:2000/trigger` with `{"input": <payload>}` |
| Overriding `onReport` (§5.1 of the consumer page) | `external override` + `super.onReport` | doesn't compile against the docs' own template |
| Metadata in business logic (§5.2) | `_decodeMetadata(msg.data[4:])` | decodes the ABI head (`workflowId == 0x40`) |
| `MonadTestnet` TS constant (TS SDK 1.19.0 release notes) | "Added `MonadTestnet` … constants" | no such export in 1.22.0's `.d.ts`; use `getNetwork` or `SUPPORTED_CHAIN_SELECTORS["monad-testnet"]` |
| Consensus docs example | `JSON.parse(response.body.toString())` | `body` is a `Uint8Array`; use `json(response)` or `text(response)` |
| Config and secrets size quota | 50 KB and 27 KB | the CLI export says `1mb` for both |

---

## 11. UNVERIFIED (could not check)

- **Any end-to-end `cre workflow simulate` run,** because it needs a login. That
  includes:
  - `--broadcast` on Monad testnet with our contracts;
  - listen mode;
  - the PowerShell loop.
- `consensusIdenticalAggregation<string[]>()` at runtime. It type-checks and
  compiles, and the SDK serialises lists. If it misbehaves, return
  `ids.join(",")` as a string.
- Whether our organisation may deploy to `monad-testnet`. A DON serves that
  forwarder (§4), but `cre workflow supported-chains` needs a login.
- What a deployed DON does when `gasConfig` is omitted, and whether it retries a
  failed transmission with more gas.
- The exact bytes the simulator writes into the metadata fields.
- Whether the engine's workflow-name hash uses the `workflow.yaml` name as is.
- How long a `cre login` session lasts.
- Whether HTTP-trigger `authorizedKeys` are checked in simulation. The docs say
  `{}` is fine there.
- How to find the org-derived workflow owner for `setExpectedAuthor` on the
  private registry.
- The Nansen and Zerion request shapes in §5.6. They're in scope for their own
  notes.
- Gas per `collectInstallment`, and the forwarder's real overhead on Monad.
  Measure these once the contracts exist.
- The `cre init --non-interactive …` line in §3.1 (needs a login).

---

## 12. What Polaris should do (mapped to `docs/plan.md`)

1. **§11 Day 0: create the CRE account and install the tools.**
   - Create the CRE account (app.chain.link/cre/discover, with 2FA), run
     `cre login`, then `cre account access`.
   - Install CLI v1.35.0 (§2) and Bun ≥ 1.2.21.
   - "Simulate a hello-world cron workflow" works only after `cre login`.
   - Pin `@chainlink/cre-sdk` to **1.22.0** exactly.
2. **§5.4 / §6 item 7: scaffold `cre/` at the repo root.**
   - Use §3.2's files, with `collections/` and `underwrite/` inside it.
   - It's outside the pnpm workspace; install with `bun install` per workflow.
   - Commit no `.env`, `binary.wasm` or `node_modules`.
3. **§5.2 item 8 changes: split the receiver in two.**
   - `PolarisCollector` takes collections reports only; `PolarisUnderwriter`
     takes underwriting reports only. Each is an unmodified `ReceiverTemplate`
     (§7.7).
   - The template's `_processReport` can't see metadata, and the docs' override
     path doesn't compile, so two receivers is the cleanest way to lock each
     workflow separately.
   - In production, use `setExpectedAuthor` + `setExpectedWorkflowName`, which
     stay stable across redeploys. The workflow id changes whenever the binary or
     config does.
   - Keep each item in its own `try/catch` and emit `Skipped(id, reason)`. It
     feeds the dunning ladder, and it's the only reliable success signal under
     simulation (§6.4).
4. **§5.2 item 10 test "a forged report is refused by the receiver":** write it
   against the **production** path (wrong forwarder, wrong author). While on the
   mock, `PolarisUnderwriter` must also enforce `simulationTransmitter` (§7.7).
   Add a test that a stranger calling `mock.report()` can't open credit.
5. **§3.3 collections: don't batch through Multicall3.**
   - Add a view `dueOf(uint256[] ids) returns (uint256[])` to `PolarisCollector`
     or the engine. Extend it to subscription and liquidation IDs, for example
     `(uint8 kind, uint256 id)[]`.
   - One `callContract` then covers about 150 candidates, against about 20 with
     Multicall3 under the 5 KB read cap.
   - **Size `maxBatch` by gas, not by report size.** Measure
     `collectInstallment`, `chargeDue` and `liquidate` in Hardhat.
   - Set `gasConfig.gasLimit` from an estimate plus about 15%, never the 10M cap,
     because Monad bills the limit (§5.3 of the plan). `evm.estimateGas` can do
     it inside the workflow (§5.2).
6. **§3.3 underwrite: queue it and keep the calls few.**
   - The HTTP trigger fires **once per 30 s**, so the API should queue *Bring
     your history* requests.
   - Budget at most 15 HTTP calls per run, so two or three wallets.
   - Put `cacheSettings: { store: true, maxAge: "300s" }` on every Nansen and
     Zerion call, so a DON of N nodes doesn't spend N× the Nansen credits.
   - Reduce to numbers before consensus: numbers by `median`, flags by
     `identical`.
   - Let `ScoreManager` check `observedAt` against `block.timestamp` (15 min).
7. **§6 item 7, demo and evidence.**
   - Collections under simulation is a loop (§6.5), each run a real
     `--broadcast` to the mock forwarder on Monad testnet. Keep the
     `simulate` logs and transaction hashes for the Chainlink evidence row in §9.
   - For live underwriting in the demo, run `simulate ./underwrite --listen
     --broadcast`, and have the API `POST localhost:2000/trigger` with
     `{"input":…}`.
   - The result arrives on chain. The app reads it from Envio, never from the
     HTTP response.
8. **§3.3 "Still request Early Access."** When it lands:
   1. deploy both workflows to the **private** registry (3-workflow cap);
   2. move the Vault secrets across with `--secrets-auth=browser`;
   3. repoint both receivers with `setForwarderAddress(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`;
   4. clear `simulationTransmitter`;
   5. set the author and name checks.

   Our API then fires `underwrite` through the gateway with an ETH-signed JWT
   (§9), implemented from the spec because the reference is BUSL.
9. **Appendix A:** mark all four forwarder addresses as verified on chain (§4),
   and fill in Multicall3 on testnet as `0xcA11bde05977b3631167028862bE2a173976CA11`.
10. **README (§9 of the plan):** attribute `@chainlink/cre-sdk` (BUSL-1.1),
    `ReceiverTemplate.sol` (MIT, Chainlink) and viem and zod (MIT).

---

## Sources

- CRE docs, one bundle: https://docs.chain.link/cre/llms-full-ts.txt. Pages
  used: `/cre/getting-started/cli-installation/windows`,
  `/cre/reference/cli/project-setup-ts`, `/cre/reference/project-configuration-ts`,
  `/cre/supported-networks-ts`,
  `/cre/guides/workflow/using-evm-client/forwarder-directory-ts`,
  `/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts`,
  `/cre/guides/workflow/using-evm-client/onchain-write/writing-data-onchain`,
  `/cre/guides/workflow/using-evm-client/onchain-read-ts`,
  `/cre/guides/workflow/using-http-client/post-request-ts`,
  `/cre/reference/sdk/consensus-ts`,
  `/cre/guides/workflow/using-triggers/cron-trigger-ts`,
  `/cre/guides/workflow/using-triggers/http-trigger/configuration-ts`,
  `/cre/guides/workflow/using-triggers/http-trigger/testing-in-simulation`,
  `/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows`,
  `/cre/guides/workflow/secrets` (plus the `-simulation-ts` and `-deployed`
  pages), `/cre/guides/operations/simulating-workflows`,
  `/cre/guides/operations/understanding-limits`, `/cre/service-quotas`,
  `/cre/guides/workflow/time-in-workflows-ts`,
  `/cre/concepts/typescript-wasm-runtime`, `/cre/account/cli-login`,
  `/cre/account/deploy-access`, `/cre/reference/cli/authentication`,
  `/cre/guides/operations/deploying-workflows`, `/cre/release-notes`.
- CLI: https://github.com/smartcontractkit/cre-cli (tag `v1.35.0`): `cmd/root.go`,
  `cmd/workflow/simulate/{simulate.go,limits.go,chain/evm/*.go}`,
  `cmd/creinit/*`, `internal/settings/template/*`,
  `internal/templaterepo/builtin/hello-world-ts/*`, `install/install.ps1`.
- SDK: https://www.npmjs.com/package/@chainlink/cre-sdk (1.22.0 tarball) and
  https://github.com/smartcontractkit/cre-sdk-typescript
- Templates: https://github.com/smartcontractkit/cre-templates
  (`keeper-bot-ts`, `kv-store-ts`, `prediction-market-ts`).
- Forwarders:
  https://github.com/smartcontractkit/chainlink-evm/blob/develop/contracts/cre/src/v1/KeystoneForwarder.sol
  and `.../contracts/cre/src/dev/MockKeystoneForwarder.sol`. The simulator's
  write path is
  https://github.com/smartcontractkit/chainlink/blob/develop/core/capabilities/fakes/evm_chain.go
- Chain selectors: https://github.com/smartcontractkit/chain-selectors
  (`selectors.yml`).
- On chain: `https://testnet-rpc.monad.xyz` and `https://rpc.monad.xyz`
  (`typeAndVersion`, `eth_getCode`, `eth_call` with state overrides,
  `ReportProcessed` logs), and https://testnet.monadscan.com/address/0xF8344CFd5c43616a4366C34E3EEE75af79a74482
