import { type Address, encodeAbiParameters, encodePacked, type Hex, keccak256, stringToHex } from "viem";

/**
 * Nonces the contracts derive instead of taking from the caller. Because the
 * buyer's ERC-3009 signature commits to them, a relayer can't point the money
 * anywhere else: change the merchant, the order or the link key and the token
 * rejects the signature.
 */

/**
 * PolarisPayments: `keccak256(abi.encodePacked(merchant, orderId))`, which is
 * also the payment id. `orderId` is the merchant's order reference, a Solidity
 * `string` (see `payWithAuthorization(address,address,uint256,string,...)`).
 */
export function paymentNonce(merchant: Address, orderId: string): Hex {
  return keccak256(encodePacked(["address", "string"], [merchant, orderId]));
}

/**
 * PolarisSend: `keccak256(abi.encode(linkKey, expiresAt))`. `expiresAt` is a
 * `uint64` in seconds; `abi.encode` pads it to a word, as it does a uint256.
 */
export function sendNonce(linkKey: Address, expiresAt: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint64" }], [linkKey, expiresAt]));
}

/**
 * PlanIntent's `orderId` is a `bytes32`. A merchant's order reference is free
 * text, so it is committed as its keccak256. Pass a 0x-prefixed 32-byte hex
 * through unchanged.
 */
export function orderIdToBytes32(orderId: string): Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(orderId) ? (orderId as Hex) : keccak256(stringToHex(orderId));
}
