/**
 * The bytes the DON signs, without a dependency.
 *
 * `Facts` is a static tuple of eight value types, so its ABI encoding is eight
 * 32-byte words, each left-padded big-endian, in declaration order:
 *
 *   word 0  uint32 walletAgeDays
 *   word 1  uint32 txCount
 *   word 2  uint64 stableBalance      (6 decimals)
 *   word 3  uint32 defiTenureDays
 *   word 4  uint16 priorLiquidations
 *   word 5  uint16 relatedWallets
 *   word 6  bool   exchangeFunded     (0 or 1)
 *   word 7  uint64 observedAt         (unix seconds)
 *
 * The underwriting report PolarisUnderwriter decodes is
 * `abi.encode(uint8 kind, address user, Facts facts)`: a static tuple, so no
 * offsets, just ten words, kind first (always 2), then the user's address,
 * then the eight above. 320 bytes. `test/abi.test.ts` checks both against
 * viem's `encodeAbiParameters`, and the Hardhat suite decodes them with
 * ethers and feeds them to ScoreManager.
 */

import { REPORT_KIND_UNDERWRITE, U16_MAX, U32_MAX, U64_MAX } from "./constants.ts";
import type { Address, Facts, Hex } from "./types.ts";

/** The Solidity tuple, for `parseAbiParameters` or `abi.decode`. */
export const FACTS_ABI_TUPLE =
  "(uint32 walletAgeDays, uint32 txCount, uint64 stableBalance, uint32 defiTenureDays, uint16 priorLiquidations, uint16 relatedWallets, bool exchangeFunded, uint64 observedAt)";

/** The report's parameters, for viem's `parseAbiParameters`. */
export const UNDERWRITE_REPORT_ABI = `uint8 kind, address user, ${FACTS_ABI_TUPLE} facts`;

/** Field order and widths, the one place both directions read from. */
const FIELDS = [
  ["walletAgeDays", "uint", 32],
  ["txCount", "uint", 32],
  ["stableBalance", "uint", 64],
  ["defiTenureDays", "uint", 32],
  ["priorLiquidations", "uint", 16],
  ["relatedWallets", "uint", 16],
  ["exchangeFunded", "bool", 8],
  ["observedAt", "uint", 64],
] as const;

const WORD = 64; // hex chars per 32-byte word

function word(value: bigint): string {
  return value.toString(16).padStart(WORD, "0");
}

function maxFor(bits: number): bigint {
  return bits === 64 ? U64_MAX : bits === 32 ? BigInt(U32_MAX) : bits === 16 ? BigInt(U16_MAX) : 0xffn;
}

/** Throws a RangeError naming the field when a value does not fit its width. */
export function validateFacts(f: Facts): void {
  for (const [name, type, bits] of FIELDS) {
    const v = f[name];
    if (type === "bool") {
      if (typeof v !== "boolean") throw new TypeError(`${name} must be a boolean`);
      continue;
    }
    if (typeof v !== "number" && typeof v !== "bigint") throw new TypeError(`${name} must be an integer`);
    if (typeof v === "number" && !Number.isSafeInteger(v)) throw new RangeError(`${name} must be a safe integer`);
    const b = BigInt(v);
    if (b < 0n || b > maxFor(bits)) throw new RangeError(`${name} does not fit uint${bits}`);
  }
}

/** `abi.encode(facts)`: 256 bytes. */
export function encodeFacts(f: Facts): Hex {
  validateFacts(f);
  let out = "0x";
  for (const [name, type] of FIELDS) {
    const v = f[name];
    out += type === "bool" ? word(v ? 1n : 0n) : word(BigInt(v as number | bigint));
  }
  return out as Hex;
}

function isAddress(a: string): a is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** `abi.encode(uint8(2), user, facts)`: the underwriting report, 320 bytes. */
export function encodeUnderwriteReport(user: Address, f: Facts): Hex {
  if (!isAddress(user)) throw new TypeError("user must be a 20-byte hex address");
  return `0x${word(BigInt(REPORT_KIND_UNDERWRITE))}${word(BigInt(user))}${encodeFacts(f).slice(2)}` as Hex;
}

function words(hex: string, count: number): bigint[] {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) throw new TypeError("not hex");
  const body = hex.slice(2);
  if (body.length !== count * WORD) throw new RangeError(`expected ${count * 32} bytes, got ${body.length / 2}`);
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) out.push(BigInt(`0x${body.slice(i * WORD, (i + 1) * WORD)}`));
  return out;
}

function factsFromWords(w: bigint[]): Facts {
  const f: Record<string, unknown> = {};
  FIELDS.forEach(([name, type, bits], i) => {
    const v = w[i]!;
    if (type === "bool") {
      if (v > 1n) throw new RangeError(`${name} is not a bool`);
      f[name] = v === 1n;
    } else {
      if (v > maxFor(bits)) throw new RangeError(`${name} does not fit uint${bits}`);
      f[name] = bits === 64 ? v : Number(v);
    }
  });
  return f as unknown as Facts;
}

/** The inverse of `encodeFacts`, with the same width checks `abi.decode` makes. */
export function decodeFacts(hex: Hex): Facts {
  return factsFromWords(words(hex, FIELDS.length));
}

/** The inverse of `encodeUnderwriteReport`. */
export function decodeUnderwriteReport(hex: Hex): { kind: number; user: Address; facts: Facts } {
  const w = words(hex, FIELDS.length + 2);
  if (w[0]! > 0xffn) throw new RangeError("kind does not fit uint8");
  if (w[1]! >> 160n !== 0n) throw new RangeError("user is not an address");
  const user = `0x${w[1]!.toString(16).padStart(40, "0")}` as Address;
  return { kind: Number(w[0]!), user, facts: factsFromWords(w.slice(2)) };
}
