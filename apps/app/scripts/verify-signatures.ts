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
import { createRequire } from "node:module";
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
  buildOpen,
  buildPermit,
  buildPlanIntent,
  buildReceiveWithAuthorization,
  buildRepayIntent,
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
    buyer: buyer.address,
    merchant,
    principal: 200_000_000n,
    installments: 4,
    interval: 604_800n,
    orderId: "SOL-2026-0142",
    nonce: 0n,
    deadline: now + 900n,
  }),
  buildSubscribeIntent(domain, {
    buyer: buyer.address,
    merchant,
    planId: 7n,
    pricePerPeriod: 9_990_000n,
    periodSeconds: 2_592_000n,
    orderId: "SOL-SUB-7",
    nonce: 1n,
    deadline: now + 900n,
  }),
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
  buildOpen(domain, { sender: buyer.address, amount: 50_000_000n, expiresAt: now + 604_800n }),
  buildClaim(domain, { to: buyer.address, deadline: now + 600n }),
  buildCancel(domain, { linkKey: merchant, deadline: now }),
  buildCancelSubscription(domain, { subId: 12n, deadline: now }),
  buildRepayIntent(domain, { loanId: 3n, amount: 151_150_684n, expectedRepaid: 50_383_562n, nonce: 0n, deadline: now + 600n }),
] as const;

for (const typed of cases) {
  await check(`${typed.primaryType} digest equals the contract's _hashTypedDataV4`, () => {
    const entry = TYPE_REGISTRY.find((e) => e.primaryType === typed.primaryType);
    assert.ok(entry);
    const fields = (entry.types as Record<string, readonly { name: string; type: string }[]>)[entry.primaryType]!;
    const message = typed.message as Record<string, unknown>;
    // EIP-712 encodes a `string` member as keccak256 of its bytes, a static bytes32.
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, ...fields.map((f) => ({ type: f.type === "string" ? "bytes32" : f.type }))],
        [
          keccak256(stringToBytes(entry.solidity)),
          ...fields.map((f) => (f.type === "string" ? keccak256(stringToBytes(message[f.name] as string)) : message[f.name])),
        ],
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

// The contracts' own struct list, which their suite checks against every typehash on chain.
const contracts = createRequire(import.meta.url)("../../../packages/contracts/lib/eip712.js") as {
  TYPES: Record<string, Record<string, { name: string; type: string }[]>>;
  typeString: (primary: string, fields: { name: string; type: string }[]) => string;
};
const onChain: Record<string, { name: string; type: string }[]> = Object.assign({}, ...Object.values(contracts.TYPES));
for (const entry of TYPE_REGISTRY) {
  await check(`${entry.primaryType} is the struct packages/contracts signs`, () => {
    const fields = onChain[entry.primaryType];
    assert.ok(fields, `packages/contracts/lib/eip712.js defines ${entry.primaryType}`);
    assert.equal(entry.solidity, contracts.typeString(entry.primaryType, fields));
  });
}

console.log(`\n${passed} checks passed`);
