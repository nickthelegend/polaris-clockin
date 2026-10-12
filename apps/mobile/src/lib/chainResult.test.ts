import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountLayout, ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, type Connection } from '@solana/web3.js';
import { readTokenBalance, requireSuccessfulConfirmation } from './chainResult';

const address = PublicKey.default;
const connection = (getAccountInfo: () => Promise<unknown>) => ({ getAccountInfo }) as unknown as Connection;

test('offline SDK decode: only an absent account yields zero', async () => {
  assert.equal(await readTokenBalance(connection(async () => null), address), 0);
});
test('offline SDK decode: RPC outage propagates instead of replacing balance with zero', async () => {
  const outage = new Error('503 unavailable');
  await assert.rejects(readTokenBalance(connection(async () => { throw outage; }), address), error => error === outage);
});
test('offline SDK decode: an account owned by another program is rejected', async () => {
  await assert.rejects(readTokenBalance(connection(async () => ({ data: Buffer.alloc(ACCOUNT_SIZE), owner: SystemProgram.programId })), address));
});
test('offline SDK decode: an initialized SPL account retains its actual encoded amount', async () => {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode({ mint: address, owner: address, amount: 123n, delegateOption: 0, delegate: address, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: address }, data);
  assert.equal(await readTokenBalance(connection(async () => ({ data, owner: TOKEN_PROGRAM_ID })), address), 123);
});
test('offline confirmation: failed landed instruction cannot return success and preserves signature', () => {
  assert.throws(() => requireSuccessfulConfirmation({ value: { err: { InstructionError: [0, 'InsufficientFunds'] } } }, 'observed-signature'), /observed-signature.*InsufficientFunds/);
});
test('offline confirmation: a null chain error permits receipt construction', () => {
  assert.doesNotThrow(() => requireSuccessfulConfirmation({ value: { err: null } }, 'observed-signature'));
});
