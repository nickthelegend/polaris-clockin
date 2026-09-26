# Mera: research for the Polaris consumer account layer

Researched 26 Sep 2026 for `docs/plan.md`:

- §2: the buyer creates an account with Face ID
- §3.1 and §3.4: the Agora bounty (Mera passkey onboarding) and the Mera UX
  bounty (no seed phrase, no extension, no custody backend)
- §3.5: *One Passkey, Many Keys* (receipts only you can read)
- §5.3: gasless, typed-data signatures only
- §5.6: the PWA, Mera and checkout

This is a from-scratch second pass. Every claim below was re-checked against
four sources: the npm tarball, the GitHub source, the live docs and the WebAuthn
Level 3 spec. The code in §9 and §16 was typechecked, built with `next build`,
and run against Mera's real browser client. Anything not checked that way is
marked **UNVERIFIED**.

The verification scripts live outside the repo, in `E:\Projects\tmp-research\mera2\`:

| Script | What it checks |
|---|---|
| `verify/check.ts` | The library through a fake `WebAuthnClient` |
| `verify/receipts.ts` | Key separation for receipts |
| `next-app/browser-sim.test.ts` | Mera's real `navigator.credentials` path |
| `next-app/server/interop.test.ts` | Server-side sealing |
| `next-app` | Next 16 build |

## 0. Summary

**Package:** `@category-labs/mera@0.2.0` is the latest, published 12 Aug 2026
(0.1.0 was 23 Jul). It is licensed MIT or Apache-2.0, and it is in preview:
"The API may change before 1.0".

The tarball ships `src/`, which is byte-identical to `library/src` at GitHub
`category-labs/mera` HEAD `a3102f4` (31 Aug 2026). **No unreleased library code
changes exist.** Library commits since the release only move files into an npm
workspace, trim tests and drop the `engines` field.

**What Mera is:**

- Two passkey ceremonies that return 32 **PRF** bytes
- Signing sessions that zero their key when ended
- A viem adapter (`toViemAccount`)
- Passkey-encrypted "secret vaults"
- EVM and Solana address helpers

**What Mera is not:**

- It doesn't derive keys. `deriveEvmKey` is **app code** (BIP-39 → BIP-32 →
  BIP-44 with `@scure/*`).
- It has no mnemonic export function.
- It has no capability-detection helper.
- It does no server-side verification.
- It has no conditional UI or abort signal.
- It evaluates only one PRF salt per ceremony.

**Verified on this machine (Node 22.21.1, TypeScript 5.9.3, Next 16.3.6):**

- **Create and sign-in.** Pinned and discoverable sign-in reproduce the same
  32 bytes. A different salt gives unrelated bytes.
- **Error codes.** `PRF_UNAVAILABLE`, `PASSKEY_OPERATION_FAILED`, `INPUT_INVALID`,
  `SESSION_ENDED`, `DECRYPT_FAILED` and `VAULT_FORMAT_INVALID` each fire when
  they should.
- **Address portability.** BIP-44 addresses equal viem
  `mnemonicToAccount(..., { addressIndex })`, so an exported phrase restores
  the account in MetaMask or Rabby.
- **Signing.** `signTypedData`, `signMessage` and `signTransaction` are
  **byte-identical** to viem `privateKeyToAccount` and pass viem's verifiers.
  That covers ERC-3009 `ReceiveWithAuthorization` and ERC-2612 `Permit` on
  chain 10143.
- **Prompt count.** One Face ID covers any number of signatures. Create plus a
  first payment is **one ceremony**.
- **Build.** `next build` compiles, typechecks and statically prerenders a page
  whose client components import Mera, viem and HPKE.
- **Receipts.** The "receipts only you can read" scheme (§16) works end to end:
  HKDF-separated keys and RFC 9180 HPKE through `@hpke/core@1.9.0`, sealed in
  Node and opened in the browser code.

**Seven things that will bite us if ignored:**

1. **Pass the rpId from config, never `location.hostname`,** although every Mera
   and Monad sample does. `app.` and `pay.polarispay.app` must both pass
   `polarispay.app`, or one person gets two accounts.
2. **Every `createPasskeyWithPrfOutput` call makes a new passkey, and so a new
   account.** Call it only from an explicit click, never from `useEffect`.
   Offer "I already use Polaris" (a discoverable sign-in) before "create" on
   unknown devices.
3. **The Monad web guide's import `@scure/bip39/wordlists/english` throws
   `ERR_PACKAGE_PATH_NOT_EXPORTED` with `@scure/bip39@2.4.0`.** Use
   `wordlists/english.js`, as Mera's docs and Monad's React Native guide do.
4. **Mera gives the server nothing to verify.** The challenge is client-made and
   the assertion is discarded. Our API must authenticate buyers by **account
   signatures** (EIP-191, SIWE or EIP-712), never by "they did a passkey
   ceremony" (§8).
5. **This dev PC runs Windows 11 23H2 (build 22631).** Windows Hello there
   returns no PRF; Mera's table needs 25H2. Test with:
   - Chrome signed in to Google Password Manager
   - 1Password
   - a phone
   - Chrome's CDP virtual authenticator with `hasPrf: true`, which is how
     Mera's own e2e tests run (§12.3)
6. **Each subdomain has its own `localStorage`.** A pin saved on `pay.` is
   invisible on `app.`, and an installed PWA may have its own storage too.
   Discoverable sign-in covers it (verified), but the cleanest fix is **one
   origin** (§7).
7. **Cross-origin iframes can't create passkeys in WebKit.** Mera's own demo
   config says so. Checkout must be a top-level page or popup, never an iframe
   inside a merchant site.

## 1. Sources and verified versions

| What | Where | Verified |
|---|---|---|
| Package | `npm view @category-labs/mera`; `npm pack @category-labs/mera@0.2.0` (shasum `93836851757f1381082e89ef7a86967afb641172`, 84 files, SLSA provenance) | **0.2.0** (latest). Deps pinned: `@noble/curves 2.2.0`, `@noble/hashes 2.2.0`, `@scure/base 2.2.0`. Optional peers: `viem ^2.28.0`, `react-native-passkey 3.6.1` (exact; npm latest is 3.6.2). `engines.node >=24`. Published from commit `290cddd` |
| Source | https://github.com/category-labs/mera (`library/src`, `demos/`, `docs/`) | HEAD `a3102f4` (2026-08-31). `library/src` equals the tarball `src/` (diffed). Post-release library commits: a workspace move (`64ce7c4`), test trims, and `2ef6ee3` (13 Aug), which drops `engines` from the published package. All unreleased, none changing source |
| Mera docs | https://mera.category.xyz: getting-started, recipes, concepts, reference, authenticator-support | Live pages return 200 on 2026-09-26. The authenticator table matches `docs/src/content/docs/authenticator-support.md` at HEAD row for row |
| Monad web guide | https://docs.monad.xyz/guides/mera (`.md` variant fetched) | Read 2026-09-26 |
| Monad React Native guide | https://docs.monad.xyz/guides/mera/react-native | Read 2026-09-26 |
| Monad embedded-wallets page | https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets | Lists Mera as "Passkey-derived key (WebAuthn PRF); non-custodial, no server storage" |
| WebAuthn L3 | https://www.w3.org/TR/webauthn-3/ | **W3C Recommendation, 25 Aug 2026.** Covers rpId rules, PRF salt hashing, `getClientCapabilities`, iframes and related origins |
| Compatibility (secondary) | https://www.corbado.com/blog/passkeys-prf-webauthn (updated 22 Sep 2026; Mera's docs link it) | Used only where Mera's table is silent. Marked "secondary" |
| Companion packages | npm | `@scure/bip32 2.4.0`, `@scure/bip39 2.4.0`, `viem 2.56.9`, `@hpke/core 1.9.0`, `@hpke/dhkem-x25519 1.8.0`, `next 16.3.6`, `react 19.3.0`, `typescript 5.9.3` (latest is 7.0.2; Mera itself builds with 7.0.2) |

## 2. Install

Source: https://docs.monad.xyz/guides/mera (Install) and
https://mera.category.xyz/getting-started/

```sh
pnpm add @category-labs/mera@0.2.0 viem @scure/bip32@2.4.0 @scure/bip39@2.4.0
# for the receipts keys in §16:
pnpm add @hpke/core@1.9.0 @hpke/dhkem-x25519@1.8.0
```

Gotchas, all verified:

- **`engines.node` is `>=24` and the repo runs Node 22.21.1.** npm prints
  `EBADENGINE`; pnpm warns, and our `.npmrc` doesn't set `engine-strict`.
  Everything above ran on 22. Upstream has already removed the field (commit
  `2ef6ee3`, unreleased).
- **`toViemAccount` is on the subpath `@category-labs/mera/viem`,** not the
  root. The root never imports viem.
- **Use `@scure/bip39/wordlists/english.js`.** The extensionless path fails in
  Node and in bundlers that honour `exports`.
- **Pin exact versions.** Mera is pre-1.0, and the derivation (§5) is frozen
  forever once users exist.
- **Bundle cost.** The page chunk carrying Mera, viem signing, BIP-32/39 with
  the English wordlist, and HPKE is **274 KB minified, 98 KB gzipped**, from a
  Next 16.3.6 Turbopack production build of the §9 page.

## 3. How it works, in one line

```
Face ID ─► authenticator PRF(credential, rpId, salt) ─► 32 bytes
        ─► [our code] BIP-39 entropy → seed → m/44'/60'/0'/0/i
        ─► createSecp256k1SigningSession ─► toViemAccount ─► signTypedData
```

Two facts drive everything:

- **The PRF output is deterministic** for a given (credential, rpId, salt).
  Mera's default salt is `sha256("mera.prf.salt.v1")` =
  `896d46ac4ac191885c46137439db7bb52fb05cff3ecd34af7cdae0a1e0c00db9`,
  documented as never changing.
- **The browser hashes the salt again before `hmac-secret`:**
  `SHA-256("WebAuthn PRF" || 0x00 || salt)` (WebAuthn L3, PRF client
  processing). So another site's PRF can never collide with ours.

Nothing secret is ever stored. Every ceremony recomputes the same accounts on
every device the passkey syncs to.

## 4. The complete public API (0.2.0)

These are the exact declarations from `dist/*.d.ts`, with doc comments removed.
Sources:

- https://github.com/category-labs/mera/tree/main/library/src
- https://mera.category.xyz/reference/

### 4.1 Entry points

`package.json` `exports` has three entries:

- `.`
- `./viem`
- `./react-native-webauthn-client`

It is ESM only (`"type": "module"`) with `"sideEffects": false`.

```ts
// @category-labs/mera
export { getEvmAddress } from "./chains/evm.js";
export { getSolanaAddress } from "./chains/solana.js";
export { createEd25519SigningSession } from "./ed25519.js";
export type { MeraErrorCode } from "./errors.js";
export { isMeraError, MeraError } from "./errors.js";
export { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from "./passkey.js";
export { createSecp256k1SigningSession } from "./secp256k1.js";
export type { CreateSecretVaultWithExistingPasskeyOptions, CreateSecretVaultWithNewPasskeyOptions, DecryptSecretVaultWithPasskeyOptions } from "./secret.js";
export { createSecretVaultWithExistingPasskey, createSecretVaultWithNewPasskey, decryptSecretVaultWithPasskey, parseSecretVault } from "./secret.js";
export type { CreateSigningSessionOptions, Ed25519SigningSession, EvmAddress, PasskeyCredentialMetadata, PasskeyCredentialTransport, PasskeyRelyingParty, PasskeySecretVault, Secp256k1Signature, Secp256k1SigningSession, SolanaAddress } from "./types.js";
export type { WebAuthnClient } from "./webauthn.js";
```

### 4.2 Passkey ceremonies

Sources:

- `library/src/passkey.ts`
- https://mera.category.xyz/reference/create-passkey-with-prf-output/
- https://mera.category.xyz/reference/get-passkey-prf-output/

```ts
declare function createPasskeyWithPrfOutput({ rp, user, timeout, prfSalt, webAuthnClient, }: createPasskeyWithPrfOutput.Options): Promise<createPasskeyWithPrfOutput.Result>;
declare namespace createPasskeyWithPrfOutput {
    type Options = {
        rp: PasskeyRelyingParty;                 // { readonly id: string; readonly name: string } — id REQUIRED
        user: { name: string; displayName: string; };
        timeout?: number;                        // ms, platform default when omitted
        prfSalt?: Uint8Array;                    // exactly 32 bytes; default sha256("mera.prf.salt.v1")
        webAuthnClient?: WebAuthnClient;         // default: built-in navigator.credentials client
    };
    type Result = PasskeyCredentialMetadata & {
        readonly prfSalt: Uint8Array<ArrayBuffer>;   // 32 bytes, fresh copy
        readonly prfOutput: Uint8Array<ArrayBuffer>; // 32 bytes
    };
}
declare function getPasskeyPrfOutput({ rpId, credential: allowCredential, prfSalt, timeout, webAuthnClient, }: getPasskeyPrfOutput.Options): Promise<getPasskeyPrfOutput.Result>;
declare namespace getPasskeyPrfOutput {
    type Options = {
        rpId: string;
        credential?: PasskeyCredentialMetadata;  // omit => any discoverable passkey for rpId
        prfSalt?: Uint8Array;
        timeout?: number;
        webAuthnClient?: WebAuthnClient;
    };
    type Result = {
        readonly credentialId: string;           // canonical unpadded base64url, the one that answered
        readonly prfOutput: Uint8Array<ArrayBuffer>;
    };
}

type PasskeyRelyingParty = { readonly id: string; readonly name: string };
type PasskeyCredentialMetadata = {
    readonly credentialId: string;                          // canonical unpadded base64url
    readonly transports?: readonly PasskeyCredentialTransport[];
};
type PasskeyCredentialTransport = "ble" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb" | (string & {});
```

**What Mera's browser client actually sends.** This is recorded from
`browser-sim.test.ts`, which intercepts `navigator.credentials`:

```jsonc
// create()
{ "rp": { "id": "polarispay.app", "name": "Polaris" }, "user.id": "32 random bytes", "challenge": "32 random bytes",
  "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }],
  "attestation": "none",
  "authenticatorSelection": { "residentKey": "required", "requireResidentKey": true, "userVerification": "required" },
  "extensions": { "prf": { "eval": { "first": "<32-byte salt>" } } } }
// get()
{ "rpId": "polarispay.app", "userVerification": "required",
  "allowCredentials": ["<only when credential is passed, with its transports>"],
  "extensions": { "prf": { "eval": { "first": "<32-byte salt>" } } } }
```

What that means:

- **No `hints`, `mediation`, `signal` or `timeout`** is sent unless we pass
  `timeout`. So a pending prompt can't be aborted from code, and there is no
  autofill (conditional) UI.
- **`user.id` is fresh randomness every call.** Each create *adds* a passkey,
  and so an account; it never overwrites one.
- **User verification is always required** and can't be configured. WebAuthn
  exposes only the user-verified PRF anyway.
- **If the authenticator enables PRF but returns no output at create,** Mera
  runs a pinned `get` with the same salt automatically. That costs **two
  prompts at sign-up** on those authenticators (verified with a fake client).
- **A failure after the create ceremony leaves an orphan passkey.** For example,
  `PRF_UNAVAILABLE` on the desktop Chrome local profile. The thrown error
  doesn't carry its id.

### 4.3 Signing sessions and addresses

Sources:

- `library/src/types.ts`, `secp256k1.ts`, `ed25519.ts`, `chains/*.ts`
- https://mera.category.xyz/reference/secp256k1-signing-session/

```ts
declare function createSecp256k1SigningSession({ privateKey, }: CreateSigningSessionOptions): Secp256k1SigningSession;
declare function createEd25519SigningSession({ privateKey, }: CreateSigningSessionOptions): Ed25519SigningSession;
declare function getEvmAddress(publicKey: Uint8Array): EvmAddress;       // EIP-55; compressed or uncompressed input
declare function getSolanaAddress(publicKey: Uint8Array): SolanaAddress; // base58 of a 32-byte Ed25519 key

type CreateSigningSessionOptions = { privateKey: Uint8Array };  // 32 bytes; secp256k1: valid scalar
type Secp256k1SigningSession = {
    readonly publicKey: Uint8Array<ArrayBuffer>;                // 65-byte uncompressed, 0x04…
    signDigest(digest32: Uint8Array): Promise<Secp256k1Signature>; // no prehash, low-S
    end(): void;                                                // zeroes the session's copy; permanent
    [Symbol.dispose](): void;                                   // = end, for `using`
};
type Secp256k1Signature = { readonly compact: Uint8Array<ArrayBuffer>; readonly recovery: 0 | 1 };
type Ed25519SigningSession = {
    readonly publicKey: Uint8Array<ArrayBuffer>;                // 32 bytes
    signMessage(message: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
    end(): void;
    [Symbol.dispose](): void;
};
type EvmAddress = `0x${string}`;
type SolanaAddress = string & { readonly [brand]: "SolanaAddress" };
```

- **The session copies the key.** The caller's buffer is left intact after
  `end()` (verified), so zero your own copy right after creating the session.
- **Mera's zeroing is best-effort** by its own security model: GC copies, and
  bigint scalars inside noble.

### 4.4 The viem adapter: `@category-labs/mera/viem`

Sources: `library/src/viem.ts` and
https://mera.category.xyz/reference/to-viem-account/

```ts
type ToViemAccountOptions = { nonceManager?: NonceManager };
declare function toViemAccount(session: Secp256k1SigningSession, options?: ToViemAccountOptions): LocalAccount<"mera">;
```

- The result has `type: "local"` and `source: "mera"`, and `publicKey` is
  65-byte hex.
- It implements:
  - `sign({ hash })` (raw 32-byte hash)
  - `signMessage` (EIP-191)
  - `signTypedData` (EIP-712)
  - `signTransaction` (honours a custom `serializer`; EIP-4844 hashed without
    sidecars)
  - `signAuthorization` (EIP-7702)
- **None of them prompts.** They sign from session memory.

### 4.5 Secret vaults

Sources:

- `library/src/secret.ts`
- https://mera.category.xyz/reference/secret-vault-format/
- https://mera.category.xyz/concepts/secret-vaults/

```ts
declare function createSecretVaultWithNewPasskey({ secret, ...passkeyOptions }: CreateSecretVaultWithNewPasskeyOptions): Promise<PasskeySecretVault>;
declare function createSecretVaultWithExistingPasskey({ credential, secret, ...passkeyOptions }: CreateSecretVaultWithExistingPasskeyOptions): Promise<PasskeySecretVault>;
declare function decryptSecretVaultWithPasskey({ vault, ...passkeyOptions }: DecryptSecretVaultWithPasskeyOptions): Promise<Uint8Array<ArrayBuffer>>;
declare function parseSecretVault(value: unknown): PasskeySecretVault;   // JSON text or object; validates; drops unknown keys

type CreateSecretVaultWithNewPasskeyOptions = Omit<createPasskeyWithPrfOutput.Options, "prfSalt"> & { secret: Uint8Array };
type CreateSecretVaultWithExistingPasskeyOptions = Omit<getPasskeyPrfOutput.Options, "prfSalt"> & { secret: Uint8Array };
type DecryptSecretVaultWithPasskeyOptions = Omit<getPasskeyPrfOutput.Options, "credential" | "prfSalt"> & { vault: PasskeySecretVault };

type PasskeySecretVault = {
    readonly version: 1;
    readonly credential: PasskeyCredentialMetadata;
    readonly prfSalt: string;     // 32 B base64url, fresh random per vault
    readonly nonce: string;       // 12 B base64url
    readonly ciphertext: string;  // AES-256-GCM ciphertext || 16-byte tag, base64url
};
```

- **Key:** HKDF-SHA-256 over the vault's PRF output, with an empty salt and
  `info = "mera.v1.encrypt.secret"`. It is a non-extractable WebCrypto key.
- **No AAD.** The credential id and salt are stored but not authenticated.
- **Cost:** one ceremony to create and one to open. Each vault has its own
  random salt.
- The functions that take a raw PRF output (`createSecretVault` and
  `decryptSecretVault`) are **internal**, not exported.
- **We don't need vaults.** They exist for secrets that come from outside the
  passkey; §16 explains why receipts don't use them.

### 4.6 `WebAuthnClient` and React Native

Sources: `library/src/webauthn.ts`, `react-native-webauthn-client*.ts` and
https://mera.category.xyz/reference/web-authn-client/

```ts
type WebAuthnClient = {
    readonly createCredential: (request: WebAuthnClient.CreateCredentialRequest) => Promise<WebAuthnClient.CreateCredentialResult>;
    readonly getCredential: (request: WebAuthnClient.GetCredentialRequest) => Promise<WebAuthnClient.GetCredentialResult>;
};
// CreateCredentialRequest: { rp; user: { id: Uint8Array<ArrayBuffer>; name; displayName }; challenge; algorithms: readonly number[];
//                            prfSalt: Uint8Array<ArrayBuffer>; residentKey: "required"; userVerification: "required"; attestation: "none"; timeout? }
// CreateCredentialResult:  { credentialId: Uint8Array; transports?; prfEnabled: boolean; prfOutput?: Uint8Array }
// GetCredentialRequest:    { rpId; challenge; allowCredential?: { credentialId: Uint8Array<ArrayBuffer>; transports? }; prfSalt;
//                            userVerification: "required"; timeout? }
// GetCredentialResult:     { credentialId: Uint8Array; prfOutput?: Uint8Array }

// @category-labs/mera/react-native-webauthn-client
declare const reactNativeWebAuthnClient: WebAuthnClient;   // wraps react-native-passkey 3.6.1
```

- **The interface carries one salt** (`eval.first`). WebAuthn allows a second
  (`eval.second`), but Mera can't request it.
- **The built-in browser client isn't exported.** A custom client means
  re-implementing `navigator.credentials` calls. We don't need one on the web.

### 4.7 Errors

Sources: `library/src/errors.ts` and https://mera.category.xyz/reference/errors/

```ts
type MeraErrorCode = "PASSKEY_OPERATION_FAILED" | "CRYPTO_UNAVAILABLE" | "PRF_UNAVAILABLE" | "SESSION_ENDED" | "DECRYPT_FAILED" | "INPUT_INVALID" | "VAULT_FORMAT_INVALID";
declare class MeraError extends Error {
    readonly code: MeraErrorCode;       // name === "MeraError"; cause = underlying DOMException or Web Crypto error
    constructor(code: MeraErrorCode, message: string, options?: { cause?: unknown; });
}
declare function isMeraError(error: unknown): error is MeraError;
```

| Code | Thrown when (source plus verified cases) | What the buyer sees (plan §2 vocabulary) |
|---|---|---|
| `PASSKEY_OPERATION_FAILED` | WebAuthn cancelled, failed, timed out or unavailable, or the pinned credential is gone. The `cause` is the `DOMException` (verified: `NotAllowedError`). In Node with no `navigator.credentials` it reads "WebAuthn returned no usable public key credential" (verified) | "Face ID was cancelled. Try again." |
| `PRF_UNAVAILABLE` | The authenticator didn't enable PRF or return 32 bytes: the desktop Chrome local profile, Bitwarden, Dashlane, Windows before 25H2 | "This browser can't hold a Polaris account. Open this page on your phone." |
| `CRYPTO_UNAVAILABLE` | No `crypto.getRandomValues`, or no `crypto.subtle` for vaults: not a secure context | "Open this page over https." |
| `SESSION_ENDED` | Signing after `end()` (verified) | "Please confirm again." |
| `INPUT_INVALID` | Salt not 32 bytes, empty or non-canonical `credentialId`, bad scalar or point, `sign` hash not 32 bytes (verified) | our bug |
| `DECRYPT_FAILED` | Vault AES-GCM authentication failed (verified with the wrong passkey) | n/a |
| `VAULT_FORMAT_INVALID` | Bad vault JSON or version (verified with `version: 2`) | n/a |

### 4.8 Named in the plan or brief but not in the library

| Name | Reality |
|---|---|
| `deriveEvmKey` | App code. The Monad guides print one; ours is in §5.1 |
| Mnemonic export | App code: `entropyToMnemonic(prfOutput, wordlist)` gives 24 words (§5.3). Pattern from Mera's `demos/web/src/connect.ts` `revealMnemonic` |
| Capability detection | None. We use `PublicKeyCredential.getClientCapabilities()` as a hint, and the ceremony is the real test (§12.2) |
| Server verification | None (§8) |
| Conditional UI, abort, `eval.second` | None in 0.2.0 |

## 5. Deriving accounts

### 5.1 `deriveEvmKey`: PRF → BIP-39 → BIP-32 → BIP-44

Sources, same pipeline in each:

- https://docs.monad.xyz/guides/mera/react-native (this version zeroes the seed)
- https://mera.category.xyz/recipes/create-passkey-accounts/
- Mera `demos/shared/src/hd.ts`

Ours adds `wipePrivateData()`: `@scure/bip32`'s `privateKey` getter returns a
*copy*, so the HD nodes keep their own until wiped (checked in
`@scure/bip32@2.4.0` source).

```ts
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

function deriveEvmKey(prfOutput: Uint8Array, index = 0): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(`m/44'/60'/0'/0/${index}`);
  try {
    const key = node.privateKey; // a copy
    if (key === null) throw new Error("derivation produced no key");
    return key;
  } finally {
    seed.fill(0);
    node.wipePrivateData();
    root.wipePrivateData();
  }
}
```

- **Portability, verified:** for indexes 0, 1 and 2, the address equals viem
  `mnemonicToAccount(entropyToMnemonic(prf), { addressIndex: i })`. That is the
  MetaMask and Rabby default path.
- **Freeze it.** The path, the wordlist and the BIP-39 step decide every
  address. Changing any one of them moves every user's money out of reach.
- **Speed.** `mnemonicToSeedSync` (PBKDF2, 2048 rounds) took 18.7 ms per run in
  Node on this desktop. `@scure/bip39`'s `mnemonicToSeedWebcrypto` returns the
  same 64 bytes (verified) in 2.0 ms. Swap it in if low-end Android feels slow;
  phone timings are **UNVERIFIED**.

### 5.2 Multiple accounts from one passkey

- **Different indexes give independent accounts** from one ceremony:
  `m/44'/60'/0'/0/{index}`. The Monad guide says "Increment `index` for
  additional accounts from the same passkey". Mera's recipe has
  `deriveEvmAccount(seed, index)`.
- **Different passkeys give independent trees,** because each has its own PRF.
- **Different salts give independent roots** from the same passkey (verified).
  §16 uses this idea for keys that aren't wallets.
- **Polaris uses index 0 only.** One Face ID means one account. Extra indexes
  complicate recovery, and the buyer never sees "accounts".

### 5.3 Mnemonic export

Source: Mera `demos/web/src/connect.ts` (`revealMnemonic`) and
`demos/web/src/WalletBackup.tsx`. The code is in §9 (`revealRecoveryPhrase`).

- **The 24 words are the PRF output in another encoding.** Verified:
  `mnemonicToEntropy(phrase) === prfOutput`. So the phrase restores every index
  of this passkey, *and* any key we derive from the same PRF output (§16,
  option A).
- **Run a fresh ceremony before showing it,** as the demo does. JS strings
  can't be zeroed, so drop the reference on *Hide*.
- **Bounty tension.** "No seed phrase" (Mera UX) means the buyer never *needs*
  one. Keep export as an opt-in *Recovery key* item in settings, never in
  onboarding, and don't use the phrase "seed phrase".

## 6. rpId rules

WebAuthn L3 (Recommendation, 25 Aug 2026), *Relying Party Identifier*:

> "The RP ID must be equal to the origin's effective domain, or a registrable domain suffix of the origin's effective domain."

One of these must also hold: the scheme is `https`, *or* "The origin's host is
`localhost` and its scheme is `http`". Ports are unrestricted. An rpId must be a
valid domain, so an IP address is invalid.

| Where | Page origin | rpId | Notes |
|---|---|---|---|
| Local dev | `http://localhost:3000` | `localhost` | Mera's own e2e tests use `rp.id: "localhost"`. Not `127.0.0.1` or a LAN IP. Dev accounts can never be reproduced under `polarispay.app` |
| Checkout | `https://pay.polarispay.app` | `polarispay.app` | A registrable suffix, so valid |
| App | `https://app.polarispay.app` | `polarispay.app` | **Same passkey, same PRF, same account** as `pay.` (verified in the browser simulation) |
| Phone testing | `https://dev.polarispay.app` (a real subdomain) | `polarispay.app` | Phones can't reach `localhost`. A deployed subdomain shares real accounts; fine for the team |
| Vercel previews | `https://<x>.vercel.app` | can't be `polarispay.app` | `vercel.app` is a public suffix. Our `rpId()` guard throws a clear error there instead of an opaque `SecurityError` (verified). Give previews a `*.polarispay.app` alias if they need passkeys |
| `app.localhost` or other `*.localhost` | | **UNVERIFIED** | The spec's http exception names `localhost` exactly. Use a single `localhost` origin |

**Rules for us:**

- **Hard-code the rpId per environment** (`NEXT_PUBLIC_MERA_RP_ID`). Both Mera
  samples and both Monad guides use `location.hostname`, which would split
  `app.` and `pay.` into two accounts per person.
- **It is permanent.** Mera's security model says that after a domain
  migration "passkey accounts can no longer be reproduced". Recovery is then
  only the 24-word export.
- **Every hostname under `polarispay.app` is inside the trust boundary.** From
  Mera's security model: "Whoever takes over a hostname under the rpId … can
  serve a page there and run a ceremony, which returns the PRF output". So:
  - no third-party CNAMEs (docs, status pages) under `polarispay.app`
  - no dangling DNS
  - a strict CSP on the pages that run ceremonies
- **Iframes.** The spec disables WebAuthn in cross-origin iframes unless the
  frame has `allow="publickey-credentials-create; publickey-credentials-get"`
  (§5.10). Mera's `demos/web/vite.config.ts` says that "passkey creation runs
  same-origin: WebKit refuses it in a cross-origin frame." **Checkout is a
  top-level page or popup,** as the plan's redirect plus `postMessage` already
  assumes.
- **Related Origin Requests** (§5.11, `https://polarispay.app/.well-known/webauthn`
  listing other origins) could let a different domain use `polarispay.app`
  passkeys. Browser support with PRF is **UNVERIFIED**. We don't need it.
- **Native apps** (only if the React Native fallback happens) need two files
  served from `https://polarispay.app/.well-known/` with no redirect:
  - `apple-app-site-association` with `webcredentials`
  - `assetlinks.json` with `delegate_permission/common.get_login_creds`

  Source: https://mera.category.xyz/recipes/use-mera-with-react-native/

## 7. What must be stored between sessions

Sources:

- https://mera.category.xyz/recipes/create-passkey-accounts/ ("Remember the credential")
- https://docs.monad.xyz/guides/mera ("Signing in")
- Mera `demos/web/src/account.ts` and `passkeyWallet.ts`

**Nothing is required.** `getPasskeyPrfOutput({ rpId })` with no `credential`
sends no `allowCredentials` (verified). The OS then shows its picker of
discoverable passkeys for the rpId. Every Mera passkey is discoverable
(`residentKey: "required"`), and the account comes back identical. The Monad
guide: "With a fresh device, `getPasskeyPrfOutput` will prompt the
authenticator in a discoverable mode". Verified in the simulation: sign-in with
no stored state on `app.` returns the account created on `pay.`.

**Recommended, all public** (`localStorage`, one key):

- **`{ credentialId, transports }`** pins the next sign-in to one passkey and
  skips the picker. `transports` is only a routing hint. The Monad guide: "The
  credential metadata holds no key material, so `localStorage` is fine for it."
- **`address`** lets Home show the balance with **no prompt**. The demo calls
  this the "locked" state.

**Never store the PRF output, seed or private key on the web.** Mera's React
Native demo keeps the PRF output in Expo SecureStore behind biometrics. That is
a native-only pattern with no web equivalent.

**Server side** (§8, §16): the address, the receipts inbox public key and the
registration signature. The credential id isn't needed.

**Storage is per origin.**

- `app.` and `pay.` have separate `localStorage`, so a pin saved on one is
  absent on the other. Discoverable sign-in then shows the picker, which still
  works (verified in the simulation).
- An installed iOS home-screen app is reported to have storage separate from
  Safari: **UNVERIFIED**. The same fallback applies.
- **Cleanest fix: one origin.** 308-redirect `pay.polarispay.app/<id>` to
  `app.polarispay.app/pay/<id>`. That gives one storage, one service worker and
  one PWA scope.

**Stale pins.** If the pinned passkey was deleted from the authenticator, `get`
fails with `PASSKEY_OPERATION_FAILED`. Offer *Use a different account*, which
calls `forgetAccount()` and retries discoverably.

## 8. Server authentication: Mera gives us none

Mera generates the challenge on the device (`randomBytes(32)`) and returns only
`credentialId` and `prfOutput`. No assertion, signature or authenticator data
leaves the function. **A Mera ceremony proves nothing to our server.** So:

- **Money actions are self-authenticating.** EIP-712 and ERC-3009 signatures
  are checked on chain (§5.3).
- **Account actions use a signature from the derived key.** That covers
  registering the receipts key, listing and deleting receipts, and
  rate-limiting claims. For onboarding (§9) we sign
  `Polaris receipts key <hex>` with EIP-191 and check it with viem
  `verifyMessage` (verified, including rejection of a forged key; §16.6).
- **For sessions**, viem ships SIWE helpers in `viem/siwe`
  (`createSiweMessage`, `generateSiweNonce`, `parseSiweMessage`,
  `validateSiweMessage`, `verifySiweMessage`, exports checked in 2.56.9).
  Signing one costs a Face ID, so combine it with the ceremony the user is
  already doing.

## 9. Using it in a Next.js client component

Composed from:

- https://docs.monad.xyz/guides/mera ("Prompt per transaction", "Signing in")
- https://mera.category.xyz/recipes/create-passkey-accounts/
- Mera `demos/web/src/connect.ts`

**How this code was verified:**

- **Build:** `next build` (Next 16.3.6, Turbopack) compiled, ran TypeScript and
  statically prerendered the page.
- **Strict typecheck:** passes `tsc` 5.9.3 with `strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and
  `skipLibCheck: false`.
- **Behaviour:** 21 checks passed in `browser-sim.test.ts` through Mera's real
  `navigator.credentials` path. `verify/check.ts` passed 28 more against the
  library directly, and `verify/receipts.ts` passed 12.

**SSR is safe.** At import time Mera only hashes its default salt. The browser
client touches `navigator` only when called. Prerendering imports these client
components on the server without error. Only **call** Mera from event handlers.

### 9.1 `lib/mera-account.ts`

```ts
// lib/mera-account.ts — browser-only. Import it only from "use client" files.
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  type EvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js"; // ".js" is required by @scure/bip39 2.x
import { type Hex, type LocalAccount, toHex } from "viem";
import { deriveReceiptKeys, type ReceiptKeys } from "./receipts-key";

// "localhost" in dev (http://localhost:3000), "polarispay.app" everywhere else.
// Inlined at build time by Next. Never derive it from location.hostname.
const RP_ID = process.env.NEXT_PUBLIC_MERA_RP_ID;
const STORAGE_KEY = "polaris.account.v1";

/** Public data only: safe for localStorage. */
export type StoredAccount = {
  credential: PasskeyCredentialMetadata;
  address: EvmAddress;
};

export function rpId(): string {
  if (!RP_ID) throw new Error("NEXT_PUBLIC_MERA_RP_ID is not set");
  const host = window.location.hostname;
  if (host !== RP_ID && !host.endsWith(`.${RP_ID}`)) {
    // e.g. a *.vercel.app preview: WebAuthn would reject it with SecurityError.
    throw new Error(`Passkeys for ${RP_ID} cannot be used on ${host}`);
  }
  return RP_ID;
}

export function loadAccount(): StoredAccount | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<StoredAccount>;
    return typeof v.credential?.credentialId === "string" &&
      typeof v.address === "string"
      ? (v as StoredAccount)
      : undefined;
  } catch {
    return undefined;
  }
}

function saveAccount(account: StoredAccount): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export function forgetAccount(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * PRF output -> BIP-39 entropy (24 words) -> BIP-32 seed -> m/44'/60'/0'/0/index.
 * The same 24 words in MetaMask or Rabby give the same addresses.
 * Changing this mapping changes every user's address: freeze it.
 */
function deriveEvmKey(prfOutput: Uint8Array, index = 0): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(`m/44'/60'/0'/0/${index}`);
  try {
    const key = node.privateKey; // a copy
    if (key === null) throw new Error("derivation produced no key");
    return key;
  } finally {
    seed.fill(0);
    node.wipePrivateData();
    root.wipePrivateData();
  }
}

/** What onboarding sends to our API: public data plus proof the account owns the inbox key. */
export type Registration = { address: EvmAddress; inboxPublicKey: Hex; signature: Hex };

/** What one Face ID unlocks, for as long as the callback runs. */
export type Unlocked = { account: LocalAccount<"mera">; receipts: ReceiptKeys };

/**
 * Onboarding. Every call makes a NEW passkey and so a NEW account: click-only.
 * `then` runs inside the same ceremony, so a first-time buyer on a checkout
 * link creates the account AND signs the payment with one Face ID.
 */
export async function createAccount<T = undefined>(
  then?: (unlocked: Unlocked) => Promise<T>,
): Promise<{ stored: StoredAccount; registration: Registration; result: T | undefined }> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: "Polaris" },
    user: {
      name: "Polaris",
      // Shown in the passkey picker; a date keeps several passkeys apart.
      displayName: `Polaris account (${new Date().toLocaleDateString()})`,
    },
  });
  const privateKey = deriveEvmKey(created.prfOutput);
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  try {
    const account = toViemAccount(session);
    const receipts = await deriveReceiptKeys(created.prfOutput);
    const inboxPublicKey = toHex(receipts.inboxPublicKey);
    const signature = await account.signMessage({
      message: `Polaris receipts key ${inboxPublicKey}`,
    });
    const stored: StoredAccount = {
      credential: {
        credentialId: created.credentialId,
        ...(created.transports ? { transports: created.transports } : {}),
      },
      address: account.address,
    };
    saveAccount(stored); // before `then`, so a failed payment never loses the account
    const result = then ? await then({ account, receipts }) : undefined;
    return { stored, registration: { address: account.address, inboxPublicKey, signature }, result };
  } finally {
    session.end();
    created.prfOutput.fill(0);
  }
}

/**
 * One Face ID prompt -> a viem account and the receipt keys, alive only while
 * `fn` runs. Pinned to the stored credential when there is one; otherwise
 * discoverable (new device, other subdomain, installed PWA), then remembered.
 */
export async function withAccount<T>(
  fn: (unlocked: Unlocked) => Promise<T>,
  index = 0,
): Promise<T> {
  const stored = loadAccount();
  const { credentialId, prfOutput } = await getPasskeyPrfOutput({
    rpId: rpId(),
    ...(stored ? { credential: stored.credential } : {}),
  });
  const privateKey = deriveEvmKey(prfOutput, index);
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  try {
    const receipts = await deriveReceiptKeys(prfOutput); // same ceremony, no extra prompt
    const account = toViemAccount(session);
    if (stored?.credential.credentialId !== credentialId && index === 0) {
      saveAccount({ credential: { credentialId }, address: account.address });
    }
    return await fn({ account, receipts });
  } finally {
    session.end(); // zeroes the session's key; later signing throws SESSION_ENDED
    prfOutput.fill(0);
  }
}

/**
 * Settings → "Recovery key". Fresh Face ID every time (pattern from mera's
 * demos/web/src/connect.ts revealMnemonic). The 24 words are the PRF output
 * itself (BIP-39 entropy), so they restore every account on this passkey.
 * JS strings can't be zeroed: drop the reference as soon as it's hidden.
 */
export async function revealRecoveryPhrase(): Promise<string> {
  const stored = loadAccount();
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId: rpId(),
    ...(stored ? { credential: stored.credential } : {}),
  });
  try {
    return entropyToMnemonic(prfOutput, wordlist);
  } finally {
    prfOutput.fill(0);
  }
}

/** What the buyer sees. Never says passkey, wallet or PRF. */
export function describeError(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PASSKEY_OPERATION_FAILED":
        return "Face ID was cancelled. Try again.";
      case "PRF_UNAVAILABLE":
        return "This browser can't hold a Polaris account. Open this page on your phone.";
      case "CRYPTO_UNAVAILABLE":
        return "Open this page over https.";
      case "SESSION_ENDED":
        return "Please confirm again.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mera ships no capability check. This is the best a page can do before a
 * ceremony: "no" is definitive, "maybe" still needs a real create/get.
 */
export async function passkeyAccountSupport(): Promise<"no" | "maybe"> {
  if (typeof window === "undefined" || !window.isSecureContext) return "no";
  if (typeof window.PublicKeyCredential === "undefined") return "no";
  const PKC = window.PublicKeyCredential;
  if (typeof PKC.getClientCapabilities === "function") {
    try {
      const caps = await PKC.getClientCapabilities();
      // WebAuthn L3 §5.1.7: an extension not mapped to true MAY be unsupported.
      if (caps["extension:prf"] === false) return "no";
    } catch {
      /* fall through */
    }
  }
  return "maybe";
}
```

`.env.local` for dev holds `NEXT_PUBLIC_MERA_RP_ID=localhost`. Production holds
`NEXT_PUBLIC_MERA_RP_ID=polarispay.app`.

### 9.2 The checkout button (`"use client"`)

```tsx
"use client";

import { useEffect, useState } from "react";
import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";
import { monadTestnet } from "viem/chains";
import {
  createAccount,
  describeError,
  loadAccount,
  passkeyAccountSupport,
  type StoredAccount,
  type Unlocked,
  withAccount,
} from "@/lib/mera-account";

// Placeholders: read the real AUSD EIP-712 domain from the token on Day 0.
const AUSD_DOMAIN = {
  name: "AUSD",
  version: "1",
  chainId: monadTestnet.id,
  verifyingContract: "0x0000000000000000000000000000000000000000" as Address,
} as const;

export type Checkout = { merchant: Address; orderId: Hex; amount: bigint; payments: Address };

export function AccountPanel({ checkout }: { checkout: Checkout }) {
  const [account, setAccount] = useState<StoredAccount | undefined>();
  const [support, setSupport] = useState<"no" | "maybe">("maybe");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  // Read-only on mount: never start a ceremony from an effect (StrictMode runs
  // effects twice in dev, and two creates = two accounts).
  useEffect(() => {
    setAccount(loadAccount());
    void passkeyAccountSupport().then(setSupport);
  }, []);

  // ERC-3009 ReceiveWithAuthorization; the nonce commits to merchant + order (plan §5.2).
  const signPayment = ({ account: buyer }: Unlocked) =>
    buyer.signTypedData({
      domain: AUSD_DOMAIN,
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: buyer.address,
        to: checkout.payments,
        value: checkout.amount,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
        nonce: keccak256(
          encodeAbiParameters(
            [{ type: "address" }, { type: "bytes32" }],
            [checkout.merchant, checkout.orderId],
          ),
        ),
      },
    });

  async function relay(signature: Hex) {
    await fetch("/api/relay/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: checkout.orderId, signature }),
    });
  }

  // First-time buyer: create the account and sign the payment, one Face ID.
  async function onCreateAndPay() {
    setBusy(true);
    setMessage(undefined);
    try {
      const { stored, registration, result } = await createAccount(signPayment);
      setAccount(stored);
      await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(registration), // address, inbox public key, EIP-191 signature
      });
      if (result) await relay(result);
      setMessage("Paid. Your receipt is on its way.");
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  // Returning buyer: one Face ID per Confirm.
  async function onPay() {
    setBusy(true);
    setMessage(undefined);
    try {
      await relay(await withAccount(signPayment));
      setMessage("Paid. Your receipt is on its way.");
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (support === "no") return <p>Open this page on your phone to pay.</p>;
  return (
    <section>
      {account ? (
        <button type="button" disabled={busy} onClick={onPay}>
          Confirm
        </button>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={onCreateAndPay}>
            Pay with Face ID
          </button>
          {/* A known device with no stored record: sign in, don't create a 2nd account. */}
          <button type="button" disabled={busy} onClick={onPay}>
            I already use Polaris
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
```

### 9.3 Rules the code encodes

- **A ceremony starts only from a click, and nothing is awaited before it.**
  The checkout data is loaded before the click, the ERC-3009 nonce is computed
  locally, and the receipts salt (§16) is a constant.
  - Safari has historically required a user gesture for WebAuthn. Its current
    policy is **UNVERIFIED**. Starting the call first in the handler is safe
    either way.
- **`useEffect` only reads.** React StrictMode double-invokes effects in dev,
  and two `create`s are two accounts.
- **Prefer try/finally over `using`.** `using session = …` works in TS 5.2+
  and Mera implements `[Symbol.dispose]`, but runtime support in iOS Safari and
  Next's SWC transform are **UNVERIFIED**. The Monad guide gives the same
  fallback: "call `session.end()` in a `finally` block instead."
- **The AUSD EIP-712 `name` and `version` above are placeholders.** Read them
  from the token (`eip712Domain()`, or `name()` / `version()` plus
  `DOMAIN_SEPARATOR`) on Day 0. **UNVERIFIED** for AUSD on Monad.

## 10. How `signTypedData` works on the returned account

Sources: `library/src/viem.ts` and
https://mera.category.xyz/reference/to-viem-account/

```ts
// inside toViemAccount (library/src/viem.ts), verbatim logic:
async signTypedData(typedData) {
  return serializeSignature(await signHash(hashTypedData(typedData)));
}
// signHash: session.signDigest(hexToBytes(hash)) -> { r, s, v: BigInt(27 + recovery), yParity: recovery }
```

- **Mechanics.** viem's own `hashTypedData` computes the EIP-712 digest. The
  session signs it with secp256k1 (`prehash: false`, `lowS: true`, noble
  `format: "recovered"`). The result is 65 bytes of hex, `r‖s‖v` with
  `v = 27` or `28`.
- **Verified** against viem `privateKeyToAccount` with the same key:
  - byte-identical signatures for `ReceiveWithAuthorization` and `Permit` on
    chain 10143
  - `verifyTypedData` returns true
  - `signMessage` and an EIP-1559 `signTransaction` are identical as well, and
    the transaction recovers to the account
- **Splitting for contracts** such as ERC-2612 `permit(owner, spender, value,
  deadline, v, r, s)`: `const { r, s, v, yParity } = parseSignature(sig)` (an
  export of `viem` 2.56.9). The relayer does this, not the PWA.
- **One ceremony, many signatures.** Pay in 4 (`PlanIntent` + `Permit`, plan
  §5.3) is one Face ID: both signatures happen inside one `withAccount`
  callback. Verified: 2 signatures, 1 `navigator.credentials.get`.
- **No RPC, no MON.** Typed-data signing is local. ERC-3009 uses a derived
  bytes32 nonce, so it needs no chain read. ERC-2612 needs `nonces(owner)` from
  a public client.
- **After `end()`,** every method rejects with `SESSION_ENDED` (verified).

## 11. Session lifetime

Source: https://docs.monad.xyz/guides/mera ("Putting it together": *Hold the
session* vs *Prompt per transaction*) and
https://mera.category.xyz/concepts/signing-sessions/

The two options, as the Monad guide frames them:

- **Hold the session:** one prompt, then silent signing. "The key is in page
  memory for the whole session, and any script on the page can sign with it
  while it is live."
- **Prompt per transaction:** "The key exists only for the duration of the
  send, at the cost of a passkey prompt every time."

**For Polaris, prompt per Confirm** (the `withAccount` pattern). A payments app
wants Face ID on every *Confirm*, like Apple Pay. The key then lives for
milliseconds, and the XSS window is small. Home shows the balance from the
cached address with no prompt.

Prompt budget:

| Buyer | Prompts |
|---|---|
| New buyer on a link | **1** to create and pay (2 on authenticators without create-time PRF) |
| Returning buyer | 1 per *Confirm* |
| Pay in 4 | 1 for both signatures |

## 12. Supported authenticators, detection, and testing

### 12.1 The table

Extracted from https://mera.category.xyz/authenticator-support/ on 2026-09-26.
It is identical to the repo at `a3102f4`. "✓ means a live PRF create + get
cycle has been confirmed end-to-end".

| Authenticator | Browser | OS | Status | Supported since |
|---|---|---|---|---|
| 1Password | any browser with 1Password active | any | ✓ | 2.26.1 beta / Android 8.10.38 beta (2024-07) |
| iCloud Keychain | Safari | iOS 18+ | ✓ | Safari 18 / iOS 18 (2024-09) |
| iCloud Keychain | Safari | macOS 15+ | ✓ | Safari 18 / macOS 15 (2024-09) |
| iCloud Keychain | Chrome | macOS 15+ | ✓ | Chrome 132+ (2025-01) |
| iCloud Keychain | Chrome | iOS 18+ | ✓ | Safari 18 / iOS 18 (2024-09) |
| iCloud Keychain | Firefox | macOS 15+ | ✓ | Firefox 139+ (2025-05) |
| Google Password Manager | Chrome | Android | ✓ | Known by 2026-06 |
| Google Password Manager | Chrome | Desktop (signed-in) | ✓ | Chrome 132+ (2025-01) |
| Chrome profile | Chrome | Desktop | Not supported (2026-06-01) | |
| Google Password Manager | Edge | Android | ✓ | Known by 2026-06 |
| Windows Password Manager | Edge | Windows 11 25H2+ | ✓ | Windows 11 25H2 + 2026-02 update |
| Windows Password Manager | Chrome | Windows 11 25H2+ | ✓ | Chrome 147+ (2026-04) |
| Windows Password Manager | Firefox 148+ | Windows 11 25H2+ | ✓ | Firefox 148+ (2026-02) |
| YubiKey 5C Nano | Chrome | Desktop | ✓ | Chrome 116+; YubiKey 5.2+ hmac-secret |
| Bitwarden | Chrome | Desktop | Not supported (2026-06-01) | |
| Dashlane | Chrome | Desktop | Not supported (2026-06-01) | |
| Proton Pass | Chrome | Desktop | ✓ | Latest public version (2026-06) |

"Native apps can use PRF on iOS 18 or later and Android 9 or later."

**The desktop Chrome trap** (Mera docs; the Monad guide calls it "the most
common setup failure"):

- Only passkeys saved to Google Password Manager carry PRF. The local profile
  lacks `hmac-secret`.
- Chrome falls back to the local profile when "Offer to save passwords and
  passkeys" is off, or when a password-manager extension relays the ceremony.
- The passkey is created anyway, and Mera throws `PRF_UNAVAILABLE`.

**Secondary notes** (Corbado, updated 22 Sep 2026; not in Mera's table, so
treat as UNVERIFIED until we test):

- **iOS 18.0–18.3** had "Bugs causing data loss" when the iPhone acts as the
  cross-device (QR) authenticator. Fixed in 18.4+. **Require iOS 18.4+ for
  hybrid.**
- **Hybrid (desktop QR → phone) PRF works** on macOS 15+, Android and
  Windows 11 (Feb 2026+).
- **Windows Hello PRF** arrived with the Feb 2026 update (KB5077181) on 24H2 and
  25H2. Chrome and Edge 146 do PRF on get only; 147+ also on create.
- **Samsung Pass** returns no PRF at registration but does on authentication.
  Mera's create would throw `PRF_UNAVAILABLE` there.
- **Microsoft Password Manager:** "every get() with PRF fails".

**This dev PC** is Windows 11 23H2 (22631), so Windows Hello won't work (§12.3).

### 12.2 Capability detection

- **Mera has no helper.** WebAuthn L3 §5.1.7 defines
  `PublicKeyCredential.getClientCapabilities(): Promise<Record<string, boolean>>`,
  with extension keys formed as `"extension:" + id`, so PRF is
  **`"extension:prf"`**.
- `"webauthn:extension:prf"` in the spec is a *WebDriver* capability, not this
  one.
- TypeScript 5.9's DOM lib types `getClientCapabilities()`.
- **It describes the browser, not the authenticator the user will pick.** The
  spec: "Relying Parties MUST NOT assume that the authenticator processing
  steps for that extension will be performed". So desktop Chrome can report
  `true` and still fail.
- **Our `passkeyAccountSupport()` returns `"no"` only on an explicit `false`,**
  or when there is no secure context or no `PublicKeyCredential`. Everything
  else is `"maybe"`: try the ceremony and route `PRF_UNAVAILABLE` to "Open on
  your phone". Which browsers populate `extension:prf` is **UNVERIFIED**, which
  is why we don't treat a missing key as "no".

### 12.3 Testing without a PRF authenticator (this PC)

Mera's own e2e suite uses Chrome's DevTools-protocol virtual authenticator with
PRF on. Source: `library/test/passkey.e2e.ts` at `a3102f4` (Playwright):

```ts
const client = await page.context().newCDPSession(page);
await client.send("WebAuthn.enable");
await client.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    ctap2Version: "ctap2_1",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    hasPrf: true,
    automaticPresenceSimulation: true,
  },
});
```

- **Use it for CI and for this machine,** against `http://localhost:3000` with
  rpId `localhost`.
- **Set `hasPrf: false`** to exercise the `PRF_UNAVAILABLE` path; Mera's
  extension demo tests do exactly that.
- **Real-device checks still need phones.**

## 13. Cross-device behaviour

- **Same passkey, same PRF, same account.** The output depends only on the
  credential, the rpId and the salt (Mera, *Passkeys and the PRF extension*):
  "Those inputs produce the same 32 bytes on every synced device." Sync happens
  within one provider:
  - iCloud Keychain across Apple devices
  - Google Password Manager across Android and signed-in Chrome
  - 1Password everywhere
- **Across providers there is no sync.** An iPhone user on an Android tablet or
  a Windows laptop has no Polaris passkey there.
  - A hybrid QR ceremony (phone as authenticator) can still return PRF (§12.1,
    secondary).
  - If they tap *create*, they get a **second, empty account**.
  - Mitigations: "I already use Polaris" before create, a dated `displayName`,
    and "Open on your phone" on desktops.
- **The plan's "Open on your phone" QR should be a URL QR** (open this page on
  the phone), not WebAuthn hybrid. It doesn't depend on hybrid PRF.
- **Web and native share accounts** only with the same rpId, the same
  derivation path, and the association files (§6). The Monad RN guide
  troubleshoots exactly this: "Confirm that both apps use the same `rpId`, the
  same passkey, and the same BIP-44 account index."
- **In-app browsers** matter because send-by-link travels over WhatsApp.
  passkeys.dev (https://passkeys.dev/docs/reference/ios/): "Embedded WebViews
  run in the context of the calling app, meaning only passkeys for the linked
  web domain (RP ID) can be created or used". So a WhatsApp or Instagram WebView
  on iOS won't create `polarispay.app` passkeys. The system sheets
  (`ASWebAuthenticationSession` and Safari) do. Which in-app browser WhatsApp
  uses on iOS and Android today is **UNVERIFIED**.
  - Test on Day 1.
  - On a claim or pay link opened in an embedded WebView, show "Open in
    Safari/Chrome".
- **Installed PWA (iOS home screen) and Android TWA:** PRF there is
  **UNVERIFIED**. Test on Day 1.

## 14. Monad-specific notes

Sources:

- https://docs.monad.xyz/guides/mera
- https://docs.monad.xyz/guides/mera/react-native
- https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets

- **Monad's docs list Mera as an embedded-wallet option:** "Passkey wallets —
  self-custodial BIP-44 EOAs (EVM + Solana), no seed phrase". They ship a web
  guide and a React Native guide ("Mera v0.2.0 adds React Native support").
- **"The accounts are regular EOAs. There is nothing to deploy, and no bundler
  or MPC service to run."** That supports the Mera UX bounty's "no custody
  backend".
- **viem 2.56.9 exports `monad` and `monadTestnet`** (verified):
  - `monad`: 143, "Monad", `https://rpc.monad.xyz`
  - `monadTestnet`: 10143, "Monad Testnet", `https://testnet-rpc.monad.xyz`
- **"Monad charges the `gasLimit` you declare, not the gas used."** The guide
  passes `gas: 21_000n`. That applies to our relayer (plan §5.3), not the PWA,
  which never sends transactions.
- **Monad guide code issues to avoid when copying it:**
  - The web guide imports `@scure/bip39/wordlists/english` without `.js`
    (fails; §2).
  - Its `deriveEvmKey` doesn't zero the seed.
  - It uses `rpId: location.hostname` (§6).
  - The React Native guide's version is the better one.
- **The guide recommends trying the live demo first:** "check that the
  [demo](https://mera.category.xyz/demo/) works with your passkey provider on
  the browsers and devices you plan to support". It is a zero-code Day-0 smoke
  test for every team phone.
- **Don't use `signAuthorization` (EIP-7702)** on Mera accounts. Plan §5.3
  avoids 7702 on Monad. Mera never puts P-256 passkey signatures on chain, so
  Monad's P256 precompile plays no part.

## 15. React Native (last resort, plan §3.1)

Sources:

- https://docs.monad.xyz/guides/mera/react-native
- https://mera.category.xyz/recipes/use-mera-with-react-native/

What it takes:

- An Expo **development build**: "Expo Go cannot run this app because it does
  not include the native passkey module".
- `react-native-passkey` **3.6.1 exactly**. The peer dependency is pinned, and
  npm latest is 3.6.2.
- An `expo-crypto` `getRandomValues` polyfill, imported before Mera.
- `webAuthnClient: reactNativeWebAuthnClient` on every ceremony.
- The association files on `polarispay.app` (§6).
- The same rpId and the same path as the web, so the same accounts.

The Monad guide requires **Node 24** for this path.

On mobile, the PRF output may be kept in platform secure storage behind
biometrics. "Do not store the PRF output in `AsyncStorage`". The Mera demo uses
Expo SecureStore with `requireAuthentication: true`.

## 16. "Receipts only you can read": the non-wallet use of PRF key material

The bounty (portal copy): *"Mera: One Passkey, Many Keys: Most creative non-wallet
use of Mera's PRF-derived key material."* Plan §3.5 describes it: purchase
history stored encrypted, "our servers hold ciphertext and the history follows
the passkey to every device."

### 16.1 What it hides, honestly

- **Public on chain:** the buyer's address, the merchant's address, the amount
  and the time. Anyone can read these on Monad.
- **Private:** *what was bought*. That covers line items, the merchant's
  description, notes, the plan's purpose and local-currency context.
- **When the server sees plaintext:**
  - The merchant created the checkout session through our API, so our server
    sees the description until settlement. After settlement we keep only the
    sealed copy and drop the plaintext.
  - Receipts the server writes (instalments, subscription charges) are sealed
    as they're written, so the server holds plaintext only in that moment.
- **Pitch line:** "Our database holds your purchase history as ciphertext only
  your Face ID opens."

### 16.2 How to derive separate keys safely

These rules follow Mera's own vault code and RFC 5869/9180 practice:

1. **Never use the PRF output directly as a key.** Run it through HKDF-SHA-256
   with a **distinct `info` label per purpose**. Mera does exactly this, with
   the comment "HKDF info keeps the encryption key distinct from any other key
   derived from the same PRF output".
   - An empty HKDF salt is fine because the PRF output is already uniformly
     random, as Mera also assumes.
   - Never reuse Mera's label `mera.v1.encrypt.secret`.
2. **One label, one key, one algorithm.**
   - `polaris/v1/receipts/aes-256-gcm` gives the symmetric key.
   - `polaris/v1/receipts/hpke-x25519-ikm` gives the inbox key pair.
   - Version the labels, so rotation means a new label.
3. **Make keys non-extractable** (`extractable: false`), and zero the
   intermediate bytes.
4. **Use AEAD with AAD that binds the record:**
   `polaris.receipt.v1|<owner address>|<receipt id>`. The server can then
   neither swap ciphertexts between rows or users nor replay them (verified:
   both fail). Mera's vaults don't authenticate their metadata; ours should.
5. **Use random 96-bit nonces** for AES-GCM, and let HPKE manage its own.
6. **Receipts are written when the buyer isn't there.** Pay-in-4 collections
   and subscription charges happen offline, so a symmetric key alone isn't
   enough. Publish a **public key** that the server, CRE or the merchant can
   seal to: RFC 9180 **HPKE**, `DHKEM(X25519, HKDF-SHA256)` + `HKDF-SHA256` +
   `AES-256-GCM`, through `@hpke/core@1.9.0` and `@hpke/dhkem-x25519@1.8.0`.
   - The key pair comes from RFC 9180 `DeriveKeyPair(ikm)`, so it is
     deterministic from the PRF, with nothing stored.
   - `@hpke/dhkem-x25519` is pure JS, so it doesn't depend on WebCrypto X25519
     support in the browser.
   - This replaces the previous draft's hand-rolled ECIES.

### 16.3 Where the key material comes from

| Option | Prompts | Recovery | Verdict |
|---|---|---|---|
| **A. HKDF from the sign-in PRF output** (Mera's default salt) | **0 extra.** Derived in the same ceremony as signing, and the inbox key is registered at onboarding | The 24-word phrase restores the receipts too, since the phrase *is* the PRF output (verified) | **Ship this.** It keeps the first five minutes to one Face ID |
| B. A separate PRF namespace: `getPasskeyPrfOutput({ prfSalt: sha256("polaris.receipts.v1") })` | +1 at onboarding to register, +1 per unlock. Mera evaluates one salt per ceremony | Not recoverable from the phrase (verified: the phrase can't open B receipts) | A stronger isolation story ("even your recovery phrase can't read your receipts"). Use it if the demo can afford the extra prompt. Same code, one function (`unlockIsolatedReceiptKeys`) |
| C. A Mera secret vault holding a random receipts key | +1 to create, +1 per open, and we store the vault | Only with the vault | No. Vaults exist for secrets that come from outside the passkey |

Mera's docs back B's framing: "Salts act as namespaces", and an explicit salt
"supports custom PRF namespaces". A is equally sound cryptographically: same
root, HKDF-separated. It trades isolation from the phrase for zero extra
prompts and phrase-based recovery.

### 16.4 `lib/receipts-key.ts` (client and server)

Composed from:

- Mera `library/src/secret.ts` (`deriveEncryptionKey`'s HKDF parameters, with a
  new label)
- the `@hpke/core` README and `.d.ts` for `CipherSuite`, `seal`, `open` and
  `kem.deriveKeyPair`: https://github.com/dajiaji/hpke-js

It was verified by `receipts.ts`, `browser-sim.test.ts` and `server/interop.test.ts`.

```ts
// lib/receipts-key.ts — "receipts only you can read". WebCrypto + RFC 9180 HPKE.
// Works in browsers and in Node 22 (server-side sealing).
import {
  getPasskeyPrfOutput,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519"; // pure-JS X25519

const te = new TextEncoder();
// Distinct HKDF labels = independent keys. Never reuse "mera.v1.encrypt.secret".
const AES_INFO = te.encode("polaris/v1/receipts/aes-256-gcm");
const HPKE_INFO = te.encode("polaris/v1/receipts/hpke-x25519-ikm");

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export type ReceiptKeys = {
  /** Non-extractable AES-256-GCM key for records this device writes and reads. */
  aesKey: CryptoKey;
  /** HPKE X25519 key pair; only the public half ever leaves the device. */
  inbox: CryptoKeyPair;
  /** 32 bytes. Register with our API so anyone can seal receipts to the buyer. */
  inboxPublicKey: Uint8Array;
};

/** Derive the receipt keys from any 32-byte PRF output. Deterministic. */
export async function deriveReceiptKeys(
  prfOutput: Uint8Array<ArrayBuffer>,
): Promise<ReceiptKeys> {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  const ikm = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: AES_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HPKE_INFO },
      ikm,
      256,
    ),
  );
  try {
    const inbox = await suite.kem.deriveKeyPair(seed); // RFC 9180 §7.1.3 DeriveKeyPair
    const inboxPublicKey = new Uint8Array(
      await suite.kem.serializePublicKey(inbox.publicKey),
    );
    return { aesKey, inbox, inboxPublicKey };
  } finally {
    seed.fill(0);
  }
}

// Option B only: a PRF namespace of our own, independent of the wallet root.
// = SHA-256("polaris.receipts.v1"), a constant so nothing is awaited before the
// WebAuthn call in a click handler. Changing it orphans every receipt.
const RECEIPTS_PRF_SALT = Uint8Array.from(
  "f10ac007d791c5b272856b6b15b29f3682f8a76d5ff971a5401b4714617e0ad6".match(/../g)!,
  (h) => parseInt(h, 16),
);

/** Option B: one extra Face ID, a separate PRF evaluation, keys the recovery phrase can't reach. */
export async function unlockIsolatedReceiptKeys(
  rpId: string,
  credential?: PasskeyCredentialMetadata,
): Promise<ReceiptKeys> {
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId,
    prfSalt: RECEIPTS_PRF_SALT,
    ...(credential ? { credential } : {}),
  });
  try {
    return await deriveReceiptKeys(prfOutput);
  } finally {
    prfOutput.fill(0);
  }
}

/** Binds a ciphertext to its owner and record id, so the server can't swap rows. */
export const receiptAad = (owner: string, id: string) =>
  te.encode(`polaris.receipt.v1|${owner.toLowerCase()}|${id}`);

/** Anyone (our API, CRE, the buyer's device) seals with the public key alone. No prompt. */
export async function sealToInbox(
  inboxPublicKey: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<{ enc: Uint8Array; ct: Uint8Array }> {
  const recipientPublicKey = await suite.kem.deserializePublicKey(inboxPublicKey);
  const { enc, ct } = await suite.seal({ recipientPublicKey }, plaintext, aad);
  return { enc: new Uint8Array(enc), ct: new Uint8Array(ct) };
}

/** Only the passkey holder opens. Throws OpenError on a wrong key or AAD. */
export async function openFromInbox(
  keys: ReceiptKeys,
  aad: Uint8Array,
  sealed: { enc: Uint8Array; ct: Uint8Array },
): Promise<Uint8Array> {
  return new Uint8Array(
    await suite.open({ recipientKey: keys.inbox, enc: sealed.enc }, sealed.ct, aad),
  );
}
```

### 16.5 Server side (API, indexer webhook, CRE dunning path): Node 22

Composed from the `@hpke/core` README (`CipherSuite.seal`) and viem
`verifyMessage`. Verified by `server/interop.test.ts`:

- a genuine registration verifies
- a forged key is rejected
- a server-sealed row opens with the client's `openFromInbox`

```ts
// services/api/src/receipts.ts — Node 22. Seals with the buyer's public key only.
import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { type Address, type Hex, hexToBytes, verifyMessage } from "viem";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

/** POST /api/accounts: accept an inbox key only with the account's signature over it. */
export async function verifyRegistration(r: { address: Address; inboxPublicKey: Hex; signature: Hex }) {
  if (hexToBytes(r.inboxPublicKey).length !== 32) return false;
  return verifyMessage({
    address: r.address,
    message: `Polaris receipts key ${r.inboxPublicKey}`,
    signature: r.signature,
  });
}

/** Called by the checkout handler, the indexer webhook or the CRE dunning path. */
export async function sealReceipt(inboxPublicKey: Hex, owner: Address, id: string, receipt: unknown) {
  const recipientPublicKey = await suite.kem.deserializePublicKey(hexToBytes(inboxPublicKey));
  const aad = new TextEncoder().encode(`polaris.receipt.v1|${owner.toLowerCase()}|${id}`);
  const { enc, ct } = await suite.seal(
    { recipientPublicKey },
    new TextEncoder().encode(JSON.stringify(receipt)),
    aad,
  );
  return {
    id,
    enc: Buffer.from(enc).toString("base64url"),
    ct: Buffer.from(ct).toString("base64url"),
  };
}
```

**Opening on the Activity screen** is one Face ID: `withAccount(async ({
account, receipts }) => openFromInbox(receipts, receiptAad(account.address,
row.id), row))`. Start fetching the rows but don't `await` them before the
ceremony; await them inside the callback.

### 16.6 Verified results

| Check | Result |
|---|---|
| Option A keys are identical at onboarding (create) and at a later sign-in | ✓ |
| Option B keys are identical on `pay.` and `app.` (same rpId) | ✓ |
| The receipts key ≠ the raw PRF output, and ≠ Mera's vault key for the same PRF (different HKDF label) | ✓ (neither opens a receipt) |
| AAD binding: another receipt id or owner fails to decrypt | ✓ (AES-GCM and HPKE) |
| The exported 24-word phrase re-derives option A keys | ✓ |
| The exported phrase does **not** reach option B keys, and option B is deterministic across ceremonies | ✓ |
| HPKE `deriveKeyPair` gives the same 32-byte public key from the same PRF on every ceremony | ✓ |
| Sealed in Node 22 with the public key only; opened in the browser code after a Face ID | ✓ |
| Registration signature (EIP-191) verifies, and a forged key is rejected | ✓ |
| Sizes | HPKE `enc` is 32 B. A small JSON receipt's ciphertext is its plaintext + 16 B tag |

### 16.7 Demo beat

Pay on phone A, then open *Activity* on phone B (the same iCloud or Google
account). Face ID shows the line items. Cut to the database row: `enc` and `ct`
in base64.

"Klarna can read what you bought. We can't."

*One Face ID, three keys:* your dollars (secp256k1), your receipts inbox
(X25519) and your private notes (AES). None of them is ever stored.

## 17. UNVERIFIED (test on real devices, Day 0–1)

- **Standalone and wrapped apps:**
  - PRF in an installed iOS home-screen PWA, and whether its storage is
    separate from Safari's
  - PRF in an Android TWA
- **Hybrid (desktop QR → phone) PRF** on our targets. Secondary sources say
  yes, except iOS 18.0–18.3.
- **Create-time PRF.** Which of our target authenticators skip it, making
  sign-up cost two prompts.
- **Capability reporting.** Which browsers put `extension:prf` in
  `getClientCapabilities()`.
- **Safari's current user-gesture rule for WebAuthn.** We start ceremonies
  first in click handlers regardless.
- **`using` declarations:** iOS Safari runtime and Next's SWC transform. We use
  try/finally instead.
- **In-app browsers:** which one WhatsApp and Instagram use today, and whether
  passkeys work there.
- **`*.localhost` rpIds** in dev.
- **Related Origin Requests with PRF.**
- **`mnemonicToSeedSync` timing** on low-end Android.
- **AUSD's EIP-712 `name` and `version`** on Monad.
- **Samsung Pass and Microsoft Password Manager behaviour** (secondary source
  only).
- **Whether Privy on the merchant side conflicts with "Mera is the entire
  account layer"** (plan §3.4 and §10). Our reading: the *consumer* layer is
  entirely Mera. Ask on Day 0.

## 18. Corrections to `docs/plan.md`

- **§5.6 and Appendix A (Mera row):**
  - `toViemAccount` comes from `@category-labs/mera/viem`.
  - The flow is `createPasskeyWithPrfOutput` / `getPasskeyPrfOutput` →
    **our** `deriveEvmKey` (`@scure/bip39` + `@scure/bip32`,
    `m/44'/60'/0'/0/0`) → `createSecp256k1SigningSession` → `toViemAccount`.
  - Add the two `@scure` packages (and `@hpke/*` for §3.5).
- **§5.6 says the passkey syncs "through iCloud Keychain and Google Password
  Manager, so the same account appears on every device the buyer owns".**
  That holds within one provider only. iCloud ↔ Android doesn't sync (§13).
- **§5.6, rpId:** add "from config, never `location.hostname`", plus
  `localhost` for dev and the preview rule (§6). Consider serving checkout from
  one origin (`app.polarispay.app/pay/<id>`) (§7).
- **§5.6, supported devices:** the list matches Mera's table. Add:
  - the desktop Chrome local profile creates a passkey but fails
  - iOS 18.4+ for QR hybrid (secondary)
  - installed-PWA PRF is untested
- **§3.5:** the stretch is cheap. The keys come from the same ceremony
  (option A), so it adds no prompts. It needs an inbox-key registration and a
  ciphertext table.
- **§10, "offer mnemonic export":** keep it opt-in in settings to stay
  consistent with "no seed phrase" (§5.3).

## What Polaris should do

1. **§5.6, dependencies (Day 0).** Add these to the PWA and pin them exactly:
   - `@category-labs/mera@0.2.0`
   - `viem`
   - `@scure/bip32@2.4.0` and `@scure/bip39@2.4.0`
   - `@hpke/core@1.9.0` and `@hpke/dhkem-x25519@1.8.0`

   Accept the Node 24 engines warning, which upstream has already dropped.
   Copy `lib/mera-account.ts` (§9.1) and `lib/receipts-key.ts` (§16.4)
   verbatim; both are built and tested.
2. **§5.6, rpId (Day 0).**
   - Set `NEXT_PUBLIC_MERA_RP_ID=polarispay.app` in prod and `localhost` in
     dev, and never change it after launch.
   - Serve checkout from the same origin as the app, or at least under
     `*.polarispay.app`.
   - No third-party CNAMEs under the domain, and a strict CSP on ceremony
     pages.
   - Checkout is never an iframe.
3. **§3.1 and §5.6, onboarding.** A first-time buyer on a link taps *Pay with
   Face ID* and `createAccount(signPayment)` runs: account + registration +
   payment signature in **one** Face ID. Always offer *I already use Polaris*
   (discoverable sign-in) next to it. The claim screen for send-by-link uses
   `createAccount()` too; the claim signature comes from the link's throwaway
   key.
4. **§5.3, signing.** Every consumer action is `account.signTypedData(...)`
   inside one `withAccount` (ERC-3009, ERC-2612, `PlanIntent`,
   `SubscribeIntent`). The relayer splits signatures with `parseSignature`. The
   PWA never calls `sendTransaction` or `signAuthorization`.
5. **§5.6, unsupported devices.**
   - `passkeyAccountSupport() === "no"` means go straight to the "Open on your
     phone" URL QR.
   - Otherwise try the ceremony and map `PRF_UNAVAILABLE` to the same QR.
   - Detect embedded in-app WebViews on claim and pay links and show "Open in
     Safari/Chrome".
6. **Day 0–1 test matrix** (plan §7 and §11):
   - every team phone on https://mera.category.xyz/demo/ first, then our build
   - iPhone Safari, in the tab and as an installed PWA
   - Android Chrome, in the tab, as a PWA, and in a TWA if Agora needs one
   - desktop Chrome signed in to Google Password Manager
   - desktop → phone QR hybrid
   - a WhatsApp-opened link on both OSes
   - on this Windows 23H2 PC: the CDP virtual authenticator (§12.3)

   Record the results in this file.
7. **§3.4, Mera UX write-up.** Mera is the only consumer account path:
   - no seed phrase (the recovery key is opt-in, behind a fresh Face ID)
   - no extension
   - no custody backend: the relayer holds only its own MON, and our database
     holds addresses, public keys and ciphertext, never a PRF output or a
     private key
8. **§3.5, One Passkey, Many Keys.** Ship option A (§16.3):
   - register the inbox key at onboarding
   - seal every receipt: at checkout by the client, and for collections and
     subscription charges by the API or CRE path
   - open them on *Activity* with one Face ID
   - drop plaintext checkout descriptions after settlement

   Record the §16.7 demo beat. Switch to option B only if we want the "even
   your recovery phrase can't read them" line and can afford one more prompt.
9. **§8, server auth.** Authenticate account-scoped API calls with signatures
   from the derived key (EIP-191, or SIWE through `viem/siwe`), made inside
   ceremonies the user is already doing. Never treat a Mera ceremony as proof
   to the server.
10. **§10, risks.** Add *Recovery key* (§5.3) before any domain decision is
    final. Add "second account on a new device" to the risk table, mitigated by
    *I already use Polaris* and dated passkey labels.
