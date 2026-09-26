import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import {
  decodeFacts,
  decodeUnderwriteReport,
  encodeFacts,
  encodeUnderwriteReport,
  FACTS_ABI_TUPLE,
  UNDERWRITE_REPORT_ABI,
} from "../src/core/abi.ts";
import { U16_MAX, U32_MAX, U64_MAX } from "../src/core/constants.ts";
import type { Address, Facts } from "../src/core/types.ts";

const USER = "0xacc0000000000000000000000000000000000001" as Address;
const facts: Facts = {
  walletAgeDays: 1210,
  txCount: 902,
  stableBalance: 4_237_850_000n,
  defiTenureDays: 730,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: true,
  observedAt: 1_790_424_000n,
};

const extremes: Facts = {
  walletAgeDays: U32_MAX,
  txCount: 0,
  stableBalance: U64_MAX,
  defiTenureDays: 1,
  priorLiquidations: U16_MAX,
  relatedWallets: U16_MAX,
  exchangeFunded: false,
  observedAt: U64_MAX,
};

describe("the report's bytes", () => {
  for (const [name, f] of [["a typical report", facts], ["every width at its limit", extremes]] as const) {
    it(`Facts encode exactly as viem encodes the Solidity tuple: ${name}`, () => {
      const viem = encodeAbiParameters(parseAbiParameters(FACTS_ABI_TUPLE), [f]);
      assert.equal(encodeFacts(f), viem);
      assert.equal((encodeFacts(f).length - 2) / 2, 256);
    });

    it(`the report is abi.encode(uint8 2, address user, Facts): ${name}`, () => {
      const viem = encodeAbiParameters(parseAbiParameters(UNDERWRITE_REPORT_ABI), [2, USER, f]);
      const ours = encodeUnderwriteReport(USER, f);
      assert.equal(ours, viem.toLowerCase());
      assert.equal((ours.length - 2) / 2, 320);
      const [kind, user, decoded] = decodeAbiParameters(parseAbiParameters(UNDERWRITE_REPORT_ABI), ours);
      assert.equal(kind, 2);
      assert.equal(user.toLowerCase(), USER.toLowerCase());
      assert.deepEqual(decoded, f);
    });
  }

  it("round-trips through our own decoder", () => {
    assert.deepEqual(decodeFacts(encodeFacts(facts)), facts);
    const r = decodeUnderwriteReport(encodeUnderwriteReport(USER, facts));
    assert.equal(r.kind, 2);
    assert.equal(r.user, USER.toLowerCase());
    assert.deepEqual(r.facts, facts);
  });

  it("refuses a value that does not fit its field, instead of truncating it", () => {
    assert.throws(() => encodeFacts({ ...facts, txCount: U32_MAX + 1 }), /txCount does not fit uint32/);
    assert.throws(() => encodeFacts({ ...facts, relatedWallets: -1 }), /relatedWallets does not fit uint16/);
    assert.throws(() => encodeFacts({ ...facts, stableBalance: U64_MAX + 1n }), /stableBalance does not fit uint64/);
    assert.throws(() => encodeFacts({ ...facts, walletAgeDays: 1.5 }), /safe integer/);
    assert.throws(() => encodeUnderwriteReport("0x1234" as Address, facts), /20-byte/);
  });

  it("decoding refuses what abi.decode would refuse", () => {
    const bad = `0x${"00".repeat(32 * 6)}${"00".repeat(31)}02${"00".repeat(32)}`;
    assert.throws(() => decodeFacts(bad as `0x${string}`), /not a bool/);
    assert.throws(() => decodeFacts("0x00" as `0x${string}`), /expected 256 bytes/);
  });
});
