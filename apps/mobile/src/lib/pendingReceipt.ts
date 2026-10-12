import bs58 from 'bs58';
/** Public signatures only. Storage/read failures fail closed; never auto-submit. */
export type Receipt = { err: unknown; confirmationStatus?: string | null } | null;
export type JournalStore = { get: () => Promise<string | null>; set: (value: string) => Promise<void>; clear: () => Promise<void> };
export type PendingReceipt = { version: 2; scope: string; owner: string; attemptId: string; stage: 'intent' | 'submitted'; signature: string | null };
export type SubmissionControl = { beginBroadcast: () => void; abortBeforeBroadcast: () => Promise<boolean> };
let sequence = 0;
function base58Size(value: unknown, bytes: number): value is string {
  try { return typeof value === 'string' && bs58.decode(value).length === bytes; } catch { return false; }
}
function validScope(value: unknown): value is string { return typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value); }
export function createReceiptJournal(store: JournalStore) {
  let busy = false;
  const clearVerified = async (expected: string) => {
    if (await store.get() !== expected) throw new Error('Saved transaction changed before clearing. Retry is disabled.');
    await store.clear();
    if (await store.get() !== null) throw new Error('Transaction receipt could not be cleared reliably. Automatic retry is disabled.');
  };
  return {
    async run<T>(scope: string, owner: string, status: (signature: string) => Promise<Receipt>, submit: (save: (signature: string) => Promise<void>, control: SubmissionControl) => Promise<T>): Promise<T> {
      if (busy) throw new Error('A wallet transaction is already in progress.');
      busy = true;
      try {
        if (!validScope(scope) || !base58Size(owner, 32)) throw new Error('Transaction network or wallet identity is invalid.');
        const raw = await store.get();
        if (raw !== null) {
          let prior: PendingReceipt;
          try {
            prior = JSON.parse(raw);
            if (!validScope(prior.scope) || !base58Size(prior.owner, 32)) throw new Error();
            if ((prior as any).version === 1) { if (!base58Size(prior.signature, 64)) throw new Error(); }
            else if (prior.version !== 2 || typeof prior.attemptId !== 'string' || !prior.attemptId || !['intent', 'submitted'].includes(prior.stage) || (prior.stage === 'intent' ? prior.signature !== null : !base58Size(prior.signature, 64))) throw new Error();
          } catch { throw new Error('Saved transaction receipt is unreadable. Review wallet activity; automatic retry is disabled.'); }
          if (prior.scope !== scope) throw new Error(`Unresolved transaction belongs to another network (${prior.signature}). Reconnect to review it.`);
          if (prior.owner !== owner) throw new Error(`Unresolved transaction belongs to another wallet (${prior.signature}). Reconnect to review it.`);
          if (prior.signature === null) throw new Error('Previous wallet submission was interrupted before a signature was saved. Review actual wallet/provider history; automatic retry is disabled.');
          const receipt = await status(prior.signature);
          if (!receipt || !Object.prototype.hasOwnProperty.call(receipt, 'err') || (receipt.confirmationStatus !== 'confirmed' && receipt.confirmationStatus !== 'finalized')) {
            throw new Error(`Previous transaction is unresolved (${prior.signature}). Check its receipt before trying again.`);
          }
          await clearVerified(raw);
          if (receipt.err == null) throw new Error(`Previous transaction confirmed (${prior.signature}). Refresh its result before submitting another transaction.`);
        }
        const attemptId = `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
        const intent: PendingReceipt = { version: 2, scope, owner, attemptId, stage: 'intent', signature: null };
        let savedRecord = JSON.stringify(intent);
        await store.set(savedRecord);
        if (await store.get() !== savedRecord) throw new Error('Transaction intent was not saved reliably. Wallet submission was not started.');
        let broadcastStarted = false;
        let originalSignature: string | null = null;
        const result = await submit(async (signature) => {
          if (!base58Size(signature, 64)) throw new Error('Wallet returned an invalid transaction signature.');
          if (originalSignature !== null && signature !== originalSignature) throw new Error('Returned transaction signature differs from the original signed transaction. Check the original receipt; retry is disabled.');
          originalSignature = signature;
          const encoded = JSON.stringify({ ...intent, stage: 'submitted', signature } satisfies PendingReceipt);
          const existing = await store.get();
          if (existing !== savedRecord) throw new Error('Saved transaction differs from the original receipt. Retry is disabled.');
          await store.set(encoded);
          if (await store.get() !== encoded) throw new Error('Transaction receipt was not saved reliably. Automatic retry is disabled.');
          savedRecord = encoded;
        }, {
          beginBroadcast: () => { broadcastStarted = true; },
          abortBeforeBroadcast: async () => {
            if (broadcastStarted) return false;
            await clearVerified(savedRecord);
            return true;
          },
        });
        if (originalSignature === null) throw new Error('Submission completed without a saved transaction receipt.');
        await clearVerified(savedRecord);
        return result;
      } finally { busy = false; }
    },
  };
}
