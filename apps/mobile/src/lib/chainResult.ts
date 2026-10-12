import { getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import type { Connection, PublicKey } from '@solana/web3.js';

/** Only an absent SPL account is a zero balance; unavailable or invalid data is an error. */
export async function readTokenBalance(connection: Connection, address: PublicKey): Promise<number> {
  try {
    return Number((await getAccount(connection, address, 'confirmed')).amount);
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return 0;
    throw error;
  }
}

/** A landed transaction with a chain error must never produce a success receipt. */
export function requireSuccessfulConfirmation(result: { value: { err: unknown } }, signature: string): void {
  if (result.value.err) throw Object.assign(new Error('The network rejected this transaction. Nothing was charged except the fee.'), { signature, chainError: result.value.err });
}
