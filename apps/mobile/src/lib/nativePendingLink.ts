import { Buffer } from 'buffer';
import { TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import * as SecureStore from 'expo-secure-store';
import { Keypair, PublicKey } from '@solana/web3.js';
import { connection, pdas, program } from '../chain/polaris';
import { PROGRAM_ID, USD_MINT } from './config';
import { createPendingLink, type LinkBinding } from './pendingLink';
import { verifyLinkTransaction } from './linkTransactionProof';

const META = 'polaris.pending.link.meta.v1';
const SECRET = 'polaris.pending.link.secret.v1';
const pending = createPendingLink({
  readMeta: () => SecureStore.getItemAsync(META),
  writeMeta: value => SecureStore.setItemAsync(META,value),
  readSecret: () => SecureStore.getItemAsync(SECRET),
  writeSecret: value => SecureStore.setItemAsync(SECRET,value),
  clearMeta: () => SecureStore.deleteItemAsync(META),
  clearSecret: () => SecureStore.deleteItemAsync(SECRET),
});
const binding = (owner: PublicKey): LinkBinding => ({ scope:connection.rpcEndpoint,owner:owner.toBase58(),mint:USD_MINT.toBase58(),programId:PROGRAM_ID.toBase58() });
async function finalizedConfig() {
  const info = await connection.getAccountInfo(pdas.config,'finalized');
  if (!info || !info.owner.equals(PROGRAM_ID)) throw new Error('Polaris devnet program/configuration is unavailable. No link was created.');
  const config = program.coder.accounts.decode('config',info.data) as {usdMint:PublicKey};
  if (!config.usdMint.equals(USD_MINT)) throw new Error('Configured dollar mint differs from finalized program state. No link was created.');
  return config;
}
export async function preparePendingLink(owner: PublicKey, amount: number): Promise<PublicKey> {
  if (await pending.read(binding(owner))) throw new Error('A previous link is retained. Review its original receipt before creating another.');
  // A genuinely undeployed program is unavailable, never replaced with a fixture.
  await finalizedConfig();
  const key = Keypair.generate();
  await pending.prepare(binding(owner),key,amount,14*86400);
  return key.publicKey;
}
export async function savePendingLinkSignature(owner: PublicKey, signature: string): Promise<void> {
  await pending.signature(binding(owner),signature);
}
export async function discardUnbroadcastLink(owner: PublicKey, linkKey: PublicKey): Promise<void> {
  await pending.clearBeforeBroadcast(binding(owner),linkKey.toBase58());
}
export async function recoverPendingLink(owner: PublicKey) {
  return pending.recover(binding(owner), async signature => {
    const { value } = await connection.getSignatureStatuses([signature],{searchTransactionHistory:true});
    return value[0] ?? null;
  }, async record => {
    verifyLinkTransaction(record, await connection.getTransaction(record.signature!,{commitment:'finalized',maxSupportedTransactionVersion:0}));
    const config = await finalizedConfig();
    const key = new PublicKey(record.linkPda);
    const info = await connection.getAccountInfo(key,'finalized');
    if (!info) {
      const later = await connection.getSignaturesForAddress(key,{limit:10},'finalized');
      return later.some(x => x.signature !== record.signature && x.err === null) ? 'closed' as const : null;
    }
    if (!info.owner.equals(PROGRAM_ID)) throw new Error('Saved link account has an unexpected program owner. Share is blocked.');
    const link = program.coder.accounts.decode('link',info.data) as {sender:PublicKey;linkKey:PublicKey;amount:{toString():string};createdAt:{toNumber():number};expiresAt:{toNumber():number}};
    const vaultPda = PublicKey.findProgramAddressSync([Buffer.from('link_vault'),new PublicKey(record.linkKey).toBuffer()],PROGRAM_ID)[0];
    const vaultInfo = await connection.getAccountInfo(vaultPda,'finalized');
    if (!vaultInfo) throw new Error('Finalized link escrow is unavailable. Share is blocked.');
    const vault = unpackAccount(vaultPda,vaultInfo,TOKEN_PROGRAM_ID);
    const slot = await connection.getSlot('finalized');
    const chainTime = await connection.getBlockTime(slot);
    if (chainTime === null) throw new Error('Finalized chain time is unavailable. Link sharing remains blocked.');
    return {programId:info.owner.toBase58(),configMint:config.usdMint.toBase58(),linkPda:key.toBase58(),sender:link.sender.toBase58(),linkKey:link.linkKey.toBase58(),amount:link.amount.toString(),vaultMint:vault.mint.toBase58(),vaultAuthority:vault.owner.toBase58(),vaultAmount:vault.amount.toString(),createdAt:link.createdAt.toNumber(),expiresAt:link.expiresAt.toNumber(),chainTime};
  });
}
