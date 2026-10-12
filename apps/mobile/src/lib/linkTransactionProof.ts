import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, type VersionedTransactionResponse } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { PendingLink } from './pendingLink';

/** Bind the retained signature to the actual top-level create_link ABI. */
export function verifyLinkTransaction(record: PendingLink, tx: VersionedTransactionResponse | null): void {
  const fail = () => { throw new Error('Original finalized transaction does not prove this link creation. Share is blocked.'); };
  if (!tx || !record.signature || tx.transaction.signatures[0] !== record.signature || !tx.meta || tx.meta.err !== null || !Number.isSafeInteger(tx.slot) || tx.slot <= 0) return fail();
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const program = new PublicKey(record.programId), owner = new PublicKey(record.owner), mint = new PublicKey(record.mint), linkKey = new PublicKey(record.linkKey);
  const pda = (seed: string, extra: Buffer[] = []) => PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], program)[0];
  const expected = [owner, linkKey, pda('config'), new PublicKey(record.linkPda), mint, pda('link_vault',[linkKey.toBuffer()]), getAssociatedTokenAddressSync(mint,owner,true), TOKEN_PROGRAM_ID, SystemProgram.programId];
  if (!keys.get(0)?.equals(owner) || !message.isAccountSigner(0)) return fail();
  const discriminator = Buffer.from([103,114,207,84,216,71,234,61]);
  let matches = 0;
  for (const ix of message.compiledInstructions) {
    if (!keys.get(ix.programIdIndex)?.equals(program)) continue;
    const data = Buffer.from(ix.data);
    if (data.length < 8 || !data.subarray(0,8).equals(discriminator)) continue;
    matches++;
    if (data.length !== 24 || data.readBigUInt64LE(8) !== BigInt(record.amount) || data.readBigInt64LE(16) !== BigInt(record.expiresInSecs) || ix.accountKeyIndexes.length !== expected.length) return fail();
    for (let i=0;i<expected.length;i++) {
      const index = ix.accountKeyIndexes[i];
      if (!keys.get(index)?.equals(expected[i])) return fail();
      if ([0,3,5,6].includes(i) && !message.isAccountWritable(index)) return fail();
      if (i===0 && !message.isAccountSigner(index)) return fail();
    }
  }
  if (matches !== 1) return fail();
}
