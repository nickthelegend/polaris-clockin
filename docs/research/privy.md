# Privy on Monad: research for Polaris

Researched 26 Sep 2026 for `docs/plan.md` §3.2 (the Privy bounty), §5.3 (the
policy-locked relayer), §5.7 (Polaris for Business: login, payout wallet,
automatic payouts), §6 items 5, 6 and 12, and the Day-0 list in §11.

Everything below comes from one of these primary sources:

- the npm tarballs of `@privy-io/react-auth@3.45.0`, `@privy-io/node@0.35.0`,
  `@privy-io/chains@0.6.1` and `viem@2.56.9` (types, source and README);
- the raw markdown of docs.privy.io (`https://docs.privy.io/<page>.md`);
- Privy's OpenAPI spec (`https://api.privy.io/v1/openapi.json`);
- Privy's pricing page;
- Monad's docs, for the testnet subsidy.

I also type-checked the snippets in §2 to §6 against those exact packages
(see §11). Anything I could not check is marked **UNVERIFIED**. Where the docs
and the shipped SDK disagree, the SDK wins, and §10 lists every case.

---

## 0. The short version (read this if nothing else)

1. **Use `@privy-io/node`, not `@privy-io/server-auth`.** `server-auth` is
   deprecated on npm ("use @privy-io/node instead"), and its last release was
   1.32.5. Pin `@privy-io/react-auth@3.45.0` and `@privy-io/node@0.35.0`.
   `viem@2.56.9` exports both **`monadTestnet` (10143)** and **`monad` (143)**
   from `viem/chains`.
2. **Unmatched requests are denied. That is confirmed.** The policy overview
   says that if a request satisfies none of the rules, the engine defaults to
   `DENY`. A method with no rule at all is also denied, and `DENY` beats
   `ALLOW`. So "one `ALLOW` rule per call" (§5.3) is the right shape.
3. **The §5.3 policy sketch needs five fixes** (the corrected policy is in
   §5.5):
   - The rule's `method` must match how we sign. If Privy signs and we
     broadcast with viem, the method is `eth_signTransaction`, not
     `eth_sendTransaction`.
   - Enforce "no MON" with a `DENY` rule on `value gt "0"`, not an `ALLOW`
     condition `value eq "0"`. The Node SDK's viem adapter **drops the `value`
     field when it is 0** (checked in the source), so an `ALLOW` that needs
     `value` may never match.
   - `ethereum_calldata` needs an `abi` made of **function fragments only**.
     The schema's ABI item `type` enum has no `"error"`, so passing a full
     Hardhat ABI with custom errors may be rejected (**UNVERIFIED**).
   - Rule and policy `name` are capped at **50 characters**.
   - Add a `chain_id eq "10143"` condition.
4. **"A compromised server can't move money" holds only if the relayer's key is
   not the wallet's owner.** An owner can change a wallet's policy. A wallet
   with no owner can be driven by the app secret alone, and a policy with no
   owner can be edited by the app secret alone. The fix:
   - The wallet **owner** and the **policy owner** are an offline admin key
     quorum.
   - The relayer's key is an **additional signer** with an override policy.

   This topology is in §7.
5. **Session signers are now "signers".** On the client, call
   `useSigners().addSigners({ address, signers: [{ signerId, policyIds: [policyId] }] })`.
   `useSessionSigners` is `@deprecated in favor of useSigners`. The older
   `useDelegatedActions().delegateWallet` still ships, with no deprecation tag,
   but it takes no signer ID or policy, and the current docs don't use it. On
   the server,
   pass `authorization_context: { authorization_private_keys: [key] }` to any
   wallet call. **A signer can have only one override policy, and a wallet only
   one policy.**
6. **Automatic payouts can be locked to one address.** Give each merchant their
   own policy:
   - allow only `eth_signTypedData_v4`;
   - require domain `chainId` 10143 and `verifyingContract` = AUSD;
   - require `TransferWithAuthorization.to` = the payout address and
     `from` = `{{wallet.address}}` (a documented template variable).

   The merchant never holds MON, because the relayer submits the signature.
7. **Privy broadcasting on Monad testnet (`eip155:10143`) is not documented
   anywhere.** No page lists the chains that `eth_sendTransaction` can
   broadcast to. The safe path is the viem route (§4.3): Privy signs with
   `eth_signTransaction`, and we broadcast to our own Monad RPC. That route
   also lets us set the gas limit, which matters because Monad charges for the
   gas *limit*.
8. **Privy's gas sponsorship supports Monad and Monad Testnet, but we can't use
   it.** It works by upgrading wallets with **EIP-7702**, which §5.3 rules out.
   Other Monad gaps:
   - "User pays" (token gas) isn't offered on Monad.
   - `@privy-io/chains` has a Privy-hosted RPC for Monad *mainnet* only.
   - Wallet automations watch for deposits on Monad *mainnet* only, and their
     only action is a swap.
9. **Pricing is not a constraint.**
   - The Developer plan is free for 0 to 499 MAU, with 50K signatures and $1M of
     volume a month.
   - The policy engine, key quorums and delegated access are all included.
   - Monad's docs say "Privy is subsidizing all Monad Testnet usage"; email
     `monad@privy.io`.
10. **The docs disagree with the shipped SDK in a few places (§10).** The one
    most likely to bite: `privy.utils().auth().verifyAccessToken(token)` takes
    a **string** and returns **snake_case** fields (`user_id`, `session_id`),
    not the object and camelCase that the docs page shows.

---

## 1. Packages and versions verified

| Package | Version | How verified |
|---|---|---|
| `@privy-io/react-auth` | **3.45.0** = npm `latest` (modified 2026-09-21) | `npm view`; `npm pack` and read `dist/dts/*.d.ts` |
| `@privy-io/node` | **0.35.0** = npm `latest` (released 2026-09-21 per `CHANGELOG.md`) | `npm view`; `npm pack` and read `src/**` |
| `@privy-io/server-auth` | 1.32.5, **deprecated**. npm says "This package is deprecated... use @privy-io/node instead" | `npm view @privy-io/server-auth deprecated` |
| `@privy-io/chains` | 0.6.1 (a dependency of react-auth 3.45.0) | `npm pack`; evaluated `monadMainnet` at runtime |
| `@privy-io/js-sdk-core` | 0.76.2 (a dependency of react-auth) | `npm view` |
| `viem` | **2.56.9** = npm `latest`. react-auth 3.45.0 pins its own `viem: 2.56.0` | `npm pack`; read `chains/definitions/monad*.ts` |

Details worth knowing:

- **`@privy-io/react-auth@3.45.0`**
  - Peer dependencies: `react ^18 || ^19` and `react-dom ^18 || ^19`.
  - The Solana, `permissionless` and Abstract peers are marked optional in
    `peerDependenciesMeta`, so we don't install them.
  - Exports include `.`, `./smart-wallets`, `./solana`, `./extended-chains`
    and others.
- **`@privy-io/node@0.35.0`**
  - Supported runtimes (README): Node 20 LTS+, Deno, Bun, Cloudflare Workers,
    Vercel Edge and Nitro. It **throws in a browser**.
  - Its peers (`viem ^2.44.2`, `@solana/kit`, `@x402/*`) are all optional.
    `viem` is needed only for `@privy-io/node/viem`.
  - Subpath exports: `.`, `./resources`, `./viem`, `./solana-kit` and
    `./x402`.

---

## 2. React: Next.js App Router, email + Google, embedded wallet, Monad

### 2.1 Install

Source: https://docs.privy.io/basics/react/installation.md

```bash
pnpm add @privy-io/react-auth@3.45.0 viem@2.56.9
```

The docs list React 18+ and TypeScript 5+ as requirements. The Solana peers are
needed only if we use Solana wallets, and we don't.

### 2.2 Monad chains in viem

Source: `viem@2.56.9` → `src/chains/definitions/monadTestnet.ts` and `monad.ts`
(read from the tarball).

- **`monadTestnet`**
  - `id: 10_143`, `name: 'Monad Testnet'`, `blockTime: 400`.
  - RPC: `https://testnet-rpc.monad.xyz`.
  - Explorer: `https://testnet.monadexplorer.com`.
  - `multicall3`: `0xcA11bde05977b3631167028862bE2a173976CA11`.
  - `testnet: true`.
- **`monad`**
  - `id: 143`.
  - RPC: `https://rpc.monad.xyz` and `https://rpc1.monad.xyz`, plus `wss://`
    endpoints.
  - Explorers: Monadscan (default) and MonadVision.

`@privy-io/chains@0.6.1` (bundled with react-auth) also exports its own
`monadMainnet` (id 143). That one adds a Privy-hosted RPC,
`https://monad-mainnet.rpc.privy.systems`, and uses the explorer
`https://mainnet-beta.monvision.io`. **It has no Monad testnet entry**, so on
testnet the embedded wallet uses the chain object's default RPC. Neither 10143
nor 143 is in Privy's `DEFAULT_SUPPORTED_CHAIN_IDS`, so we must pass them
explicitly.

Monad's own Privy template does exactly this. It is
`monad-developers/next-serwist-privy-embedded-wallet`, file
`app/components/privy-provider.tsx`, and it sets
`defaultChain: monadTestnet, supportedChains: [monadTestnet]` from
`viem/chains`.

### 2.3 Provider (client component)

Sources:

- https://docs.privy.io/basics/react/setup.md
- https://docs.privy.io/basics/react/advanced/configuring-evm-networks.md
- `PrivyClientConfig` in `@privy-io/react-auth@3.45.0` (`dist/dts/types-*.d.ts`)

```tsx
// apps/business/app/providers.tsx
'use client';

import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import { monadTestnet, monad } from 'viem/chains';

// Optional: point the embedded wallet at our own RPC instead of the public one.
const testnet = process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC
  ? addRpcUrlOverrideToChain(monadTestnet, process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC)
  : monadTestnet;

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID} // optional "app client"
      config={{
        loginMethods: ['email', 'google'],
        embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
        defaultChain: testnet,
        supportedChains: [testnet, monad],
        appearance: { theme: 'dark' },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

**Provider config:**

- **`loginMethods`** accepts `'email' | 'google' | ...`. Each method must also
  be enabled in the Dashboard (per the type's doc comment).
- **`createOnLogin`**:
  - Values: `'users-without-wallets' | 'all-users' | 'off'`. The default is
    `'off'`.
  - Privy's signer quickstart recommends `'all-users'`, so every merchant has a
    wallet to delegate.
- **`defaultChain` and `supportedChains`:**
  - The provider **throws** if `supportedChains` is `[]`, or if `defaultChain`
    isn't in `supportedChains` (from the configuring-evm-networks page).
  - Embedded wallets start on `defaultChain`.

**Exports:**

- `addRpcUrlOverrideToChain` is re-exported from `@privy-io/react-auth` (see
  `dist/dts/index.d.ts`, line 10). The docs import it from `@privy-io/chains`,
  which also works.

**Layout** (plain Next.js App Router, not taken from Privy's docs):

```tsx
// apps/business/app/layout.tsx
import Providers from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 2.4 Login, readiness, the embedded wallet

Sources:

- https://docs.privy.io/basics/react/setup.md ("Waiting for Privy to be ready")
- `PrivyInterface`, `useLogin`, `PrivyEvents` and `useWallets` in the 3.45.0
  types

```tsx
'use client';
import { usePrivy, useLogin, useWallets } from '@privy-io/react-auth';

export function useMerchantSession() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { login } = useLogin({
    // 3.45.0 passes ONE object (the docs' `(user, isNewUser) =>` example is out of date)
    onComplete: ({ user, isNewUser, wasAlreadyAuthenticated, loginMethod }) => {
      if (isNewUser) void fetch('/api/merchant/onboard', { method: 'POST' }); // registerFor server-side
    },
  });
  const { wallets, ready: walletsReady } = useWallets();
  const payoutWallet = wallets.find((w) => w.walletClientType === 'privy'); // the embedded wallet
  return { ready, authenticated, user, login, logout, getAccessToken, walletsReady, payoutWallet };
}
```

- `onComplete` runs after the embedded wallet is created when `createOnLogin`
  isn't `'off'` (from the `PrivyEvents` doc comment).
- Wait for `ready` from `usePrivy()`, and for `ready` from `useWallets()`,
  before reading state.

### 2.5 Sign EIP-712 typed data with the embedded wallet

Sources:

- https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data.md
- `useSignTypedData` in the 3.45.0 types

Signature:

```ts
signTypedData(input: SignTypedDataParams, options?: { uiOptions?: SignMessageModalUIOptions; address?: string }): Promise<{ signature: string }>
```

`SignTypedDataParams` is `{ types, primaryType, domain: { name?, version?, chainId?: number, verifyingContract?, salt? }, message: Record<string, unknown> }`.

```tsx
'use client';
import { useSignTypedData, useWallets } from '@privy-io/react-auth';

export function useSignPayout() {
  const { signTypedData } = useSignTypedData();
  const { wallets } = useWallets();

  return async (p: { ausd: `0x${string}`; to: `0x${string}`; value: string; validBefore: string; nonce: `0x${string}` }) => {
    const wallet = wallets.find((w) => w.walletClientType === 'privy')!;
    const { signature } = await signTypedData(
      {
        domain: { name: '<AUSD eip712Domain().name>', version: '<AUSD eip712Domain().version>', chainId: 10143, verifyingContract: p.ausd },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: { from: wallet.address, to: p.to, value: p.value, validAfter: '0', validBefore: p.validBefore, nonce: p.nonce },
      },
      { address: wallet.address, uiOptions: { title: 'Confirm withdrawal', buttonText: 'Confirm' } },
    );
    return signature; // POST to our API; the relayer calls AUSD.transferWithAuthorization
  };
}
```

**About this snippet:**

- **The type string.** It is copied from AUSD's `Eip3009.sol`:
  `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
  Read the domain's `name` and `version` at runtime from AUSD's
  `eip712Domain()` (EIP-5267). AUSD exposes it in `AgoraDollar.sol`.
- **Hiding the modal.** Pass `uiOptions: { showWalletUIs: false }`, or set
  `embeddedWallets.showWalletUIs` in the config.
- **uint256 values.** `message` is typed `Record<string, unknown>`, and I did not
  find where 3.45.0 serialises `bigint`, so **pass uint256 values as decimal
  strings** (**UNVERIFIED** whether bigints work).
- **The viem alternative.** `toViemAccount({ wallet })` is exported from
  `@privy-io/react-auth` and returns a viem `LocalAccount`, so
  `account.signTypedData({...})` also works.

### 2.6 Send the access token to our API

Source: https://docs.privy.io/authentication/user-authentication/access-tokens.md

```ts
const { getAccessToken } = usePrivy();
const accessToken = await getAccessToken(); // auto-refreshes; ES256 JWT, ~1h expiry
await fetch('/api/payouts', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

With HTTP-only cookies turned on in the Dashboard, the token arrives instead as
the `privy-token` cookie.

---

## 3. Server: verify the access token in a Next.js route handler

Sources:

- https://docs.privy.io/basics/nodeJS/setup.md
- https://docs.privy.io/authentication/user-authentication/access-tokens.md
- `@privy-io/node@0.35.0` `src/public-api/services/utils/auth.ts` and
  `src/lib/auth.ts`

```bash
pnpm add @privy-io/node@0.35.0 viem@2.56.9
```

```ts
// apps/business/lib/privy.ts (server-only)
import { PrivyClient } from '@privy-io/node';

export const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
  // Optional: paste the verification key from Dashboard > Configuration > App settings
  // to skip the JWKS fetch on the first verification.
  jwtVerificationKey: process.env.PRIVY_VERIFICATION_KEY,
});
```

```ts
// apps/business/app/api/me/route.ts
import { privy } from '@/lib/privy';

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    // 0.35.0: takes a STRING (not { access_token }) and returns snake_case fields.
    const claims = await privy.utils().auth().verifyAccessToken(token);
    // claims: { app_id, issuer, issued_at, expiration, session_id, user_id }
    return Response.json({ userId: claims.user_id });
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
}
```

**How verification works** (from the source):

- It checks `alg: ES256`, `iss: 'privy.io'` and `aud: <appId>` with `jose`.
- It throws on any failure.
- There is also a standalone export: `import { verifyAccessToken } from '@privy-io/node'`.
  It takes `{ access_token, app_id, verification_key }`, and that object
  signature is the one the docs page shows.

**To get the merchant's wallet ID** for later server calls:

- The call is `const user = await privy.users()._get(claims.user_id)`.
- The embedded wallet is the `linked_accounts` entry with `type: 'wallet'` and
  `connector_type: 'embedded'`. Its `id` is the wallet ID. It also has
  `delegated: true` once a signer is added.
- The use-signers page shows this call: https://docs.privy.io/wallets/using-wallets/signers/use-signers.md
- Alternative: `privy.wallets().list({ user_id })`, where `user_id` is a
  documented filter on `WalletListParams`.

---

## 4. Server wallets

### 4.1 Create a wallet

Sources:

- https://docs.privy.io/basics/nodeJS/quickstart.md
- https://docs.privy.io/wallets/wallets/create/create-a-wallet.md
- `WalletCreateParams` in `src/resources/wallets/wallets.ts`

```ts
// Simplest "app-owned" wallet: no owner, so the app secret alone controls it.
const w = await privy.wallets().create({ chain_type: 'ethereum' });
// -> { id, address, chain_type, owner_id: null, policy_ids: [], additional_signers: [], ... }
```

`WalletCreateParams` fields:

| Field | Meaning |
|---|---|
| `chain_type` | `'ethereum'` for us |
| `owner` | `{ user_id }` or `{ public_key }`. A public key makes Privy create a 1-of-1 key quorum and return its ID as `owner_id` |
| `owner_id` | An existing key quorum ID |
| `policy_ids` | **"An optional list of up to one policy ID"** |
| `additional_signers` | `[{ signer_id, override_policy_ids? }]` |
| `display_name` | Up to 100 characters |
| `external_id` | Write-once, `[a-zA-Z0-9_-]`, up to 64 characters |
| `idempotency_key` | Becomes the `privy-idempotency-key` header |

**What an owner means** (https://docs.privy.io/api-reference/authorization-signatures.md):

- If `owner_id` is set, these requests need an authorization signature from the
  owner:
  - `POST /v1/wallets/{id}/rpc`
  - `PATCH /v1/wallets/{id}`
  - `PATCH /v1/policies/{id}` and `DELETE /v1/policies/{id}`
- If `owner_id` is not set, the app secret alone is enough.

For the Polaris relayer, use the owned topology in §7, not the ownerless one.

### 4.2 Send a transaction on Monad testnet: Privy signs and broadcasts (route A)

Sources:

- https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction.md
- https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction.md
- `EthereumSendTransactionRpcInput` and `UnsignedStandardEthereumTransaction`
  in 0.35.0

```ts
const { hash, transaction_id } = await privy.wallets().ethereum().sendTransaction(walletId, {
  caip2: 'eip155:10143',
  params: {
    transaction: {
      to: POLARIS_CHECKOUT,
      data, // encodeFunctionData(...)
      value: '0x0',
      chain_id: 10143,        // pass it explicitly; policies read the verbatim tx
      gas_limit: '0x30d40',   // Monad bills the gas LIMIT: estimateGas * 1.15, never a blanket 1M
    },
  },
  authorization_context: { authorization_private_keys: [process.env.RELAYER_AUTH_KEY!] },
  idempotency_key: `openPlan:${orderId}`,
});
```

**Transaction fields and response:**

- The transaction accepts `to`, `data`, `value`, `chain_id`, `gas_limit`,
  `gas_price`, `max_fee_per_gas`, `max_priority_fee_per_gas`, `nonce`, `type`
  (`0|1|2|4`) and `authorization_list`.
- Privy fills in any missing gas, fee, nonce and type values (Node quickstart).
- The response is `{ hash, caip2, transaction_id?, transaction_request?, reference_id? }`.

**Caveats:**

- **The endpoint returns once the transaction is broadcast, not confirmed.**
  The docs say it does not wait or retry. We confirm through Envio or a receipt
  poll.
- **Idempotency:** on a 4xx or 5xx, Privy caches the response and replays it
  for the same key. Use a new key to retry after a server error. Policy
  violations are the exception: they allow a retry with the same key.
- **UNVERIFIED:** whether Privy can broadcast on `eip155:10143` at all. No
  page lists the supported CAIP-2 chains; the chain-support page only says
  "Ethereum: Includes EVM-compatible networks". Test it on Day 0 (§11). If it
  fails, use route B.
- **Don't use `sponsor: true` here.** It triggers Privy's EIP-7702 paymaster
  flow (§9).

### 4.3 Privy signs, we broadcast with viem (route B, recommended)

Sources:

- https://docs.privy.io/wallets/using-wallets/ethereum/web3-integrations.md
  (the NodeJS tab)
- `src/viem.ts` in 0.35.0

```ts
import { createViemAccount } from '@privy-io/node/viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import { monadTestnet } from 'viem/chains';

const account = createViemAccount(privy, {            // returns synchronously in 0.35.0
  walletId: RELAYER_WALLET_ID,
  address: RELAYER_ADDRESS,
  authorizationContext: { authorization_private_keys: [process.env.RELAYER_AUTH_KEY!] },
});
const transport = http(process.env.MONAD_TESTNET_RPC);
const pub = createPublicClient({ chain: monadTestnet, transport });
const wallet = createWalletClient({ account, chain: monadTestnet, transport });

const gas = ((await pub.estimateGas({ account, to, data })) * 115n) / 100n;
const hash = await wallet.sendTransaction({ to, data, gas }); // Privy runs eth_signTransaction; viem broadcasts
```

**How the adapter behaves** (read in `src/viem.ts`):

- `signTransaction` calls `privy.wallets().ethereum().signTransaction(...)`,
  so the policy method is **`eth_signTransaction`**.
- `signTypedData` runs `replaceBigInts(typedData, toHex)`, so bigint message
  fields arrive at Privy as **hex strings**.
- `formatViemTransaction` spreads fields only when they are **truthy**. So
  `value: 0n` and `nonce: 0` are **omitted** from what Privy sees. This is why
  §5.5 enforces "no MON" with a `DENY value gt 0` rather than an `ALLOW value eq 0`.

**Why route B:**

1. It works on any EVM chain, because signing needs no Privy RPC.
2. We control the gas limit and nonce (Monad).
3. Stateful policies ("aggregations", for rate or volume caps) support only
   `eth_signTransaction` and `eth_signUserOperation`, not
   `eth_sendTransaction`. Source:
   https://docs.privy.io/controls/policies/overview.md (the `reference` field
   source).

Serialise the relayer's sends through one queue, or pass `nonce` explicitly.
**UNVERIFIED:** how Privy's own nonce filling behaves under concurrent route-A
calls.

### 4.4 Sign typed data with a server wallet

Sources:

- https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data.md
  (the NodeJS tab)
- `EthereumSignTypedDataRpcInput` in 0.35.0

```ts
const { signature, encoding } = await privy.wallets().ethereum().signTypedData(walletId, {
  params: {
    typed_data: {
      domain: { name, version, chainId: 10143, verifyingContract: AUSD },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primary_type: 'TransferWithAuthorization', // snake_case on the server
      message: { from, to, value: '1000000', validAfter: '0', validBefore: String(deadline), nonce },
    },
  },
  authorization_context: { authorization_private_keys: [KEY] },
});
// encoding === 'hex'
```

Two differences from the client call:

- The key is `primary_type` (snake_case), where the React SDK uses
  `primaryType`.
- `message` goes over JSON as-is, and this direct method does **not** convert
  bigints (only the viem adapter does). Pass strings.

---

## 5. Policies

### 5.1 Schema

Source: Privy OpenAPI `https://api.privy.io/v1/openapi.json` (`components.schemas`),
cross-checked against `src/resources/policies.ts` in 0.35.0 and
https://docs.privy.io/controls/policies/overview.md.

```text
POST /v1/policies  (SDK: privy.policies().create(body))
{
  version:    "1.0"                              // required; only value
  name:       string (1..50)                     // required
  chain_type: "ethereum" | "solana" | "tron" | "sui" | ...   // required
  rules:      Rule[]                             // required
  owner?:     { public_key } | { user_id } | null      // either owner ...
  owner_id?:  <key quorum id> | null                   // ... or owner_id, not both
}
Rule {
  name:       string (1..50)
  method:     "eth_sendTransaction" | "eth_signTransaction" | "eth_signUserOperation"
            | "eth_signTypedData_v4" | "personal_sign" | "eth_sign7702Authorization"
            | "wallet_sendCalls" | "exportPrivateKey" | "exportSeedPhrase" | "transfer"
            | "earn_deposit" | "earn_withdraw" | "*" | (solana/tron/sui/xrpl methods)
  conditions: Condition[]          // all must hold for the rule to fire; [] = always
  action:     "ALLOW" | "DENY"
}
Condition = one of (discriminated by field_source):
  { field_source: "ethereum_transaction",       field: "to" | "value" | "chain_id", operator, value }
  { field_source: "ethereum_calldata",          field: "<fn>" | "<fn>.<param>" | "function_name",
                                                abi: AbiItem[] (<=200), operator, value }
  { field_source: "ethereum_typed_data_domain", field: "chainId" | "verifyingContract"
                                                     | "chain_id" | "verifying_contract", operator, value }
  { field_source: "ethereum_typed_data_message", field: "<dot.path>",
                                                typed_data: { types, primary_type }, operator, value }
  { field_source: "ethereum_7702_authorization", field: "contract", operator, value }
  { field_source: "message",   field: "content" | "byte_length", operator, value }   // personal_sign
  { field_source: "system",    field: "current_unix_timestamp", operator, value }    // seconds
  { field_source: "reference", field: "aggregation.<id>", operator, value }         // stateful
  { field_source: "action_request_body", ... }  // wallet-action APIs (transfer/earn)
  (+ tempo_transaction, solana_*, tron_*, sui_*, xrpl_transaction)
operator: "eq" | "gt" | "gte" | "lt" | "lte" | "in" | "in_condition_set"
        | "contains" | "starts_with" | "ends_with"
value:    string | string[]          // strings only; `in` takes up to 100 values
AbiItem:  { type: "function"|"constructor"|"event"|"fallback"|"receive", name?, inputs?,
            outputs?, stateMutability?, anonymous? }       // note: no "error"
```

**Notes on the schema:**

- **There is no `neq`.** The overview page lists `neq`, but neither the OpenAPI
  `ConditionOperator` enum nor the SDK type has it. Don't rely on it.
- **Strings only.** The overview says a `value` can be a number, but the schema
  is `string | string[]`.
- **Case.** The overview says "All string comparisons are case-sensitive."
  **UNVERIFIED** whether addresses are normalised, so use
  `in: [checksummed, lowercase]` for addresses.
- **Numbers.** The overview says "The policy engine evaluates numerical data
  exactly as passed in the request body—no conversion is applied". The
  examples compare hex (`"0x2386F26FC10000"`) and decimal (`"8453"`) strings.
  **UNVERIFIED** whether `"0xf4240"` and `"1000000"` compare as equal. Keep one
  format end to end.
- **Typed-data message conditions** (the Ethereum examples page, "Restrict
  parameters of a typed data message"):
  - They only evaluate when the policy's `types` map equals the request's
    `types` map **exactly**. That includes `EIP712Domain` and field order.
  - On a mismatch the condition is `false`. So an `ALLOW` rule fails closed,
    and a `DENY` rule silently never fires.

### 5.2 Evaluation: confirmed default-deny

Source: https://docs.privy.io/controls/policies/overview.md ("Policies",
"Allowlisted RPCs and wallet actions" and "Policy evaluation").

- Only the rules whose `method` matches the request are evaluated.
- Any matching `DENY` → deny. Otherwise any matching `ALLOW` → allow.
- **No rule matched → `DENY`** (the page, quoted: "If no rules resolve, the policy will default to `DENY`").
- **No rule for the method at all → denied.** For example, a relayer policy
  with only `eth_signTransaction` rules denies `personal_sign`,
  `eth_signTypedData_v4` and `exportPrivateKey`.
- The enclave (TEE) evaluates policies.
- When Privy also broadcasts, it runs **simulation before policy**. A reverting
  transaction therefore comes back as a simulation error, not a policy
  violation.

### 5.3 Create a policy and attach it

Sources:

- https://docs.privy.io/controls/policies/create-a-policy.md
- https://docs.privy.io/wallets/wallets/update-a-wallet.md
- `src/public-api/services/policies.ts` and `wallets.ts` in 0.35.0

```ts
// create (app secret only; `owner_id` makes later edits need that quorum's signature)
const policy = await privy.policies().create({
  version: '1.0',
  name: 'polaris-relayer',
  chain_type: 'ethereum',
  owner_id: ADMIN_QUORUM_ID,
  rules: [/* see 5.5 */],
});

// attach at creation ...
await privy.wallets().create({ chain_type: 'ethereum', owner_id: ADMIN_QUORUM_ID, policy_ids: [policy.id] });

// ... or later (owner must sign when owner_id is set)
await privy.wallets().update(walletId, {
  policy_ids: [policy.id],
  authorization_context: { authorization_private_keys: [ADMIN_KEY] },
});

// edit rules later (policy owner must sign)
await privy.policies().update(policy.id, { rules: [/* ... */], authorization_context: { authorization_private_keys: [ADMIN_KEY] } });
await privy.policies().createRule(policy.id, { name, method, conditions, action, authorization_context: { authorization_private_keys: [ADMIN_KEY] } });
```

`policies().create()` takes no `authorization_context`: creating a policy needs
only the app secret. `update`, `delete`, `createRule`, `updateRule` and
`deleteRule` all take `authorization_context`. Policies can also be created in
the Dashboard under Wallet infrastructure > Policies.

### 5.4 Other primitives worth knowing

- **Condition sets** (`in_condition_set`): a managed list of values, for when
  100 `in` values aren't enough (https://docs.privy.io/controls/policies/condition-sets.md).
- **Template variable `{{wallet.address}}`:**
  - It resolves to the signing wallet's address.
  - It is allowed with `eq` or `in` on address comparisons, including
    typed-data address leaves.
  - It is not allowed with `in_condition_set` or aggregations.
  - Source: https://docs.privy.io/controls/policies/template-variables.md
- **Aggregations** (stateful policies):
  - At most **10 per app**.
  - Only for `eth_signTransaction` and `eth_signUserOperation`.
  - Values update **after** signing, so concurrent requests can overshoot.
  - Source: https://docs.privy.io/controls/policies/stateful-policies.md
- **Time bounds:** `{ field_source: 'system', field: 'current_unix_timestamp', operator: 'lte', value: '<unix seconds>' }`.

### 5.5 The Polaris relayer policy (a corrected version of the §5.3 sketch)

This assumes route B (`eth_signTransaction`). If we also keep route A,
duplicate each rule with `method: 'eth_sendTransaction'`. Generate the policy
from code so each ABI fragment comes from the compiled artifact (function
fragments only).

```ts
import { getAddress } from 'viem';
const addr = (a: string) => [getAddress(a), a.toLowerCase()]; // case-safe `in`
const fn = (abi: readonly any[], name: string) => abi.filter((x) => x.type === 'function' && x.name === name);
const onMonadTestnet = { field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: '10143' } as const;

const allowCall = (name: string, contract: string, abi: readonly any[], functionName: string) => ({
  name, // <= 50 chars
  method: 'eth_signTransaction' as const,
  action: 'ALLOW' as const,
  conditions: [
    { field_source: 'ethereum_transaction' as const, field: 'to' as const, operator: 'in' as const, value: addr(contract) },
    onMonadTestnet,
    { field_source: 'ethereum_calldata' as const, field: 'function_name', abi: fn(abi, functionName), operator: 'eq' as const, value: functionName },
  ],
});

const relayerPolicy = await privy.policies().create({
  version: '1.0',
  name: 'polaris-relayer-testnet',
  chain_type: 'ethereum',
  owner_id: ADMIN_QUORUM_ID,
  rules: [
    { name: 'Never send MON', method: 'eth_signTransaction', action: 'DENY',
      conditions: [{ field_source: 'ethereum_transaction', field: 'value', operator: 'gt', value: '0' }] },
    allowCall('Pay now: payWithAuthorization',      PAYMENTS, paymentsAbi, 'payWithAuthorization'),
    allowCall('Pay in 4: openPlan',                 CHECKOUT, checkoutAbi, 'openPlan'),
    allowCall('Subscribe: subscribe',               CHECKOUT, checkoutAbi, 'subscribe'),
    allowCall('Send by link: send',                 SEND,     sendAbi,     'send'),
    allowCall('Claim a link: claim',                SEND,     sendAbi,     'claim'),
    allowCall('Payouts: AUSD transferWithAuth',     AUSD,     ausdAbi,     'transferWithAuthorization'),
  ],
});
```

**Why each part:**

- **The `DENY value gt 0` rule.**
  - A zero-value transaction with the field omitted (the viem adapter does
    this) doesn't trip it, and any transaction carrying MON is denied
    whatever other rule matches.
  - **UNVERIFIED:** that an absent field makes the condition false rather than
    an error. Day-0 test (§11).
- **One `ALLOW` per call, with `to`, `chain_id` and `function_name`.**
  - Anything else, such as MON transfers, other contracts, `approve`,
    `personal_sign`, typed data or key export, is denied by default.
  - The owner's EIP-712 signature already binds the money inside each call
    (§5.2 of the plan), so the relayer policy doesn't need argument-level
    conditions.
- **AUSD overloads.** AUSD may expose two `transferWithAuthorization`
  overloads, `(…, v, r, s)` and `(…, bytes signature)`. Put only the one we
  call in the ABI. **UNVERIFIED:** how `function_name` matching treats
  overloads.
- **Other server wallets.** Give the fallback keeper and the
  `MerchantRegistry.registerFor` caller their own wallets and their own
  policies, in the same shape.

**Day-0 proof (plan §11):** call `openPlan` on a *different* address, or with
`value: 1n`, and expect a policy error. Call `approve` on AUSD and expect a
default deny.

---

## 6. Session signers: automatic payouts from the merchant's own wallet

### 6.1 The model

Sources:

- https://docs.privy.io/wallets/using-wallets/signers/overview.md
- https://docs.privy.io/wallets/using-wallets/signers/quickstart.md
- https://docs.privy.io/recipes/wallets/conditional-signer-policies.md
- https://docs.privy.io/controls/authorization-keys/owners/overview.md

**The parties:**

- **The owner.** The merchant's embedded wallet is created by the React SDK
  with a **user owner**.
- **The signer.** A signer is a **key quorum** that we add to the wallet's
  `additional_signers`, with an optional **override policy**. Our server holds
  the quorum's P-256 private key.

**What a signer can do** (owners-overview permissions table):

- It can sign messages and send transactions.
- It **cannot** update policies, owners or signers.
- It **cannot** export the key.

**Which policy applies:**

- Only the signer's override policy is evaluated for its requests (the
  conditional-signer-policies recipe).
- **Each signer can have one override policy** (add-signers page).
- With no override policy: the React page says no policy applies, while the
  Swift and Android pages say the wallet's default policies apply. **Always
  pass one.**

### 6.2 Set up the signer once

1. **Create a P-256 keypair and register it as a 1-of-1 key quorum.** In the
   Dashboard: Wallet infrastructure > Authorization keys > New key. The modal
   shows the key quorum ID and the private key. Or do it in code:

   Sources: https://docs.privy.io/controls/authorization-keys/keys/create/key.md
   and https://docs.privy.io/controls/key-quorum/create.md

   ```ts
   import { generateP256KeyPair } from '@privy-io/node';
   const { privateKey, publicKey } = await generateP256KeyPair(); // base64 DER, no PEM headers
   const payoutSigner = await privy.keyQuorums().create({
     public_keys: [publicKey],
     authorization_threshold: 1,
     display_name: 'polaris-payout-signer',
   });
   // Store privateKey as PAYOUT_SIGNER_KEY (Dashboard keys may carry a "wallet-auth:" prefix; the SDK strips it)
   // Expose payoutSigner.id to the client as NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID
   ```

2. **Per merchant, when they turn on daily payouts:** our API creates that
   merchant's policy, bound to their payout address:

   ```ts
   const TWA_TYPES = {
     EIP712Domain: [
       { name: 'name', type: 'string' },
       { name: 'version', type: 'string' },
       { name: 'chainId', type: 'uint256' },
       { name: 'verifyingContract', type: 'address' },
     ],
     TransferWithAuthorization: [
       { name: 'from', type: 'address' },
       { name: 'to', type: 'address' },
       { name: 'value', type: 'uint256' },
       { name: 'validAfter', type: 'uint256' },
       { name: 'validBefore', type: 'uint256' },
       { name: 'nonce', type: 'bytes32' },
     ],
   };
   const msg = (field: string, operator: 'eq' | 'in' | 'lte', value: string | string[]) => ({
     field_source: 'ethereum_typed_data_message' as const,
     typed_data: { types: TWA_TYPES, primary_type: 'TransferWithAuthorization' },
     field, operator, value,
   });

   const payoutPolicy = await privy.policies().create({
     version: '1.0',
     name: `payout-${merchantId}`.slice(0, 50),
     chain_type: 'ethereum',
     owner_id: ADMIN_QUORUM_ID, // so the app secret alone can't widen it (see UNVERIFIED below)
     rules: [{
       name: 'AUSD to the payout address only',
       method: 'eth_signTypedData_v4',
       action: 'ALLOW',
       conditions: [
         { field_source: 'ethereum_typed_data_domain', field: 'chainId', operator: 'eq', value: '10143' },
         { field_source: 'ethereum_typed_data_domain', field: 'verifyingContract', operator: 'in', value: addr(AUSD) },
         msg('to', 'in', addr(payoutAddress)),
         msg('from', 'eq', '{{wallet.address}}'),
         msg('value', 'lte', '10000000000'), // optional per-payout cap: 10,000 AUSD at 6 decimals
       ],
     }],
   });
   ```

   Only `eth_signTypedData_v4` has a rule, so `eth_sendTransaction`,
   `personal_sign`, `eth_sign7702Authorization` and the rest are all denied for
   this signer.

### 6.3 Add the signer from the client

Sources:

- https://docs.privy.io/wallets/using-wallets/signers/add-signers.md
- `useSigners` in the 3.45.0 types
- the `privy-io/examples` file `privy-next-starter/src/components/sections/signers.tsx`

```tsx
'use client';
import { useSigners, useWallets } from '@privy-io/react-auth';

export function useAutoPayouts() {
  const { addSigners, removeSigners } = useSigners();
  const { wallets } = useWallets();
  const wallet = () => wallets.find((w) => w.walletClientType === 'privy')!;

  async function enable(payoutAddress: string) {
    // `api` = our own fetch wrapper that sends the Privy access token (2.6); the route creates the policy in 6.2
    const { policyId } = await api('/api/payouts/auto', { payoutAddress });
    await addSigners({
      address: wallet().address,
      signers: [{ signerId: process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID!, policyIds: [policyId] }],
    }); // resolves { user }; the wallet's linked account now has delegated: true
  }
  async function disable() {
    await removeSigners({ address: wallet().address }); // removes ALL signers from that wallet
  }
  return { enable, disable };
}
```

- `SignerInput` in 3.45.0 is `{ signerId: string; policyIds?: string[] }[]`.
- `useSessionSigners().addSessionSigners` still exists but is
  `@deprecated in favor of useSigners`.
- **UNVERIFIED:** whether `addSigners` shows a consent modal, and whether it
  works when the policy has an `owner_id` that the user doesn't control. Test
  both on Day 0. If attaching fails, create the payout policy with no owner:
  that is weaker, because the app secret could then edit it.

### 6.4 Use the signer from the server (the daily sweep)

Source: https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server.md

```ts
// cron: for each merchant with auto-payouts on
const w = await privy.wallets().get(merchantWalletId);
const ours = w.additional_signers.find((s) => s.signer_id === PAYOUT_SIGNER_ID);
if (!ours || ours.override_policy_ids?.[0] !== merchant.payoutPolicyId) return; // refuse to act without our policy

const { signature } = await privy.wallets().ethereum().signTypedData(merchantWalletId, {
  params: {
    typed_data: {
      domain: { name: AUSD_NAME, version: AUSD_VERSION, chainId: 10143, verifyingContract: AUSD },
      types: TWA_TYPES,                       // byte-identical to the policy's map, incl. EIP712Domain
      primary_type: 'TransferWithAuthorization',
      message: {
        from: w.address, to: merchant.payoutAddress, value: balance.toString(),
        validAfter: '0', validBefore: String(now + 3600), nonce: randomNonce32(),
      },
    },
  },
  authorization_context: { authorization_private_keys: [process.env.PAYOUT_SIGNER_KEY!] },
});
// hand { from, to, value, validAfter, validBefore, nonce, signature } to the relayer,
// which calls AUSD.transferWithAuthorization (allowed by the relayer policy in 5.5)
```

**Why it's safe:**

- If our server is compromised, the payout key can only produce AUSD
  authorisations to that merchant's own payout address.
- The relayer key can only call our allowlisted functions, with no MON.
- The only way to redirect funds is a new policy attached to the signer, and
  only the merchant (the wallet's user owner) can do that.

---

## 7. Authorization keys and key quorums: what's required

Sources:

- https://docs.privy.io/controls/authorization-keys/owners/overview.md
- https://docs.privy.io/controls/authorization-keys/owners/configuration/programmable.md
- https://docs.privy.io/api-reference/authorization-signatures.md
- https://docs.privy.io/controls/key-quorum/overview.md

**What's required:**

- **Session signers require a key quorum ID.** `signerId` is a key quorum ID,
  so a 1-of-1 quorum per server key is the minimum.
- **Owners are optional but decisive.**
  - With no owner, the app secret alone can use a wallet.
  - With an owner, every RPC and every wallet or policy change needs the
    owner's signature. Our SDK produces it from `authorization_context`.
- **The SDK signs requests.** It canonicalises
  `{version: 1, method, url, body, headers: {privy-app-id, privy-idempotency-key?, privy-request-expiry?}}`,
  signs it with P-256, and sends the result as `privy-authorization-signature`.
  Source: `src/lib/authorization.ts`.
- **Request expiry.** The SDK adds `privy-request-expiry`: 15 minutes by
  default, 72 hours for intents. Configure it with
  `new PrivyClient({ requestExpiry: { defaultMs } })`.
- **Key quorums** are m-of-n over P-256 keys, user IDs and nested quorums.
  Nesting goes one level deep, with at most 5 nested quorums. The docs call
  them "an advanced feature". We need only 1-of-1 quorums.

**Recommended topology for Polaris** (the programmable-controls page, "Giving
permissions to third parties" and "Scoping wallet policies to specific
parties"):

| Resource | Owner | Additional signers (override policy) | Key lives where |
|---|---|---|---|
| Relayer wallet | `admin` quorum | `relayer` quorum → relayer policy (§5.5) | admin: offline (password manager). relayer: server env |
| Fallback keeper wallet | `admin` | `keeper` → keeper policy | keeper: server env |
| Registry/treasury wallet | `admin` | `ops` → `registerFor`-only policy | ops: server env |
| Relayer / keeper / payout policies | `admin` (`owner_id`) | n/a | |
| Merchant payout wallet | the merchant (user owner, set by the React SDK) | `payout-signer` → per-merchant payout policy (§6.2) | payout-signer: server env |

With this layout, a stolen app secret, relayer key and payout key together
still can't:

- change any policy;
- attach a new policy;
- export a key;
- move MON;
- call anything outside the allowlist;
- send a merchant's AUSD anywhere but their own payout address.

A stolen app secret can still *create* new policies, but it can't attach them.
Keep the admin key off the server; use it only in a setup script.

---

## 8. Pricing, limits and the Monad testnet subsidy

Sources: https://www.privy.io/pricing (fetched 26 Sep 2026), and
https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets.md

**Plans:**

| Plan | MAU | Price | Included every month |
|---|---|---|---|
| Developer (free) | 0 to 499 | $0 | 50K signatures and $1M transaction volume |
| Core | 500 to 2,499 | $299/mo | same |
| Scale | 2,500 to 9,999 | $499/mo | same |

**Pay-as-you-go** applies above 10K MAU, 50K signatures or $1M volume a month:
a $2,000 base fee, $0.05 per MAU above 10K, and $0.01 per signature above 50K.

**Definitions** (pricing FAQ):

- A **signature** is any signing request from a Privy wallet: `eth_sendTransaction`,
  `eth_signTransaction`, `eth_signTypedData_v4`, `personal_sign`, `raw_sign`
  and so on.
- **So every relayed payment costs one signature.**
  - Opening a Pay in 4 plan costs one relayer signature.
  - Collections run through CRE and cost none, unless the Privy fallback keeper
    runs them, at one each.
  - An automatic payout costs two: the payout signer's typed data plus the
    relayer's transaction.
- An **MAU** is a Privy-authenticated user with a session in the last 30 days.

**Features** (the pricing matrix, parsed from the page HTML):

- "Policy engine", "Key quorum approvals" and "Delegated access to wallets" are
  ticked for **Developer** and Enterprise.
- "Webhooks" looks **Enterprise-only**. **UNVERIFIED**, because I parsed the
  matrix from HTML. We don't need Privy's webhooks: Envio does that job.

**Rate limits:**

- The REST API returns `429` per endpoint.
- No numbers are published. The optimizing guide recommends exponential backoff
  and a circuit breaker.
- Privy's default client-side RPCs are rate-limited ("generous" for
  development). Set our own Monad RPC with `addRpcUrlOverrideToChain` for the
  demo.

**Monad testnet subsidy.** Monad's embedded-wallets page, under "Providers
Offering Subsidized Usage", says to sign up and then email the Privy team at
`monad@privy.io`. Its Privy section says "Privy is subsidizing all Monad
Testnet usage!".

---

## 9. Monad support matrix

| Feature | Monad testnet (10143) | Monad mainnet (143) | Source |
|---|---|---|---|
| Embedded wallet on a custom chain | Yes, via `viem/chains` `monadTestnet` | Yes, via `monad` or `@privy-io/chains` `monadMainnet` | EVM networks page; tarballs |
| Privy-hosted RPC (`*.rpc.privy.systems`) | **No** (none in `@privy-io/chains`) | Yes: `monad-mainnet.rpc.privy.systems` | `@privy-io/chains@0.6.1` |
| Client and server signing (typed data, tx signing) | Yes. Signing is chain-agnostic | Yes | Chains page (Tier 3 "EVM-compatible networks") |
| Server `eth_sendTransaction` (Privy broadcasts) | **UNVERIFIED** (no chain list) | **UNVERIFIED** | Not documented |
| Policies, signers, key quorums | Yes. Chain-independent, and `chain_id` is just a condition | Yes | Policies overview |
| Gas sponsorship, "app pays" | Listed, but **via EIP-7702** (conflicts with plan §5.3) | Listed, via EIP-7702 | Gas overview |
| Gas sponsorship, "user pays" (USDC or USDT gas) | **No** | **No** | Gas overview |
| Wallet automations (deposit trigger) | **No** | Yes, deposit detection; action is swap only | automations/configuration |
| Balances, history, deposit webhooks | **UNVERIFIED** ("coverage varies") | **UNVERIFIED** | Chains page |
| Coinbase onramp | n/a | `monad` is in the `CoinbaseBlockchain` enum | OpenAPI |

---

## 10. Docs vs SDK discrepancies found (the SDK wins)

| Topic | Docs say | `@privy-io/node@0.35.0` / `react-auth@3.45.0` actually |
|---|---|---|
| `privy.utils().auth().verifyAccessToken` | `({ access_token })`, returns `userId`, `sessionId`… | `(accessToken: string)`, returns `{ app_id, issuer, issued_at, expiration, session_id, user_id }`. The object form is the standalone `verifyAccessToken` export, which also needs `app_id` and `verification_key` |
| Custom signer in `AuthorizationContext` | `sign_functions` | `sign_fns: ((payload: Uint8Array) => Promise<string>)[]` |
| `useLogin({ onComplete })` | `(user, isNewUser) =>` | `({ user, isNewUser, wasAlreadyAuthenticated, loginMethod, loginAccount }) =>` |
| Policy operators | include `neq` | the OpenAPI and SDK enums have no `neq` |
| Condition `value` type | `string \| number \| string[]` | `string \| string[]` |
| `policyIds` per signer | example shows two IDs | "each signer can only have one override policy"; the type says "up to one" |
| `createViemAccount` | `await createViemAccount(...)` | synchronous (awaiting it is harmless) |
| Signer with no override policy | React: no policy applies. Swift and Android: wallet default applies | unclear. Always pass one |

---

## 11. UNVERIFIED items and the Day-0 tests that settle them

**Type-check status: they pass.** I compiled the snippets in §§2–6 with
TypeScript 5.9.3 `--strict` against the exact packages
(`@privy-io/node@0.35.0`, `@privy-io/react-auth@3.45.0`, `viem@2.56.9`) with
**zero errors**. That covers:

- the provider config and hooks;
- `verifyAccessToken`;
- `wallets().create`, `update`, `get` and `list`;
- `ethereum().sendTransaction` and `signTypedData`;
- `createViemAccount` with a viem wallet client;
- `keyQuorums().create` and `generateP256KeyPair`;
- the relayer policy in §5.5 and the payout policy in §6.2, verbatim;
- `users()._get`.

A control file with a deliberate type error failed as expected. The scratch
project is at `E:\Projects\tmp-research\privy\tc` (`server.ts`, `client.tsx`,
`doc55.ts`). viem's `parseAbi(...)` and `erc20Abi` are accepted as the `abi`
of a calldata condition without a cast.

The types prove the calls are well formed. They don't prove what the API does
at runtime, so the items below still need a live Privy app.

1. `eth_sendTransaction` with `caip2: 'eip155:10143'` broadcasts (route A). If
   it doesn't, use route B only.
2. A `DENY value gt "0"` rule doesn't error when `value` is absent (route B
   with a zero value), and does deny `value: 1n`.
3. Address comparisons: does `eq` with a checksummed address match a lowercase
   `to`? (We side-step this with `in: [checksum, lower]`.)
4. Numeric comparisons: does `"0xf4240"` compare equal to `"1000000"` under
   `eq` and `lte`? (Keep one format regardless.)
5. `ethereum_calldata` with a Hardhat ABI filtered to one function fragment
   decodes our calls. Do overloaded functions such as AUSD's
   `transferWithAuthorization` need anything more?
6. `addSigners` with a `policyIds` entry whose policy has `owner_id` = our admin
   quorum succeeds for a user-owned wallet. Does it show a consent modal?
7. The server-side `signTypedData` with a session signer passes the payout
   policy, and one with `to` ≠ payout address is denied.
8. The `useSignTypedData` message with `bigint` values. (We pass strings.)
9. Whether server-wallet signatures count toward the 50K free signatures. (The
   FAQ says any Privy wallet signature, so assume yes.)
10. Numeric REST rate limits (not published).
11. Whether "Webhooks" is Enterprise-only (pricing matrix parse).

---

## 12. What Polaris should do

**Day 0** (plan §11 and §7, Sat 26 – Sun 27 Sep, role C):

1. **Create the Privy app:**
   - Enable email and Google.
   - Set `createOnLogin: 'all-users'`.
   - Add Monad testnet and mainnet in code (§2.3).
   - Add the Business origin to allowed domains.
2. **Email `monad@privy.io`** about the testnet subsidy, citing Monad's
   embedded-wallets page.
3. **Run a setup script** (keep it outside the app bundle, admin key from the
   password manager):
   - generate the `admin`, `relayer`, `keeper` and `payout-signer` keypairs;
   - create a 1-of-1 key quorum for each;
   - create the relayer policy (§5.5);
   - create the relayer wallet with `owner_id: admin`,
     `policy_ids: [relayerPolicy]` and
     `additional_signers: [{ signer_id: relayer, override_policy_ids: [relayerPolicy] }]`;
   - fund the relayer with testnet MON.
4. **Run the §11 tests 1–5,** and record in the repo which route (A or B) works.
   **This is the plan's Day-0 exit: "a policy that rejects a disallowed call."**

**MUST §6 item 5, the relayer on a Privy server wallet with its policy:**

- Build it on route B: `createViemAccount` plus our own Monad RPC, with gas set
  to `estimateGas * 1.15` and a serial nonce queue.
- Generate the policy from the compiled ABIs.
- Update plan §5.3's policy sketch to §5.5:
  - `eth_signTransaction`;
  - a `DENY value gt 0` rule;
  - a `chain_id` condition;
  - ABIs made of function fragments only;
  - names of 50 characters or fewer.
- Change the §5.3 sentence "confirm that unmatched requests are denied" to
  **confirmed** (§5.2).

**MUST §6 item 6, Polaris for Business (plan §5.7):**

- Use `PrivyProvider` with email and Google (§2.3).
- Verify the access token in every route handler (§3), and look up the
  embedded wallet by `user_id`.
- Run `registerFor` server-side in the `onComplete` of a new user.
- For the one-tap withdraw, the merchant signs `TransferWithAuthorization` with
  `useSignTypedData` (§2.5), and the relayer submits it.

**SHOULD §6 item 12, automatic payouts (plan §3.2 point 4, §5.7 point 2):**

- Use one `payout-signer` quorum and a per-merchant payout policy (§6.2).
- The client calls `useSigners().addSigners` (§6.3).
- A cron signs with `authorization_context` (§6.4), and the relayer submits.
- Before each sweep, check the signer's `override_policy_ids`.
- Show a "Turn off" button that calls `removeSigners`.
- Replace "session signer (check current Privy docs)" in the plan with
  **"signer (`useSigners`)"**.

**Bounty write-up (plan §3 table, the Privy row).** Name every non-auth use:

- the embedded payout wallets that sign EIP-712 authorisations;
- the policy-locked server wallets relaying every payment, with the actual
  JSON;
- the owner and signer separation, so a stolen server key can't widen
  anything;
- signers with per-merchant policies for automatic payouts;
- key quorums.

This goes well past "login-only".

**Don't:**

- use `@privy-io/server-auth`;
- use Privy gas sponsorship (it relies on EIP-7702, against plan §5.3);
- use wallet automations (mainnet-only deposit detection, swap-only actions);
- leave any Polaris wallet or policy without an owner.

---

## Sources

- Privy docs index: https://docs.privy.io/llms.txt
- React:
  - https://docs.privy.io/basics/react/installation.md
  - https://docs.privy.io/basics/react/setup.md
  - https://docs.privy.io/basics/react/quickstart.md
  - https://docs.privy.io/basics/react/advanced/configuring-evm-networks.md
- Signing:
  - https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data.md
  - https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction.md
  - https://docs.privy.io/wallets/using-wallets/ethereum/web3-integrations.md
- Tokens:
  - https://docs.privy.io/authentication/user-authentication/access-tokens.md
- Node:
  - https://docs.privy.io/basics/nodeJS/installation.md
  - https://docs.privy.io/basics/nodeJS/setup.md
  - https://docs.privy.io/basics/nodeJS/quickstart.md
  - https://docs.privy.io/basics/nodeJS/advanced/migrating-from-server-auth.md
- Wallets:
  - https://docs.privy.io/wallets/wallets/create/create-a-wallet.md
  - https://docs.privy.io/wallets/wallets/update-a-wallet.md
  - https://docs.privy.io/wallets/overview/chains.md
- Policies:
  - https://docs.privy.io/controls/policies/overview.md
  - https://docs.privy.io/controls/policies/create-a-policy.md
  - https://docs.privy.io/controls/policies/update-a-policy.md
  - https://docs.privy.io/controls/policies/example-policies/ethereum.md
  - https://docs.privy.io/controls/policies/template-variables.md
  - https://docs.privy.io/controls/policies/stateful-policies.md
  - https://docs.privy.io/controls/policies/condition-sets.md
- Signers:
  - https://docs.privy.io/wallets/using-wallets/signers/overview.md
  - https://docs.privy.io/wallets/using-wallets/signers/quickstart.md
  - https://docs.privy.io/wallets/using-wallets/signers/configure-signers.md
  - https://docs.privy.io/wallets/using-wallets/signers/add-signers.md
  - https://docs.privy.io/wallets/using-wallets/signers/use-signers.md
  - https://docs.privy.io/recipes/wallets/conditional-signer-policies.md
- Owners, keys and quorums:
  - https://docs.privy.io/controls/authorization-keys/owners/overview.md
  - https://docs.privy.io/controls/authorization-keys/owners/configuration/programmable.md
  - https://docs.privy.io/controls/authorization-keys/keys/create/key.md
  - https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server.md
  - https://docs.privy.io/controls/key-quorum/overview.md
  - https://docs.privy.io/controls/key-quorum/create.md
  - https://docs.privy.io/api-reference/authorization-signatures.md
- API reference:
  - https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction.md
  - https://docs.privy.io/api-reference/wallets/ethereum/eth-signtypeddata-v4.md
  - OpenAPI: https://api.privy.io/v1/openapi.json
- Gas and automations:
  - https://docs.privy.io/wallets/gas-and-asset-management/gas/overview.md
  - https://docs.privy.io/controls/automations/overview.md
  - https://docs.privy.io/controls/automations/configuration.md
- Operations:
  - https://docs.privy.io/recipes/dashboard/optimizing.md
- Pricing: https://www.privy.io/pricing
- Monad:
  - https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets.md
  - https://docs.monad.xyz/templates/next-serwist-privy-embedded-wallet.md
  - https://github.com/monad-developers/next-serwist-privy-embedded-wallet/blob/main/app/components/privy-provider.tsx
- Privy examples:
  - https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/signers.tsx
  - https://github.com/privy-io/examples/blob/main/privy-next-starter/src/providers/providers.tsx
- npm: `@privy-io/react-auth@3.45.0`, `@privy-io/node@0.35.0` (repo
  `github:privy-io/node-sdk`), `@privy-io/chains@0.6.1`, `@privy-io/server-auth@1.32.5`
  (deprecated), `viem@2.56.9`
- AUSD EIP-3009 type strings: `agora-dollar-evm/src/contracts/Eip3009.sol`
  (local research copy)
