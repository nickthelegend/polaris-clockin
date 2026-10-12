import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Keypair } from '@solana/web3.js';
import { buildSignInInput, proofOf, recheckProof, signInLocally, verifySignIn, SIWS_DOMAIN } from './siws';

test('a locally signed SIWS message verifies and its proof re-checks', () => {
  const k = Keypair.generate();
  const input = buildSignInInput();
  const out = signInLocally(input, k.secretKey);
  assert.equal(out.address, k.publicKey.toBase58());
  const v = verifySignIn(input, out);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.fields.domain, SIWS_DOMAIN);
  assert.equal(recheckProof(proofOf('dev-local', 'Guest wallet', input, v, out.signature)), true);
});

test('a different nonce, a forged signature or a stale time is refused', () => {
  const k = Keypair.generate();
  const input = buildSignInInput();
  const out = signInLocally(input, k.secretKey);
  assert.equal(verifySignIn({ ...input, nonce: 'other-nonce-123' }, out).ok, false);
  const bad = Uint8Array.from(out.signature); bad[0] ^= 1;
  assert.equal(verifySignIn(input, { ...out, signature: bad }).ok, false);
  assert.equal(verifySignIn(input, out, Date.now() + 60 * 60_000).ok, false);
});
