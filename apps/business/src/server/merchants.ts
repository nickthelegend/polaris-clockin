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
 * Sample is a live condition: once this server is connected to a chain, the
 * next request clears the flag and the sample withdrawals, so real payments
 * are never merged with invented ones and a real signature is never taken
 * for a sample payout.
 */

export async function ensureMerchant(auth: AuthedMerchant): Promise<MerchantRecord> {
  const db = getDb();
  const existing = await db.merchants.get(auth.userId);
  if (existing) {
    const graduate = existing.sample && getConfig().chain !== null;
    const changed =
      (auth.walletAddress && existing.walletAddress !== auth.walletAddress) ||
      (auth.walletId && existing.walletId !== auth.walletId) ||
      (auth.email && existing.email !== auth.email);
    if (!changed && !graduate) return existing;
    const updated = (await db.merchants.update(auth.userId, (m) => ({
      ...m,
      walletAddress: auth.walletAddress ?? m.walletAddress,
      walletId: auth.walletId ?? m.walletId,
      email: auth.email ?? m.email,
      ...(graduate ? { sample: false, sampleBalanceCents: 0 } : {}),
    }))) as MerchantRecord;
    if (graduate) await dropSamplePayouts(auth.userId);
    return updated;
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

/** The withdrawals recorded against a sample balance: gone once the book is real. */
async function dropSamplePayouts(merchantId: string): Promise<void> {
  const db = getDb();
  const rows = await db.payouts.find({ merchantId }, { limit: 10_000 });
  for (const p of rows) if (p.sample) await db.payouts.delete(p.id);
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
    // No chain configured: this merchant's book is the labelled sample one.
    sample: m.sample,
    registration: {
      state: m.registration.state,
      txHash: m.registration.txHash,
      activationTxHash: m.registration.activationTxHash,
      error: m.registration.error,
    },
  };
}
