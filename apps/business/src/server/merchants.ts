import "server-only";

import { isDuplicateKeyError, newMerchantRecord, type MerchantRecord } from "@polaris/db";

import type { Merchant } from "@/lib/data/types";
import type { AuthedMerchant } from "./auth";
import { getDb } from "./db";
import { getConfig } from "./env";
import { seedMerchantBook } from "@/lib/data/placeholder";

/**
 * Merchants: created on first sight of a verified Privy session, keyed by the
 * Privy user id. Privy stays the source of truth for the wallet and email.
 *
 * Without a configured chain (a dashboard run with no contracts), a new
 * merchant is marked `sample` and the dashboard shows a deterministic sample
 * book, labelled as such; with a chain, everything shown comes from the chain.
 */

export async function ensureMerchant(auth: AuthedMerchant): Promise<MerchantRecord> {
  const db = getDb();
  const existing = await db.merchants.get(auth.userId);
  if (existing) {
    const changed =
      (auth.walletAddress && existing.walletAddress !== auth.walletAddress) ||
      (auth.walletId && existing.walletId !== auth.walletId) ||
      (auth.email && existing.email !== auth.email);
    if (!changed) return existing;
    return (await db.merchants.update(auth.userId, (m) => ({
      ...m,
      walletAddress: auth.walletAddress ?? m.walletAddress,
      walletId: auth.walletId ?? m.walletId,
      email: auth.email ?? m.email,
    }))) as MerchantRecord;
  }
  const sample = getConfig().chain === null;
  const record = newMerchantRecord({
    id: auth.userId,
    walletAddress: auth.walletAddress,
    walletId: auth.walletId,
    email: auth.email,
    sample,
    sampleBalanceCents: sample ? seedMerchantBook(auth.userId).balanceCents : 0,
  });
  try {
    return await db.merchants.insert(record);
  } catch (error) {
    // Two first requests raced; the other one created it.
    if (isDuplicateKeyError(error)) return (await db.merchants.get(auth.userId)) as MerchantRecord;
    throw error;
  }
}

export async function merchantByWallet(address: string): Promise<MerchantRecord | null> {
  return getDb().merchants.findOne({ wallet: address.toLowerCase() });
}

export function toMerchant(m: MerchantRecord): Merchant {
  return {
    id: m.id,
    publicId: m.publicId,
    businessName: m.businessName,
    walletAddress: m.walletAddress,
    email: m.email,
    createdAt: m.createdAt,
    registration: {
      state: m.registration.state,
      txHash: m.registration.txHash,
      activationTxHash: m.registration.activationTxHash,
      error: m.registration.error,
    },
  };
}
