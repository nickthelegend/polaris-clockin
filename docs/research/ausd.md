# AUSD on Monad testnet: live check for Polaris

Researched 26 Sep 2026 for `docs/plan.md` §3.1 (Agora), §5.2 (contracts),
§5.3 (gasless by construction), §10 (risk "AUSD's 3009 or 2612 behaves
differently on testnet"), §11 (Day 0 "Script-check testnet AUSD") and
Appendix A (addresses).

Everything below comes from four kinds of source. Anything I couldn't check is
marked **UNVERIFIED**.

- **The live chain.** `packages/contracts/scripts/check-monad.js`, run against
  `https://testnet-rpc.monad.xyz`. It uses no funded key and sends no
  transaction.
- **Agora's source.** `agora-finance/agora-dollar-evm` at commit `ed241d5`
  ("publishing release for AUSD v2.1.0"). The deployed implementation reports
  `version() = (2,1,0)`.
- **Verified contracts on Monadscan.** The AUSD proxy, the AUSD implementation
  and the faucet implementation.
- **Official docs.** Agora, Monad, Circle, Chainlink, Etherscan and viem.

---

## 0. The short version (read this if nothing else)

1. **Yes, our contracts can call AUSD `receiveWithAuthorization` with
   `(v, r, s)`.** I proved it with `eth_call` against the live token, using a
   throwaway key and `value = 0`:
   - it works when the payee is the caller, whether that's an EOA or a
     **contract**. The contract case uses a state-override forwarder.
   - the `bytes` signature variant works too.
   - a stranger submitting the same authorization gets `InvalidPayee`.
   - a wrong domain version or a Transfer-typed signature gets
     `InvalidSignature`.
   - `transferWithAuthorization` and `permit` also work when relayed by
     anyone.
2. **The AUSD EIP-712 domain is `name: "Agora Dollar"`, `version: "1"`,
   `chainId: 10143`, `verifyingContract: 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`.**
   - `DOMAIN_SEPARATOR()` is
     `0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1`.
     I recomputed it locally and it matches.
   - Three independent sources agree: `eip712Domain()` (ERC-5267), the proxy's
     verified constructor arguments on Monadscan, and Agora's deploy script.
3. **Two traps sit right next to the domain:**
   - **`name()` returns `"AUSD"`, not the EIP-712 name**, and **`version()`
     returns a struct `(2, 1, 0)`, not a string.** Any code that builds the
     domain from `name()` + `version()` signs garbage, and
     `docs/research/mera.md` §8 does exactly that: its placeholder
     `name: "AUSD"` would revert with `InvalidSignature`.
   - **viem's `getEip712Domain` returns `salt: 0x00…00` for AUSD.** Passing that
     domain to `signTypedData` unchanged adds `salt` to the domain type, and the
     signature is rejected. I reproduced this: `Erc2612InvalidSignature`.
     Drop `salt` first (the token's `fields` byte is `0x0f`, which excludes
     salt).
4. **The one real blocker: the AUSD faucet is empty.**
   - It holds 0.000001 AUSD, so `requestFunds` reverts with
     `InsufficientFunds()`.
   - Historical `eth_call`s show it draining from 640,000 AUSD on 12 Sep to
     zero on 25 Sep, with no refill at any sampled point.
   - Minting is role-gated to Agora's key (`0x99B0…6E97`).
   - **Ask Agora on Day 0 to refill the faucet or send AUSD to our treasury.**
     Any holder can refill it with a plain ERC-20 transfer.
5. **Circle USDC on testnet works the same way** (`name "USDC"`,
   `version "2"`; 3009 and 2612 with `(v, r, s)` and `bytes`). It's a fallback
   token, funded from faucet.circle.com.
6. **The infrastructure the plan assumes is present on testnet:**
   - Multicall3 at the canonical address
   - Permit2 at the canonical address (its domain matches `"Permit2"`)
   - the CRE `MockKeystoneForwarder 1.0.0` (`0xB9F7…D192`)
   - the CRE `KeystoneForwarder 1.0.0` (`0xF834…4482`)
7. **Gas right now:**
   - `eth_gasPrice` is 102 gwei (base fee 100 gwei, which is the floor, plus
     a 2 gwei tip).
   - **A 150,000-gas limit costs 0.0153 MON** (0.015 MON at the floor).
   - AUSD `receiveWithAuthorization` estimates about 90k gas at value 0 and
     113k when moving 200 AUSD to a fresh payee. `permit` estimates 111k.
8. **Blocks are 312.6 ms on average over the last 100,000 blocks, not 400 ms.**
   Monad's JSON-RPC docs say "a block every 300ms". Update the pitch number in
   plan §2 before recording.

---

## 1. Packages, versions and sources verified

| Thing | Version / commit | How verified |
|---|---|---|
| `ethers` (used by the script) | **6.17.0** (= npm `latest`) | `packages/contracts/node_modules/ethers/package.json`; `npm view ethers version` |
| `viem` (the app's signer, also Mera's `toViemAccount`) | **2.56.9** (= npm `latest`) | `npm view viem version`; ran the snippets in §9 against the live chain with `viem@2.56.9` from npm |
| `@openzeppelin/contracts` (installed in `packages/contracts`) | 5.6.1 | `node_modules/@openzeppelin/contracts/package.json` |
| Node | 22.21.1 | `node -v` |
| AUSD implementation source | `agora-finance/agora-dollar-evm` @ `ed241d569c746f1fb5f6932f3fd11ebd84235c66` (AUSD v2.1.0) | `git clone`; deployed `version()` returns `(2,1,0)`; Monadscan shows the implementation `0xc1e3…12dA` as verified `AgoraDollar`, solc 0.8.28 |
| AUSD proxy source | Monadscan-verified `AgoraDollarErc1967Proxy`, solc **0.8.21** (older than the repo's 0.8.28) | `https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC#code`. Its constructor args are `eip712Name "Agora Dollar"`, `eip712Version "1"`, owner `0x99B0E95F…cFCcf6E97` |
| AUSD faucet source | Monadscan-verified `AgoraFaucet` (implementation `0xba804DF5…00ccE2a49`), `version() = (1,0,0)` | `https://testnet.monadscan.com/address/0xba804DF5c476E8EaeF87BF8085F295300ccE2a49#code` (read with `curl`; the ABI is in §5.1) |
| USDC source | `circlefin/stablecoin-evm` @ `fc85788bc7c23cefe3df1a757133048bfddadeaa` (FiatTokenV2_2) | `git clone`; the live `version()` returns `"2"` |

Why I used HTML for the faucet ABI: the explorer APIs wouldn't answer without
credentials.

- **Monadscan's API** needs a key. The Etherscan V2 endpoint
  (`https://api.etherscan.io/v2/api?chainid=10143&module=contract&action=getabi…`)
  answered `Missing/Invalid API Key`. The legacy
  `api-testnet.monadscan.com` said "deprecated V1 endpoint".
- **MonadVision** returned a Cloudflare challenge page, which I didn't try to
  get past.
- **Sourcify** has no match for any of the three contracts on 10143.
- The script accepts `ETHERSCAN_API_KEY`: set it and it pulls the ABI through
  the V2 API. Etherscan lists Monad Testnet 10143 as free-tier
  (https://docs.etherscan.io/supported-chains).

---

## 2. How to run the check

```bash
cd /e/Projects/polaris/packages/contracts && node scripts/check-monad.js
# optional
MONAD_RPC=https://<other-rpc> node scripts/check-monad.js
ETHERSCAN_API_KEY=<free key> node scripts/check-monad.js   # adds the Monadscan ABI of the faucet
```

What it does, all read-only (`eth_chainId`, `eth_getBlockByNumber`,
`eth_getCode`, `eth_getStorageAt`, `eth_call`, `eth_estimateGas`,
`eth_gasPrice`, `eth_maxPriorityFeePerGas`):

- chain id, latest block and timestamp, block gas limit, base fee, and the
  average block time over 100k blocks
- for AUSD and USDC:
  - the EIP-1967 implementation, admin and beacon slots, plus Circle's
    ZeppelinOS slots
  - the flag bits Agora packs into the high 96 bits of the implementation slot
  - `name`, `symbol`, `decimals`, `totalSupply`, `DOMAIN_SEPARATOR`, the four
    typehash getters, `version()` (string or struct) and `eip712Domain()`
  - a local recomputation of the domain separator from the candidate
    name/version pairs
  - a PUSH4 scan that walks the opcodes, so push data is never read as code,
    for all 12 selectors in the task, on both the proxy and the implementation
  - a PUSH32 scan for the five typehash constants
- **signature checks.** A random in-memory key signs typed data. Then
  `eth_call` runs with `value = 0` from an empty account. That exercises the
  whole signature path without moving money, and it includes the negative
  controls.
- **a funded gas estimate.** `eth_estimateGas` with a state override gives a
  throwaway payer 1,000 AUSD, following the `StorageLib` layout: the
  `accountData` mapping at `ERC20_CORE_STORAGE_SLOT`, stored as
  `balance << 8 | isFrozen`.
- the faucet's ABI (selector scan), config, balance, a simulated
  `requestFunds`, and its balance history at past blocks
- code presence for Multicall3, Permit2 and both CRE forwarders:
  - Multicall3's `getChainId()`
  - Permit2's `DOMAIN_SEPARATOR`, checked against `"Permit2"`
  - each forwarder's `typeAndVersion()`
- gas prices and MON costs

---

## 3. Live output (26 Sep 2026, 12:38 UTC, verbatim)

```text
== Network
  rpc                                        https://testnet-rpc.monad.xyz
  eth_chainId                                0x279f (10143)
  latest block                               65853021
  latest block timestamp                     1790426298 (2026-09-26T12:38:18.000Z)
  block gasLimit                             150000000
  block baseFeePerGas                        100000000000 wei (100.0 gwei)
  avg block time, last 100000 blocks         312.6 ms

== AUSD 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
  code bytes                                 5937
  slot eip1967Implementation                 0x000000000000000000000000c1e3c7d486d6a92fbe920232e439eec2ceb112da
  slot eip1967Admin                          0x0000000000000000000000002ffb5584c3c8ad18b3fc8872b91aa49a2ac8d169
  slot eip1967Beacon                         0 (empty)
  slot zosImplementation                     0 (empty)
  slot zosAdmin                              0 (empty)
  EIP-1967 impl slot high 96 bits            0 (no packed flags set)
    flag isMsgSenderFrozenCheckEnabled          false
    flag isMintPaused                           false
    flag isBurnFromPaused                       false
    flag isFreezingPaused                       false
    flag isTransferPaused                       false
    flag isSignatureVerificationPaused          false
    flag isTransferUpgraded                     false
    flag isTransferFromUpgraded                 false
    flag isTransferWithAuthorizationUpgraded    false
    flag isReceiveWithAuthorizationUpgraded     false
    flag isBridgingPaused                       false
  implementation                             0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA (22835 bytes, keccak 0x2e612fde7bb56c8b...)
  name()                                     AUSD
  symbol()                                   AUSD
  decimals()                                 6
  totalSupply()                              302010000000000
  DOMAIN_SEPARATOR()                         0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1
  PERMIT_TYPEHASH()                          0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH()     0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH()      0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8
  CANCEL_AUTHORIZATION_TYPEHASH()            0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429
  implementation()                           0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA
  proxyAdminAddress()                        0x2fFb5584C3C8AD18B3fc8872B91AA49a2aC8d169
  isTransferPaused()                         false
  isSignatureVerificationPaused()            false
  isReceiveWithAuthorizationUpgraded()       false
  isTransferWithAuthorizationUpgraded()      false
  isMsgSenderFrozenCheckEnabled()            false
  domainSeparatorV4()                        0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1
  getMinterRoleMembers()                     [0x99B0E95Fa8F5C3b86e4d78ED715B475cFCcf6E97]
  getBridgeMinterRoleMembers()               []
  version() as (major,minor,patch)           [2, 1, 0]
  eip712Domain() (ERC-5267)                  fields=0x0f name="Agora Dollar" version="1" chainId=10143 verifyingContract=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC salt=0x0000000000000000000000000000000000000000000000000000000000000000 extensions=[]
  EIP-712 domain recomputation (chainId from eth_chainId, verifyingContract = token):
    eip712Domain()       name="Agora Dollar" version="1" -> 0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1 MATCHES DOMAIN_SEPARATOR()
    guess                name="Agora Dollar" version="1" -> 0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1 MATCHES DOMAIN_SEPARATOR()
    guess                name="AUSD" version="1" -> 0xe6af656f42e4f4a09f37146e4d3a3c0833078b83a12382f3991cadca17d735f5 no match
  Selectors present as PUSH immediates (opcode walk):
  function                                                                                                proxy     impl      
  0xd505accf permit(address,address,uint256,uint256,uint8,bytes32,bytes32)                                -         yes       
  0x9fd5a6cf permit(address,address,uint256,uint256,bytes)                                                -         yes       
  0x7ecebe00 nonces(address)                                                                              -         yes       
  0x3644e515 DOMAIN_SEPARATOR()                                                                           -         yes       
  0x84b0196e eip712Domain()                                                                               -         yes       
  0xe3ee160e transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)yes       yes       
  0xcf092995 transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)             yes       yes       
  0xef55bec6 receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)yes       yes       
  0x88b7ab63 receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)              yes       yes       
  0x5a049a70 cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)                                   -         yes       
  0xb7b72899 cancelAuthorization(address,bytes32,bytes)                                                   -         yes       
  0xe94a0102 authorizationState(address,bytes32)                                                          -         yes       
  Typehash constants present as PUSH32 immediates:
  EIP712Domain(name,version,chainId,verifyingContract) 0x8b73c3c69bb8fe3d...                              yes       yes       
  Permit 0x6e71edae12b1b97f...                                                                            -         yes       
  TransferWithAuthorization 0x7c7c6cdb67a18743...                                                         yes       yes       
  ReceiveWithAuthorization 0xd099cc98ef71107a...                                                          yes       yes       
  CancelAuthorization 0x158b0a9edf7a828a...                                                               -         yes       

== AUSD: signature checks by eth_call (throwaway key, value 0, nothing sent)
  receiveWithAuthorization (v,r,s), msg.sender == to        OK, eth_estimateGas 90245
  receiveWithAuthorization (bytes r||s||v), same auth       OK
  receiveWithAuthorization submitted by a stranger          revert InvalidPayee(0x45e953260AF06d009a305c2304812B02d481aac2, 0x6fc77B52383a4a82a09609b795ED525D8F37f473)
  receiveWithAuthorization (v,r,s) called by a contract     OK
  receiveWithAuthorization signed with {"version":"2"} revert InvalidSignature()
  receiveWithAuthorization with a Transfer-typed signature  revert InvalidSignature()
  transferWithAuthorization (v,r,s), relayed by anyone      OK, eth_estimateGas 90220
  permit (v,r,s), relayed by anyone                         OK, eth_estimateGas 111340
  authorizationState(random, 0x0)            false

== AUSD faucet 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C
  code bytes                                 1200
  slot eip1967Implementation                 0x000000000000000000000000ba804df5c476e8eaef87bf8085f295300cce2a49
  slot eip1967Admin                          0x00000000000000000000000085f263d91f2706b32c85f22c681c0fe175eb48f2
  slot eip1967Beacon                         0 (empty)
  implementation                             0xba804DF5c476E8EaeF87BF8085F295300ccE2a49 (3124 bytes, keccak 0xcc69415ffc883836...)
  Monadscan verified ABI (Etherscan V2)      n/a (ETHERSCAN_API_KEY not set)
  Selector scan (AgoraFaucet ABI as verified on Monadscan, plus common faucet names):
  function                                                                                                proxy     impl      
  0x544c7cf9 requestFunds(address)                                                                        -         yes       
  0xfc0c546a token()                                                                                      -         yes       
  0x905467f6 faucetDripAmount()                                                                           -         yes       
  0x14bc2fd7 maxAmountToOwn()                                                                             -         yes       
  0x48645704 maxDripFrequency()                                                                           -         yes       
  0xd9772a25 lastDripTimestamp()                                                                          -         yes       
  0xcdc438b4 initialize((address,uint256,uint256,uint256))                                                -         yes       
  0x8be6392f AGORA_FAUCET_STORAGE_SLOT()                                                                  -         yes       
  0x54fd4d50 version()                                                                                    -         yes       
  0x4e71d92d claim()                                                                                      -         -         
  0xde5f72fd faucet()                                                                                     -         -         
  0x6a627842 mint(address)                                                                                -         -         
  0x67a5cd06 drip(address)                                                                                -         -         
  0x359cf2b7 requestTokens()                                                                              -         -         
  version() as (major,minor,patch)           [1, 0, 0]
  token()                                    0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
  faucetDripAmount() (base units)            10000000000
    = 10000.0 AUSD
  maxAmountToOwn() (base units)              100000000000
    = 100000.0 AUSD
  maxDripFrequency() (seconds, GLOBAL)       60
  lastDripTimestamp()                        1790323669
  AUSD.balanceOf(faucet)                     1
    = 0.000001 AUSD
  faucet can pay a drip (balance > drip)?    false
  last drip                                  2026-09-25T08:07:49.000Z (28.5 h ago)
  next drip allowed by the rate limit in     0s (global rate limit shared by every caller)
  eth_call requestFunds(fresh address) now   revert InsufficientFunds()
  faucet history (eth_call at past blocks):
    ~ 1 d ago  block 65576637  2026-09-25T12:51:14.000Z  balance 0.000001 AUSD  lastDrip 2026-09-25T08:07:49.000Z
    ~ 2 d ago  block 65300219  2026-09-24T12:53:10.000Z  balance 10000.0 AUSD  lastDrip 2026-09-23T21:52:01.000Z
    ~ 3 d ago  block 65023801  2026-09-23T13:13:53.000Z  balance 40000.0 AUSD  lastDrip 2026-09-23T11:36:20.000Z
    ~ 5 d ago  block 64470965  2026-09-21T14:26:44.000Z  balance 200000.0 AUSD  lastDrip 2026-09-20T15:46:26.000Z
    ~ 7 d ago  block 63918129  2026-09-19T15:28:02.000Z  balance 280000.0 AUSD  lastDrip 2026-09-18T14:22:43.000Z
    ~10 d ago  block 63088875  2026-09-16T17:30:28.000Z  balance 330000.0 AUSD  lastDrip 2026-09-16T06:33:18.000Z
    ~14 d ago  block 61983203  2026-09-12T19:32:25.000Z  balance 640000.0 AUSD  lastDrip 2026-09-12T12:57:20.000Z

== Circle USDC 0x534b2f3A21130d7a60830c2Df862319e593943A3
  code bytes                                 1798
  slot eip1967Implementation                 0 (empty)
  slot eip1967Admin                          0 (empty)
  slot eip1967Beacon                         0 (empty)
  slot zosImplementation                     0x00000000000000000000000021240161521d6854be79f7d3a0a65c6beddb42fb
  slot zosAdmin                              0x000000000000000000000000667b894bcc6899f5df1eba73c006b94c661a2d95
  implementation                             0x21240161521D6854BE79F7D3a0A65c6BeDDB42fb (23464 bytes, keccak 0x634d53fa0836dac5...)
  name()                                     USDC
  symbol()                                   USDC
  decimals()                                 6
  totalSupply()                              9227582743321966
  DOMAIN_SEPARATOR()                         0xf1090f5a61ddee19528cecc447be0f91c7205fc2b34dd271fc0de87809a0a48d
  PERMIT_TYPEHASH()                          0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH()     0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH()      0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8
  CANCEL_AUTHORIZATION_TYPEHASH()            0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429
  paused()                                   false
  currency()                                 USD
  version() as string                        2
  eip712Domain() (ERC-5267)                  n/a (error: execution reverted (no data present; likely require(false) occurred)
  EIP-712 domain recomputation (chainId from eth_chainId, verifyingContract = token):
    name() + version()   name="USDC" version="2" -> 0xf1090f5a61ddee19528cecc447be0f91c7205fc2b34dd271fc0de87809a0a48d MATCHES DOMAIN_SEPARATOR()
    guess                name="USDC" version="2" -> 0xf1090f5a61ddee19528cecc447be0f91c7205fc2b34dd271fc0de87809a0a48d MATCHES DOMAIN_SEPARATOR()
    guess                name="USD Coin" version="2" -> 0xb75d48095fa540edbaff613ca8b0c020523b0cc9f4f1450d35bb4e926d9ed0ed no match
  Selectors present as PUSH immediates (opcode walk):
  function                                                                                                proxy     impl      
  0xd505accf permit(address,address,uint256,uint256,uint8,bytes32,bytes32)                                -         yes       
  0x9fd5a6cf permit(address,address,uint256,uint256,bytes)                                                -         yes       
  0x7ecebe00 nonces(address)                                                                              -         yes       
  0x3644e515 DOMAIN_SEPARATOR()                                                                           -         yes       
  0x84b0196e eip712Domain()                                                                               -         -         
  0xe3ee160e transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)-         yes       
  0xcf092995 transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)             -         yes       
  0xef55bec6 receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)-         yes       
  0x88b7ab63 receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)              -         yes       
  0x5a049a70 cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)                                   -         yes       
  0xb7b72899 cancelAuthorization(address,bytes32,bytes)                                                   -         yes       
  0xe94a0102 authorizationState(address,bytes32)                                                          -         yes       
  Typehash constants present as PUSH32 immediates:
  EIP712Domain(name,version,chainId,verifyingContract) 0x8b73c3c69bb8fe3d...                              -         yes       
  Permit 0x6e71edae12b1b97f...                                                                            -         yes       
  TransferWithAuthorization 0x7c7c6cdb67a18743...                                                         -         yes       
  ReceiveWithAuthorization 0xd099cc98ef71107a...                                                          -         yes       
  CancelAuthorization 0x158b0a9edf7a828a...                                                               -         yes       

== Circle USDC: signature checks by eth_call (throwaway key, value 0, nothing sent)
  receiveWithAuthorization (v,r,s), msg.sender == to        OK, eth_estimateGas 141617
  receiveWithAuthorization (bytes r||s||v), same auth       OK
  receiveWithAuthorization submitted by a stranger          revert Error(FiatTokenV2: caller must be the payee)
  receiveWithAuthorization (v,r,s) called by a contract     OK
  receiveWithAuthorization signed with {"version":"1"} revert Error(FiatTokenV2: invalid signature)
  receiveWithAuthorization with a Transfer-typed signature  revert Error(FiatTokenV2: invalid signature)
  transferWithAuthorization (v,r,s), relayed by anyone      OK, eth_estimateGas 141634
  permit (v,r,s), relayed by anyone                         OK, eth_estimateGas 148806
  authorizationState(random, 0x0)            false

== Infrastructure contracts
  Multicall3                               0xcA11bde05977b3631167028862bE2a173976CA11 code bytes 3808
  Permit2                                  0x000000000022d473030f116ddee9f6b43ac78ba3 code bytes 9152
  CRE MockKeystoneForwarder (simulate)     0xB9F79d863261869B234c481D1f9A7af84AeAd192 code bytes 4579
  CRE KeystoneForwarder (deployed)         0xF8344CFd5c43616a4366C34E3EEE75af79a74482 code bytes 8591
  Multicall3.getChainId()                    10143
  Multicall3.getBlockNumber()                65853089
  Permit2.DOMAIN_SEPARATOR()                 0xa0647e1feb1b2082348038c21a15be6aea95d32da1dea93a14a78edf69f9ea03
  Permit2 expected (name "Permit2", no version) 0xa0647e1feb1b2082348038c21a15be6aea95d32da1dea93a14a78edf69f9ea03 MATCH
  MockKeystoneForwarder.typeAndVersion()     MockKeystoneForwarder 1.0.0
  KeystoneForwarder.typeAndVersion()         KeystoneForwarder 1.0.0

== Gas
  eth_gasPrice                               102000000000 wei (102.0 gwei)
  eth_maxPriorityFeePerGas                   2000000000 wei (2.0 gwei)
  latest baseFeePerGas                       100000000000 wei (100.0 gwei)
  Monad charges gas_limit * price (https://docs.monad.xyz/developer-essentials/gas-pricing)
  150,000 gas limit x eth_gasPrice           0.0153 MON
  150,000 gas limit x (baseFee + tip)        0.0153 MON
  150,000 gas limit x 100 gwei floor         0.015 MON
  AUSD receiveWithAuthorization (value 0)    est 90245, limit at +15% 103781 -> 0.010585662 MON
  AUSD receiveWithAuthorization 200 AUSD, fresh payee est 112983, limit at +15% 129930 -> 0.01325286 MON
  AUSD permit                                est 111340, limit at +15% 128041 -> 0.013060182 MON
  USDC receiveWithAuthorization (value 0)    est 141617, limit at +15% 162859 -> 0.016611618 MON

== Summary
  AUSD EIP-712 domain: {"name":"Agora Dollar","version":"1","chainId":"10143","verifyingContract":"0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"}
  AUSD receiveWithAuthorization(v,r,s) by the payee: works
  AUSD receiveWithAuthorization(v,r,s) by a contract payee: works
  USDC EIP-712 domain: {"name":"USDC","version":"2","chainId":"10143","verifyingContract":"0x534b2f3A21130d7a60830c2Df862319e593943A3"}
  USDC receiveWithAuthorization(v,r,s) by the payee: works
```

An earlier run the same morning (09:40 UTC, block 65,819,025) gave the same
results. Only the gas estimates differed, by at most 57 gas, and the addresses
were different because each run generates fresh random keys.

---

## 4. AUSD in detail

### 4.1 Layout: which code actually runs

- **The proxy** `0xa901…22dC` is `AgoraDollarErc1967Proxy`, verified on
  Monadscan (solc 0.8.21).
  - **It is not a plain proxy.** It implements `transfer`, `transferFrom`,
    both `transferWithAuthorization` and both `receiveWithAuthorization`
    **itself**, "for gas savings", and delegates everything else.
  - That's why those four selectors appear in the proxy's bytecode as well as
    the implementation's. The implementation only holds stubs "to check for
    signature collisions" (`AgoraDollarCore.sol`).
- **The implementation** `0xc1e3…12dA` is `AgoraDollar` v2.1.0, verified on
  Monadscan (solc 0.8.28). It serves `permit`, `nonces`, `DOMAIN_SEPARATOR`,
  `eip712Domain`, `cancelAuthorization`, `authorizationState` and the views.
- **The EIP-1967 admin** is `0x2fFb…d169`, an `AgoraProxyAdmin`. `AgoraDollar`
  exposes it as `proxyAdminAddress()`. **The token is upgradeable by Agora.**
- **Agora packs 11 flags into the high 96 bits of the EIP-1967 implementation
  slot** (`StorageLib.sol`, `IS_*_BIT_POSITION_ = 1 << (255 - 85…95)`). All are
  zero, so:
  - nothing is paused
  - the msg.sender frozen check is off
  - `isReceiveWithAuthorizationUpgraded` is false, so the proxy runs its
    built-in `_receiveWithAuthorization`
- **Same layout on Monad mainnet.** I made a one-off check against
  `rpc.monad.xyz` (`eth_chainId` 0x8f = 143) at
  `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`. It returned the same
  implementation address `0xc1e3…12dA` and the same `version() (2,1,0)`, with
  nothing paused. Its `eip712Domain()` is `"Agora Dollar"`, `"1"`, chain 143,
  and `DOMAIN_SEPARATOR` is
  `0x995063441ebf2219c94dce05014a545da4390d2362f99b3d7ad456046678cafe`, which
  matches a local recomputation.

### 4.2 The EIP-712 domain the app must use

| Source | name | version |
|---|---|---|
| `eip712Domain()` on the token (ERC-5267, `fields = 0x0f`: name, version, chainId, verifyingContract) | `Agora Dollar` | `1` |
| Proxy constructor args, Monadscan verified source ("Decoded View") | `Agora Dollar` | `1` |
| Agora deploy script `src/script/deploy/deployAgoraDollarContracts.s.sol` (proxy and implementation) | `Agora Dollar` | `1` |
| Recomputed `keccak256(abi.encode(EIP712Domain typehash, keccak("Agora Dollar"), keccak("1"), 10143, token))` | = `0x7ff7d6b4…07f03ea1` = `DOMAIN_SEPARATOR()` = `domainSeparatorV4()` | |
| `name()` | `AUSD` ← **not** the EIP-712 name | |
| `version()` | `(2, 1, 0)` struct ← **not** the EIP-712 version | |

- **Two Eip712 contracts share this domain.** The proxy has its own `Eip712`
  immutables, which it uses for 3009. The implementation has its own too,
  which it uses for permit and cancel. Both were constructed with
  `"Agora Dollar"`/`"1"` and the proxy address as `verifyingContract`, so they
  produce the same separator. The live checks prove it for both paths:
  `receiveWithAuthorization` runs in the proxy, and `permit` runs in the
  implementation.
- **The domain can change.** An Agora upgrade could change the implementation's
  immutables, which would move permit's domain but not 3009's. Assert on
  startup (§9.3) instead of trusting a constant forever.

### 4.3 Semantics that matter to our contracts

All of this is from source (`Eip3009.sol`, `AgoraDollarErc1967Proxy.sol`,
`Erc2612.sol`, `Erc20Core.sol` @ `ed241d5`). The deployed proxy's source on
Monadscan has the same `_receiveWithAuthorization` body.

- **`receiveWithAuthorization`:**
  - `if (_to != msg.sender) revert InvalidPayee(caller, payee)`, so the
    **payee must be the calling contract.** A relayer can't call it on our
    behalf, and nobody can front-run it.
  - `if (block.timestamp <= _validAfter) revert InvalidAuthorization()`. This
    is strict, so pass `validAfter = 0`.
  - `if (block.timestamp >= _validBefore) revert ExpiredAuthorization()`. This
    is strict too.
  - `isAuthorizationUsed[from][nonce]` reverts with
    `UsedOrCanceledAuthorization()`.
  - It also reverts `TransferPaused` or `SignatureVerificationPaused` if those
    flags are set.
- **Nonces are random 32-byte values per authorizer**, and one namespace is
  shared by transfer, receive and cancel. Any value we derive, for example
  `keccak256(merchant, orderId)`, is fine.
- **How the signature is checked:**
  - It uses Solady `SignatureCheckerLib.isValidSignatureNow`: ECDSA for EOAs,
    **ERC-1271 for contract wallets**.
  - The `(v, r, s)` overloads pack `abi.encodePacked(r, s, v)` and call the
    `bytes` overload.
  - viem's 65-byte `signTypedData` output (`r || s || v`) can be passed
    straight to the `bytes` overload. Both were checked live.
- **`value` is cast `toUint248()`.** Anything ≥ 2^248 reverts. That's
  irrelevant at 6 decimals.
- **`_transfer` reverts `AccountIsFrozen(from)` if the payer is frozen**, and
  `ERC20InsufficientBalance(sender, balance, needed)` if the payer is short.
- **Permit:**
  - `permit` reverts only on `SignatureVerificationPaused`, not on
    `TransferPaused`.
  - It reverts `Erc2612ExpiredSignature(deadline)` if
    `block.timestamp > deadline`. Note that's `>`, so the deadline itself is
    still valid.
  - It uses and increments `nonces[owner]` sequentially.
  - It reverts `Erc2612InvalidSignature()` if the signature is wrong.
  - **`_approve` overwrites the allowance** (`accountAllowances[o][s] = v`). It
    does not add to it.
- **Events:**
  - `AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)`
    and `AuthorizationCanceled(...)` come from the proxy.
  - The standard `Transfer` and `Approval` events are also emitted.

### 4.4 Signature behaviour, observed live (summary of §3)

| Call (value 0, throwaway key) | AUSD | USDC |
|---|---|---|
| `receiveWithAuthorization(v,r,s)` by payee EOA | OK, est 90,245 | OK, est 141,617 |
| same, `bytes` overload | OK | OK |
| same authorization submitted by a stranger | `InvalidPayee(caller, payee)` | `FiatTokenV2: caller must be the payee` |
| `receiveWithAuthorization(v,r,s)` with a **contract** as `msg.sender == to` | OK | OK |
| signed with the wrong domain version | `InvalidSignature()` | `FiatTokenV2: invalid signature` |
| a `TransferWithAuthorization` signature sent to `receiveWithAuthorization` | `InvalidSignature()` | `FiatTokenV2: invalid signature` |
| `transferWithAuthorization(v,r,s)` relayed by anyone | OK, est 90,220 | OK, est 141,634 |
| `permit(v,r,s)` relayed by anyone | OK, est 111,340 | OK, est 148,806 |
| `receiveWithAuthorization` moving **200 AUSD** to a fresh payee (state-override balance) | est 112,983 | n/a |

The viem snippets in §9 were also run live with `viem@2.56.9`.
`receiveWithAuthorization` succeeded through both overloads, `permit` succeeded
with the salt-less domain and failed with `Erc2612InvalidSignature` with the
raw `getEip712Domain` domain, and the faucet call gave `InsufficientFunds`.

---

## 5. The AUSD faucet: how a user gets testnet AUSD

### 5.1 What it is

`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` is an EIP-1967 proxy
(`AgoraTransparentUpgradeableProxy`, verified on Monadscan). Its
implementation `0xba804DF5c476E8EaeF87BF8085F295300ccE2a49` is the verified
`AgoraFaucet`, with `version()` returning `(1,0,0)`. The ABI below comes from
Monadscan, and the selector scan in §3 confirms every function:

```text
requestFunds(address _receiver)
token() -> address                       // 0xa9012a05…22dC (AUSD)
faucetDripAmount() -> uint256            // 10,000 AUSD (1e10 base units)
maxAmountToOwn() -> uint256              // 100,000 AUSD
maxDripFrequency() -> uint256            // 60 s, GLOBAL (one drip per minute for everyone)
lastDripTimestamp() -> uint256
AGORA_FAUCET_STORAGE_SLOT() -> bytes32
initialize((address tokenToDistribute,uint256 faucetDripAmount,uint256 maxAmountToOwn,uint256 maxDripFrequency))
version() -> (uint256 major,uint256 minor,uint256 patch)
errors: InsufficientFunds() MaxAllowedExceeded() MaxFrequencyExceeded() SafeERC20FailedOperation(address)
event FundsRequested(address indexed receiver, uint256 amount)
```

The logic is from the verified source on Monadscan (implementation page,
"Contract Source Code"):

```solidity
function requestFunds(address _receiver) external {
    FaucetStorage memory _config = _getPointerToStorage();

    if (block.timestamp - _config.lastDripTimestamp < _config.maxDripFrequency) {
        revert MaxFrequencyExceeded();
    }
    if (IERC20(_config.tokenToDistribute).balanceOf(address(this)) <= _config.faucetDripAmount)
        revert InsufficientFunds();
    if (IERC20(_config.tokenToDistribute).balanceOf(_receiver) >= _config.maxAmountToOwn) {
        revert MaxAllowedExceeded();
    }

    _updateLastDripTime(block.timestamp);

    IERC20(_config.tokenToDistribute).safeTransfer({ to: _receiver, value: _config.faucetDripAmount });
    emit FundsRequested(_receiver, _config.faucetDripAmount);
}
```

It pays the **`_receiver` argument**, not `msg.sender`, so the relayer can
claim for any address. The faucet has **no deposit or refill function and no
owner withdraw**. It hands out whatever AUSD was transferred to it.

### 5.2 State today: dry

- The balance is **0.000001 AUSD** (1 base unit). Because the check is
  `balance <= drip`, `requestFunds` reverts `InsufficientFunds()` for everyone.
- The last drip was 2026-09-25 08:07:49 UTC.
- History from `eth_call` at past blocks:
  - 640,000 AUSD on 12 Sep
  - 330,000 on 16 Sep
  - 280,000 on 19 Sep
  - 200,000 on 21 Sep
  - 40,000 on 23 Sep
  - 10,000 on 24 Sep
  - 0.000001 on 25 Sep
- That's about 64 drips of 10,000 in 13 days, and the balance never rose
  between samples.
  **Nobody is refilling it.**
- An inference, not verified: at exactly 10,000 AUSD the `<=` check already
  blocks, so someone probably sent 1 base unit to unlock the last drip.
- Activity is low overall: an `eth_getLogs` scan of the last 20,000 blocks
  (about 1.7 h) found 2 AUSD transfers in total.
- Minting: `getMinterRoleMembers()` is `[0x99B0E95Fa8F5C3b86e4d78ED715B475cFCcf6E97]`,
  an EOA holding 0 AUSD. The same address deployed the implementation and
  the faucet, and it owns the proxy admin. It's Agora's.
  `getBridgeMinterRoleMembers()` is empty.

### 5.3 How a user gets testnet AUSD

1. **When the faucet is funded,** anyone with a little MON for gas calls
   `requestFunds(receiver)` and gets 10,000 AUSD.
   - The rate limit is one drip per minute **globally**, so expect contention
     during the hackathon.
   - The receiver must hold under 100,000 AUSD.
   - Agora's own docs call it like this (Sepolia example, same contract;
     https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens):

     ```tsx
       const { request } = await client.simulateContract({
         address: AUSD_FAUCET,
         abi: ausdFaucetAbi,
         functionName: "requestFunds",
         args: [callerAddress],
       });
       let txHash = await client.writeContract(request);
     ```
   - Agora's docs list this exact faucet address for Monad Testnet
     (https://docs.agora.finance/developer/contract-deployments). The
     getting-testnet-tokens page only shows Sepolia.
2. **Right now it's empty**, so the only paths are:
   - (a) Agora refills the faucet with a plain `transfer(faucet, amount)`;
   - (b) Agora, or anyone holding AUSD, sends to our treasury;
   - (c) Agora mints to us.

   **Ask in the Agora sponsor channel on Day 0.** For comparison, the Circle
   faucet (§6) lists Monad Testnet.
3. **For end users in the demo, the faucet is not the path.** A demo buyer
   gets AUSD from our treasury, by a send-by-link or a relayed
   `transferWithAuthorization` from the treasury. So we need one lump sum,
   not a faucet per user.

---

## 6. Circle USDC on testnet (`0x534b2f3A21130d7a60830c2Df862319e593943A3`)

- **Proxy type.** It's a Circle `FiatTokenProxy` (a ZeppelinOS
  `AdminUpgradeabilityProxy`): the implementation and admin live in the
  ZeppelinOS slots, and the EIP-1967 slots are empty. The implementation is
  `0x2124…42fb`, 23,464 bytes. The proxy isn't verified on Monadscan.
- **Domain.** `name()` is `"USDC"`, `version()` is `"2"`, and the domain
  separator matches `("USDC", "2", 10143, token)`. `FiatTokenV2_2` builds it
  with `EIP712.makeDomainSeparator(name, "2", _chainId())`
  (https://github.com/circlefin/stablecoin-evm/blob/fc85788bc7c23cefe3df1a757133048bfddadeaa/contracts/v2/FiatTokenV2_2.sol).
  **There's no `eip712Domain()`**, so read `name()` and `version()` instead.
- **Behaviour.** 3009 and 2612 behave like AUSD (§4.4) but cost about 50k
  more gas per call. Errors are revert strings, not custom errors.
- **Funding.** faucet.circle.com lists "Monad Testnet". It's a web form that
  a person fills in; we don't script it. Circle's address page lists
  `0x534b…43A3` for Monad Testnet
  (https://developers.circle.com/stablecoins/usdc-contract-addresses).

---

## 7. Infrastructure contracts on testnet

| Contract | Address | Result |
|---|---|---|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | present (3,808 bytes); `getChainId()` = 10143. viem's `monadTestnet` chain already lists it as `contracts.multicall3` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` | present (9,152 bytes); `DOMAIN_SEPARATOR` matches `EIP712Domain(string name,uint256 chainId,address verifyingContract)` with name `"Permit2"` (https://github.com/Uniswap/permit2/blob/main/src/EIP712.sol) |
| CRE MockKeystoneForwarder (`cre workflow simulate`) | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` | present (4,579 bytes); `typeAndVersion()` = `MockKeystoneForwarder 1.0.0` |
| CRE KeystoneForwarder (deployed workflows) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | present (8,591 bytes); `typeAndVersion()` = `KeystoneForwarder 1.0.0` |

Both forwarder addresses, and the mainnet pair in plan Appendix A, match the
Chainlink forwarder directory
(https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts).
Appendix A's "check on testnet" for Permit2 and Multicall3 can be replaced with
the canonical addresses.

---

## 8. Gas

- **What we're charged for.** Monad charges `gas_limit × price_per_gas`, where
  `price_per_gas = min(base + priority, maxFee)`. The minimum base fee is
  100 MON-gwei (https://docs.monad.xyz/developer-essentials/gas-pricing).
- **Live values:**
  - `eth_gasPrice` 102 gwei
  - `eth_maxPriorityFeePerGas` 2 gwei
  - `baseFeePerGas` 100 gwei (at the floor)
  - block gas limit 150M
- **What that costs:**

| Transaction | Gas limit | MON at 102 gwei |
|---|---|---|
| Any tx with a **150,000** limit | 150,000 | **0.0153** (0.015 at the 100-gwei floor) |
| AUSD `receiveWithAuthorization`, 200 AUSD to a fresh payee (est 112,983 +15%) | 129,930 | 0.01325 |
| AUSD `permit` (est 111,340 +15%) | 128,041 | 0.01306 |
| AUSD `transferWithAuthorization` (value 0, est 90,220 +15%) | 103,753 | 0.01058 |
| USDC `receiveWithAuthorization` (value 0, est 141,617 +15%) | 162,859 | 0.01661 |

- **Budget.** At about 0.0153 MON per 150k-limit call, **1 MON pays for
  about 65 relayed calls.**
- **These are token calls only.** `PolarisPayments.payWithAuthorization` adds
  its own storage writes and two more token transfers (net to the merchant,
  fee to the treasury). Estimate it after deployment: **UNVERIFIED**.

---

## 9. Code snippets (copy-paste)

### 9.1 Solidity: the AUSD surface our contracts call

Signatures are from `AgoraDollarErc1967Proxy.sol` (3009) and `Erc2612.sol` and
`AgoraDollar.sol` (2612 and views):

- https://github.com/agora-finance/agora-dollar-evm/blob/ed241d569c746f1fb5f6932f3fd11ebd84235c66/src/contracts/proxy/AgoraDollarErc1967Proxy.sol
- https://github.com/agora-finance/agora-dollar-evm/blob/ed241d569c746f1fb5f6932f3fd11ebd84235c66/src/contracts/Erc2612.sol
- https://github.com/agora-finance/agora-dollar-evm/blob/ed241d569c746f1fb5f6932f3fd11ebd84235c66/src/contracts/AgoraDollar.sol

Our existing `packages/contracts/contracts/interfaces/IERC3009.sol` already
matches the `(v, r, s)` selectors. Its `receiveWithAuthorization` is
`0xef55bec6`, which is present on the live token.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Subset of AgoraDollar (AUSD v2.1.0) that Polaris calls. Also matches Circle FiatTokenV2_2.
interface IAUSD {
    // ERC-3009 (implemented in the AUSD proxy itself)
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore,
        bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore,
        bytes32 nonce, bytes memory signature // r || s || v, or an ERC-1271 signature
    ) external;
    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore,
        bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    // ERC-2612
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
```

AUSD custom errors, for decoding reverts in tests, the relayer and the
dunning logic. They come from `Eip3009.sol`, `Erc2612.sol`, `StorageLib.sol`
and OpenZeppelin `IERC20Errors`, and the script decodes them:

```solidity
error InvalidPayee(address caller, address payee);
error InvalidAuthorization();          // block.timestamp <= validAfter
error ExpiredAuthorization();          // block.timestamp >= validBefore
error InvalidSignature();
error UsedOrCanceledAuthorization();
error Erc2612ExpiredSignature(uint256 deadline);
error Erc2612InvalidSignature();
error AccountIsFrozen(address frozenAccount);
error TransferPaused();
error SignatureVerificationPaused();
error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
```

### 9.2 Solidity: the call site in `PolarisPayments.payWithAuthorization` (plan §5.2 item 2)

This is our code, built on the AUSD signature above. It isn't from Agora's
docs. The one AUSD-imposed rule is **`to` must be `address(this)`**. The nonce
is the existing `paymentId`, so the AUSD nonce, the `DuplicatePayment` key and
the indexer id are one value.

```solidity
function payWithAuthorization(
    address buyer, address merchant, uint256 amount, string calldata orderId,
    uint256 validBefore, uint8 v, bytes32 r, bytes32 s
) external nonReentrant returns (bytes32 paymentId) {
    paymentId = keccak256(abi.encodePacked(merchant, orderId)); // same as pay()
    if (payments[paymentId].paidAt != 0) revert DuplicatePayment();
    // The buyer signed nonce = paymentId, so a relayer that changes merchant/orderId
    // changes the nonce and AUSD reverts InvalidSignature().
    IERC3009(address(stablecoin)).receiveWithAuthorization(
        buyer, address(this), amount, 0, validBefore, paymentId, v, r, s
    );
    // ... then transfer net to merchant and fee to treasury, record, emit (as in pay())
}
```

### 9.3 viem: read and pin the domain (strip `salt`)

Sources:

- https://viem.sh/docs/actions/public/getEip712Domain. It's a client method.
  In `viem@2.56.9` the standalone function is exported from `viem/actions`,
  not from `viem`, despite the JSDoc example, and I got an import error trying
  `viem`.
- https://viem.sh/docs/accounts/local/signTypedData

```ts
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";

const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as const;
const client = createPublicClient({ chain: monadTestnet, transport: http() });

// Pinned, verified 26 Sep 2026 (eip712Domain(), Monadscan constructor args, DOMAIN_SEPARATOR recomputation)
export const AUSD_DOMAIN = { name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD } as const;

// Startup assertion. getEip712Domain returns salt: 0x00…00; the token's fields byte is 0x0f
// (no salt). Passing salt through to signTypedData yields Erc2612InvalidSignature.
const { domain } = await client.getEip712Domain({ address: AUSD });
const { salt: _unused, ...live } = domain;
if (live.name !== AUSD_DOMAIN.name || live.version !== AUSD_DOMAIN.version || live.chainId !== AUSD_DOMAIN.chainId) {
  throw new Error(`AUSD EIP-712 domain changed: ${JSON.stringify(live)}`);
}
```

### 9.4 viem: buyer signs `ReceiveWithAuthorization` (Pay now, Send)

Sources: https://viem.sh/docs/accounts/local/signTypedData ·
https://viem.sh/docs/utilities/parseSignature · https://eips.ethereum.org/EIPS/eip-3009

`account` is Mera's `toViemAccount(session)`, which is byte-identical to a
viem local account (`docs/research/mera.md` §9). I ran this against the live
token with `privateKeyToAccount`, and `simulateContract` succeeded for both
overloads.

```ts
import { encodePacked, keccak256, parseSignature, type Address, type Hex } from "viem";

// Same value as Solidity keccak256(abi.encodePacked(merchant, orderId)) (checked against ethers solidityPackedKeccak256)
const nonce: Hex = keccak256(encodePacked(["address", "string"], [merchant, orderId]));

const signature = await account.signTypedData({
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
    from: account.address,
    to: POLARIS_PAYMENTS,            // MUST be the contract that will call AUSD
    value: 200_000_000n,             // 200.00 AUSD (6 decimals)
    validAfter: 0n,                  // AUSD checks block.timestamp > validAfter
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    nonce,
  },
});
const { v, r, s } = parseSignature(signature); // v is 27n or 28n; pass Number(v) as uint8
```

### 9.5 viem: buyer signs `Permit` (Pay in 4, Subscribe)

Sources: https://viem.sh/docs/accounts/local/signTypedData · https://eips.ethereum.org/EIPS/eip-2612 ·
`Erc2612.sol` (link in §9.1). I checked this live: `permit` succeeded with this
domain.

```ts
import { parseAbi, parseSignature } from "viem";

const erc2612Abi = parseAbi([
  "function nonces(address owner) view returns (uint256)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);
const nonce = await client.readContract({ address: AUSD, abi: erc2612Abi, functionName: "nonces", args: [account.address] });
const sig = await account.signTypedData({
  domain: AUSD_DOMAIN,
  types: {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  message: { owner: account.address, spender: LOAN_ENGINE, value: totalAllowance, nonce, deadline },
});
const { v, r, s } = parseSignature(sig);
```

### 9.6 viem: the relayer submits (simulate, then write)

Sources: https://viem.sh/docs/contract/simulateContract ·
https://viem.sh/docs/contract/writeContract

- For merchant payouts, which use `TransferWithAuthorization` signed by the
  merchant's Privy wallet, the relayer calls AUSD directly.
- For our contracts, the relayer calls the Polaris contract.
- **Always set `gas` from the estimate plus 15%.** Monad charges the limit.
- I ran the simulate and estimate steps live, from an unfunded relayer key
  with a value-0 authorization. The estimate came back at 90,220, so the limit
  is 103,753. The write step wasn't run, because nothing is sent.

For payouts, the owner signs the same six fields as §9.4, but under the type
name `TransferWithAuthorization` with `primaryType: "TransferWithAuthorization"`.

```ts
const { request } = await publicClient.simulateContract({
  account: relayer,
  address: AUSD,
  abi: parseAbi([
    "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  ]),
  functionName: "transferWithAuthorization",
  args: [from, to, value, 0n, validBefore, nonce, Number(v), r, s],
});
const gas = await publicClient.estimateContractGas(request);
const hash = await walletClient.writeContract({ ...request, gas: (gas * 115n) / 100n });
```

### 9.7 ethers v6 (what `check-monad.js` uses)

Sources: https://docs.ethers.org/v6/api/wallet/ (`signTypedData`) ·
https://docs.ethers.org/v6/api/crypto/#Signature

```js
const domain = { name: "Agora Dollar", version: "1", chainId: 10143n, verifyingContract: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" };
const sig = ethers.Signature.from(await wallet.signTypedData(domain, { ReceiveWithAuthorization: [/* as §9.4 */] }, message));
// sig.v (27/28), sig.r, sig.s for the (v,r,s) overload; sig.serialized (r||s||v, 65 bytes) for the bytes overload
ethers.TypedDataEncoder.hashDomain(domain) === "0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1";
```

---

## 10. UNVERIFIED

- **Whether and when Agora will refill the Monad testnet faucet**, or send
  AUSD directly. Nobody has refilled it since at least 12 Sep.
- **Any other source of testnet AUSD**, such as a DEX pool on Monad testnet.
  I found no evidence either way: only 2 AUSD transfers in the last ~1.7 h.
- **The gas for `PolarisPayments.payWithAuthorization`, `PolarisSend.send` and
  `PolarisCheckout.openPlan` end to end.** I only measured the AUSD calls.
- **Whether Agora will upgrade AUSD on testnet during the hackathon.** The
  flags and the proxy admin allow it. The startup assertion in §9.3 catches a
  domain change.
- **Hardhat forking of Monad testnet** for integration tests. Not tried. The
  public RPC serves historical `eth_call` at least 14 days back, and
  `eth_getLogs` is limited to 100 blocks (1,000 gave HTTP 413).
- **Finality in 800 ms (plan §2).** Not measured here. Block time was.

---

## 11. What Polaris should do (mapped to `docs/plan.md`)

1. **§11 Day 0, "Script-check testnet AUSD": done.** Re-run
   `node scripts/check-monad.js` before each deploy and before recording. It
   costs nothing and catches upgrades, pauses and domain changes.
2. **§11 Day 0 and §3.1: ask Agora for AUSD today.** It's the only blocker.
   - Ask for a faucet refill, or a direct grant to the treasury (and to each
     team member's test account).
   - Size it: a BNPL pool, demo balances and a few rehearsals. **Ask for
     50,000–100,000 AUSD.**
   - Until it arrives, test on USDC (faucet.circle.com) or `MockAUSD`. Keep
     the stablecoin a constructor parameter, as `PolarisPayments.stablecoin`
     already is.
3. **§5.3 and §5.6: sign with `{ name: "Agora Dollar", version: "1", chainId, verifyingContract }`.**
   - Pin it as a constant and assert it at startup (§9.3).
   - Never derive the domain from `name()`/`version()`.
   - Never pass viem's `getEip712Domain` output straight through: strip
     `salt`.
   - **Fix the placeholder in `docs/research/mera.md` §8** (`name: "AUSD"` →
     `"Agora Dollar"`) before anyone copies it.
4. **§5.2 item 2, `payWithAuthorization`: the design works on the live token.**
   - Use `receiveWithAuthorization(v,r,s)` with `to = address(this)`,
     `validAfter = 0`, and `nonce = paymentId = keccak256(abi.encodePacked(merchant, orderId))`
     (§9.2 and §9.4).
   - The buyer's signature then commits to the merchant and order, and AUSD's
     `InvalidPayee` stops anyone but our contract from submitting it.
5. **§5.2 item 4, `PolarisSend.send`: bind the claim key into the 3009 nonce.**
   - The sender's authorization has `to = PolarisSend`. If the nonce were
     free-form, a relayer could call `send` with the sender's signature and
     **its own** claim address.
   - Derive `nonce = keccak256(abi.encode(claimSigner, expiry))` inside
     `send`, and have the app sign that value.
6. **§5.2 item 3, `PolarisCheckout`: three permit rules come from AUSD's
   source.**
   - (a) **`permit` overwrites the allowance.** A second plan's permit must be
     sized to *all* outstanding obligations to that spender, not just the new
     plan, or it shrinks the allowance backing the first plan.
   - (b) **Nonces are sequential.** Read `nonces(owner)` immediately before
     signing, and never have two permit signatures outstanding for one buyer.
   - (c) **Anyone can submit a permit.** Wrap it
     `try token.permit(...) {} catch {}` and then check the allowance. That's
     OpenZeppelin's recommended pattern (`IERC20Permit.sol` NatSpec,
     `@openzeppelin/contracts` 5.6.1).
7. **§5.3, the relayer policy (Privy): allow one overload per function.**
   - Payouts: allow only AUSD `transferWithAuthorization(v,r,s)` (`0xe3ee160e`)
     with `to == AUSD` and `value == 0`.
   - Our contracts: allow their entry points only.
   - Never allow `permit` on AUSD directly unless a flow needs it.
8. **§5.3, gas: keep "estimate + 15%".** At today's 102 gwei, a 150k limit is
   0.0153 MON, so fund the relayer with **≥ 10 MON** (about 650 calls) and
   alert under 2 MON. The CRE collector's batched report needs its own
   estimate.
9. **§5.2 item 10, tests: make `MockAUSD` match AUSD's behaviour.**
   - Construct its EIP-712 domain as `ERC20Permit("Agora Dollar")` (version
     `"1"`) so the client signing code is identical everywhere except
     `chainId` and `verifyingContract`.
   - Don't assert mock-only error names (`CallerMustBePayee`,
     `InvalidAuthorizationSignature`) in tests meant to hold on testnet. AUSD
     reverts `InvalidPayee(address,address)` and `InvalidSignature()`.
10. **Appendix A: update it.**
    - Multicall3 and Permit2 are at their canonical addresses on testnet
      (verified), and both CRE forwarders answer `typeAndVersion()`.
    - Add the AUSD implementation `0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA`
      (the same on testnet and mainnet) and the proxy admin
      `0x2fFb5584C3C8AD18B3fc8872B91AA49a2aC8d169`.
11. **§2, pitch numbers:** say "blocks every ~0.3 s" (measured 312.6 ms on
    testnet; Monad's JSON-RPC docs say 300 ms), not 400 ms.
12. **§12 Q4, mainnet (optional):** the mainnet AUSD
    (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) has the same domain name and
    version and the same v2.1.0 implementation. The same code works with
    `chainId: 143` and that address.

---

## Sources

- **Live chain:** `https://testnet-rpc.monad.xyz` (chain 10143), and one
  mainnet read on `https://rpc.monad.xyz` (143). The script is
  `packages/contracts/scripts/check-monad.js`.
- **Agora:**
  - deployments (lists the Monad Testnet AUSD and faucet):
    https://docs.agora.finance/developer/contract-deployments
  - testnet faucet guide:
    https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens
  - ERC features: https://docs.agora.finance/developer/advanced-erc-features
  - source: https://github.com/agora-finance/agora-dollar-evm @ `ed241d569c746f1fb5f6932f3fd11ebd84235c66`.
    Files: `src/contracts/{AgoraDollar,AgoraDollarCore,Eip3009,Eip712,Erc2612,Erc20Core}.sol`,
    `src/contracts/proxy/{AgoraDollarErc1967Proxy,StorageLib}.sol`,
    `src/script/deploy/deployAgoraDollarContracts.s.sol`
- **Monadscan verified contracts:**
  - AUSD proxy: https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC#code
  - AUSD implementation: https://testnet.monadscan.com/address/0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA#code
  - faucet proxy: https://testnet.monadscan.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C#code
  - faucet implementation: https://testnet.monadscan.com/address/0xba804DF5c476E8EaeF87BF8085F295300ccE2a49#code
- **Etherscan V2:**
  - getabi: https://docs.etherscan.io/api-reference/endpoint/getabi
  - supported chains: https://docs.etherscan.io/supported-chains
- **Monad:**
  - gas pricing: https://docs.monad.xyz/developer-essentials/gas-pricing
  - JSON-RPC overview (block time, `eth_getLogs` limits): https://docs.monad.xyz/reference/json-rpc/overview
- **Circle:**
  - source: https://github.com/circlefin/stablecoin-evm @ `fc85788bc7c23cefe3df1a757133048bfddadeaa`
    (`contracts/v2/FiatTokenV2_2.sol`, `contracts/v2/EIP3009.sol`)
  - addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
  - faucet: https://faucet.circle.com/
- **Chainlink CRE forwarders:** https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
- **Uniswap Permit2 domain:** https://github.com/Uniswap/permit2/blob/main/src/EIP712.sol
- **EIPs:**
  - https://eips.ethereum.org/EIPS/eip-3009
  - https://eips.ethereum.org/EIPS/eip-2612
  - https://eips.ethereum.org/EIPS/eip-5267
  - https://eips.ethereum.org/EIPS/eip-1967
- **viem 2.56.9:**
  - https://viem.sh/docs/actions/public/getEip712Domain
  - https://viem.sh/docs/accounts/local/signTypedData
  - https://viem.sh/docs/utilities/parseSignature
  - https://viem.sh/docs/contract/simulateContract
  - https://viem.sh/docs/contract/writeContract
- **ethers 6.17.0:**
  - https://docs.ethers.org/v6/api/wallet/
  - https://docs.ethers.org/v6/api/crypto/#Signature

Scratch files, outside the repo, are under `E:\Projects\tmp-research`:

- the Agora and Circle clones
- the saved Monadscan pages and the faucet ABI
- the viem verification scripts in `viem-run/ausd-viem.mjs`,
  `viem-run/ausd-viem-salt.mjs` and `viem-run/ausd-viem-relay.mjs`
- the raw output in `ausd/check-monad-out.txt`
