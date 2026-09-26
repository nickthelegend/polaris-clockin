/**
 * Checks src/lib/sign against the contracts' own definitions, with no chain.
 *
 *   pnpm --filter @polaris/app check:signatures
 *
 * For every struct it verifies that:
 *   1. the field list encodes to exactly the typehash preimage the contract
 *      declares (e.g. "Claim(address to)");
 *   2. the digest viem signs equals the one the contract computes by hand,
 *      keccak256(0x1901 ‖ domainSeparator ‖ keccak256(abi.encode(TYPEHASH, ...fields)));
 *   3. a signature from the builder recovers to its signer.
 * It also pins the two nonce derivations and the ERC-5267 field filtering.
 *
 * Runs on Node 22.18+ (built-in TypeScript type stripping).
 */
import assert from "node:assert/strict";
import {
  type Address,
  concat,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  type Hex,
  keccak256,
  numberToHex,
  pad,
  recoverTypedDataAddress,
  stringToBytes,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildCancel,
  buildCancelSubscription,
  buildClaim,
  buildPermit,
  buildPlanIntent,
  buildReceiveWithAuthorization,
  buildSubscribeIntent,
  buildTransferWithAuthorization,
  domainFromErc5267,
  type Eip712Domain,
  orderIdToBytes32,
  paymentNonce,
  sendNonce,
  TYPE_REGISTRY,
} from "../src/lib/sign/index.ts";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  ${name}`);
    });
}

const merchant: Address = getAddress("0x1111111111111111111111111111111111111111");
const buyer = privateKeyToAccount(generatePrivateKey());
const domain: Eip712Domain = {
  name: "Polaris Test",
  version: "1",
  chainId: 10143,
  verifyingContract: getAddress("0x2222222222222222222222222222222222222222"),
};

/** OpenZeppelin EIP712._buildDomainSeparator, written out independently of viem. */
const ozDomainSeparator = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [
      keccak256(
        stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      ),
      keccak256(stringToBytes(domain.name!)),
      keccak256(stringToBytes(domain.version!)),
      BigInt(domain.chainId!),
      domain.verifyingContract!,
    ],
  ),
);

// 1. encodeType strings
for (const entry of TYPE_REGISTRY) {
  await check(`${entry.primaryType} encodes to the contract's typehash preimage`, () => {
    const fields = (entry.types as Record<string, readonly { name: string; type: string }[]>)[entry.primaryType];
    assert.ok(fields, "field list present");
    const encoded = `${entry.primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
    assert.equal(encoded, entry.solidity);
  });
}

// 2 + 3. digests and recovery for every builder
const now = 1_790_000_000n;
const cases = [
  buildPlanIntent(domain, {
    borrower: buyer.address,
    merchant,
    principal: 200_000_000n,
    installments: 4,
    interval: 604_800n,
    orderId: orderIdToBytes32("SOL-2026-0142"),
    deadline: now + 900n,
  }),
  buildSubscribeIntent(domain, { subscriber: buyer.address, planId: 7n, deadline: now + 900n }),
  buildReceiveWithAuthorization(domain, {
    from: buyer.address,
    to: merchant,
    value: 200_000_000n,
    validAfter: 0n,
    validBefore: now + 600n,
    nonce: paymentNonce(merchant, "SOL-2026-0142"),
  }),
  buildTransferWithAuthorization(domain, {
    from: buyer.address,
    to: merchant,
    value: 5_000_000n,
    validAfter: 0n,
    validBefore: now + 600n,
    nonce: keccak256(toHex("transfer")),
  }),
  buildPermit(domain, { owner: buyer.address, spender: merchant, value: 201_534_246n, nonce: 3n, deadline: now }),
  buildClaim(domain, { to: buyer.address }),
  buildCancel(domain, { linkKey: merchant, deadline: now }),
  buildCancelSubscription(domain, { subId: 12n, deadline: now }),
] as const;

for (const typed of cases) {
  await check(`${typed.primaryType} digest equals the contract's _hashTypedDataV4`, () => {
    const entry = TYPE_REGISTRY.find((e) => e.primaryType === typed.primaryType);
    assert.ok(entry);
    const fields = (entry.types as Record<string, readonly { name: string; type: string }[]>)[entry.primaryType]!;
    const message = typed.message as Record<string, unknown>;
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, ...fields.map((f) => ({ type: f.type }))],
        [keccak256(stringToBytes(entry.solidity)), ...fields.map((f) => message[f.name])],
      ),
    );
    const expected = keccak256(concat(["0x1901", ozDomainSeparator, structHash]));
    assert.equal(hashTypedData(typed as Parameters<typeof hashTypedData>[0]), expected);
  });
  await check(`${typed.primaryType} signature recovers to the signer`, async () => {
    const signature = await buyer.signTypedData(typed as Parameters<typeof buyer.signTypedData>[0]);
    const recovered = await recoverTypedDataAddress({
      ...(typed as Parameters<typeof hashTypedData>[0]),
      signature,
    });
    assert.equal(recovered, buyer.address);
  });
}

// Nonces
await check("payment nonce is keccak256(abi.encodePacked(merchant, orderId))", () => {
  const packed: Hex = concat([merchant, toHex(stringToBytes("ORD-1"))]);
  assert.equal(paymentNonce(merchant, "ORD-1"), keccak256(packed));
});

await check("send nonce is keccak256(abi.encode(linkKey, uint64 expiresAt))", () => {
  const expiresAt = 1_790_604_800n;
  const encoded: Hex = concat([pad(merchant), pad(numberToHex(expiresAt))]);
  assert.equal(sendNonce(merchant, expiresAt), keccak256(encoded));
});

await check("orderIdToBytes32 hashes text and passes bytes32 through", () => {
  const raw = keccak256(toHex("x"));
  assert.equal(orderIdToBytes32(raw), raw);
  assert.equal(orderIdToBytes32("SOL-1"), keccak256(toHex("SOL-1")));
});

await check("ERC-5267 fields 0x0f drop the unused salt", () => {
  const d = domainFromErc5267(
    { name: "AUSD", version: "1", chainId: 10143, verifyingContract: merchant, salt: pad("0x0") },
    "0x0f",
  );
  assert.deepEqual(Object.keys(d).sort(), ["chainId", "name", "verifyingContract", "version"]);
});

console.log(`\n${passed} checks passed`);
