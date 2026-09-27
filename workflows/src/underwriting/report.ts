/**
 * The underwriting report, in the deployed UnderwritingReceiver's format:
 *
 *   abi.encode(uint8 kind = 2, (address user, address linkedWallet, Facts facts)[] items)
 *   Facts = (uint32 walletAgeDays, uint32 txCount, uint64 stableBalance, uint32 defiTenureDays,
 *            uint16 priorLiquidations, uint16 relatedWallets, bool exchangeFunded, uint64 observedAt)
 *
 * This is not `@polarispay/underwriting`'s `encodeUnderwriteReport`, which
 * encodes the single-item `(uint8, address, Facts)` of the research sketch
 * (docs/research/cre.md §7.7). The receiver that shipped takes a batch and
 * the linked wallet, so it can enforce "one history wallet backs one
 * account". The Facts words themselves are the package's, checked by its
 * `validateFacts`.
 */

import { type Facts, validateFacts } from "@polarispay/underwriting/core";
import { type Address, decodeAbiParameters, encodeAbiParameters, type Hex, parseAbiParameters, zeroAddress } from "viem";

export const REPORT_KIND_UNDERWRITING = 2;

export const UNDERWRITING_REPORT_PARAMS = parseAbiParameters(
  "uint8 kind, (address user, address linkedWallet, (uint32 walletAgeDays, uint32 txCount, uint64 stableBalance, uint32 defiTenureDays, uint16 priorLiquidations, uint16 relatedWallets, bool exchangeFunded, uint64 observedAt) facts)[] items",
);

export interface UnderwritingItem {
  user: Address;
  /** The history wallet the buyer proved, or null for the account alone. */
  linkedWallet: Address | null;
  facts: Facts;
}

export function encodeUnderwritingReport(items: readonly UnderwritingItem[]): Hex {
  return encodeAbiParameters(UNDERWRITING_REPORT_PARAMS, [
    REPORT_KIND_UNDERWRITING,
    items.map((i) => {
      validateFacts(i.facts);
      return { user: i.user, linkedWallet: i.linkedWallet ?? zeroAddress, facts: i.facts };
    }),
  ]);
}

export function decodeUnderwritingReport(hex: Hex): { kind: number; items: UnderwritingItem[] } {
  const [kind, items] = decodeAbiParameters(UNDERWRITING_REPORT_PARAMS, hex);
  return {
    kind,
    items: items.map((i) => ({
      user: i.user,
      linkedWallet: i.linkedWallet === zeroAddress ? null : i.linkedWallet,
      facts: { ...i.facts },
    })),
  };
}
