import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, type VersionedTransactionResponse } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { verifyLinkTransaction } from './linkTransactionProof';
import type { PendingLink } from './pendingLink';
// Unsigned, deterministic ABI messages only: no provider success or acceptance evidence.
const owner=new PublicKey('BKaeJqmmgMTFAkTwUwBceLpGwpSRKfjc9TC8kvb6ieRP'), program=new PublicKey('HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA'), mint=TOKEN_PROGRAM_ID, key=SystemProgram.programId;
const pda=(seed:string,extra:Buffer[]=[])=>PublicKey.findProgramAddressSync([Buffer.from(seed),...extra],program)[0];
const record:PendingLink={version:1,scope:'https://api.devnet.solana.com',owner:owner.toBase58(),programId:program.toBase58(),mint:mint.toBase58(),linkKey:key.toBase58(),linkPda:pda('link',[key.toBuffer()]).toBase58(),amount:'1000000',expiresInSecs:120,signature:bs58.encode(new Uint8Array(64).fill(1))};
function unsigned(mutate:(data:Buffer,keys:PublicKey[])=>void=()=>{}) {
 const data=Buffer.alloc(24);Buffer.from([103,114,207,84,216,71,234,61]).copy(data);data.writeBigUInt64LE(1000000n,8);data.writeBigInt64LE(120n,16);
 const keys=[owner,key,pda('config'),new PublicKey(record.linkPda),mint,pda('link_vault',[key.toBuffer()]),getAssociatedTokenAddressSync(mint,owner,true),TOKEN_PROGRAM_ID,SystemProgram.programId];mutate(data,keys);
 const ix=new TransactionInstruction({programId:program,data,keys:keys.map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[0,3,5,6].includes(i)}))});
 const message=new TransactionMessage({payerKey:owner,recentBlockhash:SystemProgram.programId.toBase58(),instructions:[ix]}).compileToV0Message();
 return {slot:1,transaction:{signatures:[record.signature!],message},meta:{err:null,loadedAddresses:{writable:[],readonly:[]}}} as unknown as VersionedTransactionResponse;
}
test('missing original transaction cannot prove creation',()=>assert.throws(()=>verifyLinkTransaction(record,null)));
test('wrong original signature rejected',()=>{const tx=unsigned();tx.transaction.signatures[0]=bs58.encode(new Uint8Array(64).fill(2));assert.throws(()=>verifyLinkTransaction(record,tx));});
test('chain error rejects otherwise matching ABI',()=>{const tx=unsigned();tx.meta!.err={InstructionError:[0,'InvalidArgument']};assert.throws(()=>verifyLinkTransaction(record,tx));});
test('wrong amount and expiry reject independently',()=>{for(const offset of [8,16])assert.throws(()=>verifyLinkTransaction(record,unsigned(data=>{data[offset]++;})));});
test('every create account position bound to retained transfer',()=>{for(let i=0;i<9;i++)assert.throws(()=>verifyLinkTransaction(record,unsigned((_,keys)=>{keys[i]=new PublicKey(new Uint8Array(32).fill(7));})));});
test('wrong discriminator is not link creation',()=>assert.throws(()=>verifyLinkTransaction(record,unsigned(data=>{data[0]++;}))));
test('missing transaction metadata blocks sharing',()=>{const tx=unsigned();tx.meta=null;assert.throws(()=>verifyLinkTransaction(record,tx));});
