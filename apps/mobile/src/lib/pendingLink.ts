import { Buffer } from 'buffer';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Receipt } from './pendingReceipt';

export type LinkBinding = { scope: string; owner: string; mint: string; programId: string };
export type PendingLink = LinkBinding & { version: 1; linkKey: string; linkPda: string; amount: string; expiresInSecs: number; signature: string | null };
export type LinkStore = { readMeta: () => Promise<string | null>; writeMeta: (value: string) => Promise<void>; readSecret: () => Promise<string | null>; writeSecret: (value: string) => Promise<void>; clearMeta: () => Promise<void>; clearSecret: () => Promise<void> };
export type LinkProof = { programId: string; configMint: string; linkPda: string; sender: string; linkKey: string; amount: string; vaultMint: string; vaultAuthority: string; vaultAmount: string; createdAt: number; expiresAt: number; chainTime: number };
export type LinkRecovery = { kind: 'none' | 'unknown' | 'failed' | 'expired'; message: string } | { kind: 'ready'; url: string; amount: number; signature: string; expiresAt: number };
function sameBinding(record: PendingLink, binding: LinkBinding): boolean { return ['scope','owner','mint','programId'].every(k => record[k as keyof LinkBinding] === binding[k as keyof LinkBinding]); }
function validate(record: PendingLink): void {
  try {
    if (record.version !== 1 || !/^https?:\/\/[^\s]+$/.test(record.scope)) throw new Error();
    for (const k of [record.owner, record.mint, record.programId, record.linkKey, record.linkPda]) if (typeof k !== 'string' || new PublicKey(k).toBase58() !== k) throw new Error();
    if (!/^[1-9][0-9]*$/.test(record.amount) || BigInt(record.amount) > 18_446_744_073_709_551_615n || BigInt(record.amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
    if (!Number.isSafeInteger(record.expiresInSecs) || record.expiresInSecs <= 0 || record.expiresInSecs > 60*86400) throw new Error();
    const pda = PublicKey.findProgramAddressSync([Buffer.from('link'),new PublicKey(record.linkKey).toBuffer()],new PublicKey(record.programId))[0].toBase58();
    if (record.linkPda !== pda || (record.signature !== null && bs58.decode(record.signature).length !== 64)) throw new Error();
  } catch { throw new Error('Saved link metadata is invalid. Its outcome remains unknown; no new link was created.'); }
}
export function createPendingLink(store: LinkStore) {
  let preparing = false;
  const read = async (binding: LinkBinding): Promise<PendingLink | null> => {
    const raw = await store.readMeta();
    if (raw === null) return null;
    let record: PendingLink;
    try { record = JSON.parse(raw); validate(record); } catch { throw new Error('Saved link metadata is invalid. Review the original wallet activity.'); }
    if (!sameBinding(record,binding)) throw new Error('A saved link belongs to another wallet, network, mint or program. Reconnect to its original configuration.');
    return record;
  };
  const write = async (record: PendingLink) => {
    const encoded = JSON.stringify(record);
    await store.writeMeta(encoded);
    if (await store.readMeta() !== encoded) throw new Error('Pending link metadata was not saved reliably. Submission is blocked.');
  };
  return {
    read,
    async prepare(binding: LinkBinding, key: Keypair, amount: number, expiresInSecs: number): Promise<void> {
      if (preparing) throw new Error('Link preparation is already in progress.');
      preparing = true;
      try {
        if (await store.readMeta() !== null) throw new Error('A previous link is saved. Check its original receipt before creating another.');
        const record: PendingLink = { ...binding, version:1, linkKey:key.publicKey.toBase58(),linkPda:PublicKey.findProgramAddressSync([Buffer.from('link'),key.publicKey.toBuffer()],new PublicKey(binding.programId))[0].toBase58(),amount:String(amount),expiresInSecs,signature:null };
        validate(record);
        // Bearer secret never enters metadata, logs, action toasts or public artifacts.
        const secret = bs58.encode(key.secretKey);
        await store.writeSecret(secret);
        if (await store.readSecret() !== secret) throw new Error('Link secret was not saved reliably. Submission is blocked.');
        await write(record);
      } finally { preparing = false; }
    },
    async clearBeforeBroadcast(binding: LinkBinding, expectedLinkKey: string): Promise<void> {
      const record = await read(binding);
      if (!record || record.linkKey !== expectedLinkKey) throw new Error('Pending link changed; cleanup refused.');
      await store.clearMeta();
      if (await store.readMeta() !== null) throw new Error('Pending link metadata cleanup failed.');
      await store.clearSecret();
      if (await store.readSecret() !== null) throw new Error('Pending link secret cleanup failed.');
    },
    async signature(binding: LinkBinding, signature: string): Promise<void> {
      const record = await read(binding);
      if (!record) throw new Error('Pending link metadata is missing.');
      if (bs58.decode(signature).length !== 64) throw new Error('Invalid link transaction signature.');
      if (record.signature !== null && record.signature !== signature) throw new Error('Link transaction signature changed. Original receipt retained.');
      await write({ ...record, signature });
    },
    async recover(binding: LinkBinding, status: (signature: string) => Promise<Receipt>, proof: (record: PendingLink) => Promise<LinkProof | null>): Promise<LinkRecovery> {
      const record = await read(binding);
      if (!record) return {kind:'none',message:'No pending link is stored on this device.'};
      const secret = await store.readSecret();
      if (!secret) return {kind:'unknown',message:'The saved link secret is unavailable. The original transaction outcome must be reviewed; do not create a replacement.'};
      let key: Keypair;
      try { key=Keypair.fromSecretKey(bs58.decode(secret)); if (key.publicKey.toBase58()!==record.linkKey) throw new Error(); }
      catch { return {kind:'unknown',message:'The saved link secret does not match its account. Recovery is unavailable.'}; }
      if (!record.signature) return {kind:'unknown',message:'The wallet did not return a saved signature. Review its transaction history; automatic retry is disabled.'};
      const receipt = await status(record.signature);
      if (!receipt || receipt.confirmationStatus!=='finalized' || !Object.prototype.hasOwnProperty.call(receipt,'err')) return {kind:'unknown',message:'The original link transaction is not finalized. Check the same receipt again later.'};
      if (receipt.err!==null) return {kind:'failed',message:'The original link transaction finalized with an error. No shareable link is claimed.'};
      const state = await proof(record);
      if (!state) return {kind:'unknown',message:'The original transaction finalized, but its link account is unavailable or closed. No claim or refund is assumed.'};
      if (state.programId!==record.programId || state.configMint!==record.mint || state.linkPda!==record.linkPda || state.sender!==record.owner || state.linkKey!==record.linkKey || state.amount!==record.amount || state.vaultMint!==record.mint || state.vaultAmount!==record.amount || state.vaultAuthority!==PublicKey.findProgramAddressSync([Buffer.from('config')],new PublicKey(record.programId))[0].toBase58() || !Number.isSafeInteger(state.chainTime) || !Number.isSafeInteger(state.createdAt) || !Number.isSafeInteger(state.expiresAt) || state.expiresAt-state.createdAt!==record.expiresInSecs || state.createdAt<=0 || state.chainTime<=0 || state.chainTime<state.createdAt) return {kind:'unknown',message:'Finalized link state does not match the saved transfer. Share is blocked.'};
      if (state.chainTime>state.expiresAt) return {kind:'expired',message:'The matching link has expired. It is not shareable; owner cancellation requires a verified on-chain action.'};
      return {kind:'ready',url:`polaris://claim?k=${bs58.encode(key.secretKey)}`,amount:Number(record.amount),signature:record.signature,expiresAt:state.expiresAt};
    },
  };
}
