import { ed25519 } from '@noble/curves/ed25519.js';
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

/**
 * Sign In With Solana (SIWS), the wallet-standard message format
 * (`@solana/wallet-standard-util` createSignInMessageText), built and checked
 * on the device. Pure: no React Native imports, so it is unit-tested in Node.
 *
 * Flow on Android: Mobile Wallet Adapter `authorize({ sign_in_payload })`
 * asks the wallet (Seed Vault on a Seeker) to build this message from our
 * fields and sign it, in the same sheet that authorizes the app. We get back
 * the exact bytes it signed and the signature, and accept the sign-in only if
 *  - the ed25519 signature verifies against the returned address, and
 *  - the signed text parses and carries *our* domain, nonce, chain, statement
 *    and URI, with an issue time close to now.
 * The nonce is fresh per attempt, so a replayed old sign-in fails.
 */
export const SIWS_DOMAIN = 'github.com';
export const SIWS_URI = 'https://github.com/nickthelegend/polaris-clockin';
export const SIWS_CHAIN = 'solana:devnet';
export const SIWS_STATEMENT = 'Sign in to Polaris. This signs a message, not a transaction: it costs nothing.';
/** How far the signed Issued At may be from the device clock. */
export const SIWS_SKEW_MS = 10 * 60_000;

export interface SignInInput {
  domain: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

/** A random alphanumeric nonce (EIP-4361 asks for at least 8 characters). */
export function makeNonce(bytes: Uint8Array = randomBytes(12)): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/** The fields Polaris asks a wallet to sign. `address` is filled by the wallet. */
export function buildSignInInput(now = new Date(), nonce = makeNonce()): SignInInput {
  return {
    domain: SIWS_DOMAIN,
    statement: SIWS_STATEMENT,
    uri: SIWS_URI,
    version: '1',
    chainId: SIWS_CHAIN,
    nonce,
    issuedAt: now.toISOString(),
  };
}

/** The exact text format of the wallet standard (byte-identical; tested). */
export function createSignInMessageText(input: SignInInput & { address: string }): string {
  let message = `${input.domain} wants you to sign in with your Solana account:\n`;
  message += `${input.address}`;
  if (input.statement) message += `\n\n${input.statement}`;
  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`);
  if (input.requestId) fields.push(`Request ID: ${input.requestId}`);
  if (input.resources) {
    fields.push('Resources:');
    for (const r of input.resources) fields.push(`- ${r}`);
  }
  if (fields.length) message += `\n\n${fields.join('\n')}`;
  return message;
}

// Numbered groups, not named ones: older Hermes builds lack named groups.
const MESSAGE = new RegExp(
  '^([^\\n]+?) wants you to sign in with your Solana account:\\n'
  + '([^\\n]+)(?:\\n|$)'
  + '(?:\\n([\\S\\s]*?)(?:\\n|$))??'
  + '(?:\\nURI: ([^\\n]+))?'
  + '(?:\\nVersion: ([^\\n]+))?'
  + '(?:\\nChain ID: ([^\\n]+))?'
  + '(?:\\nNonce: ([^\\n]+))?'
  + '(?:\\nIssued At: ([^\\n]+))?'
  + '(?:\\nExpiration Time: ([^\\n]+))?'
  + '(?:\\nNot Before: ([^\\n]+))?'
  + '(?:\\nRequest ID: ([^\\n]+))?'
  + '(?:\\nResources:((?:\\n- [^\\n]+)*))?'
  + '\\n*$',
);

export function parseSignInMessageText(text: string): (SignInInput & { address: string }) | null {
  const m = MESSAGE.exec(text);
  if (!m) return null;
  return {
    domain: m[1], address: m[2], statement: m[3], uri: m[4], version: m[5], chainId: m[6],
    nonce: m[7], issuedAt: m[8], expirationTime: m[9], notBefore: m[10], requestId: m[11],
    resources: m[12]?.split('\n- ').slice(1),
  };
}

export interface SignInOutput {
  /** base58 address the wallet signed with */
  address: string;
  signedMessage: Uint8Array;
  signature: Uint8Array;
}

export type VerifyResult =
  | { ok: true; message: string; fields: SignInInput & { address: string } }
  | { ok: false; reason: string };

/**
 * Accept a sign-in only if the signature is valid for the address AND the
 * signed text is the one we asked for (domain, nonce, chain, statement, URI,
 * a fresh Issued At, not expired).
 */
export function verifySignIn(input: SignInInput, out: SignInOutput, now = Date.now()): VerifyResult {
  let pk: Uint8Array;
  try { pk = new PublicKey(out.address).toBytes(); } catch { return { ok: false, reason: 'bad address' }; }
  if (out.signature.length !== 64) return { ok: false, reason: 'bad signature length' };
  let sigOk = false;
  try { sigOk = ed25519.verify(out.signature, out.signedMessage, pk); } catch { sigOk = false; }
  if (!sigOk) return { ok: false, reason: 'signature does not verify' };
  // Buffer, not TextDecoder: Hermes does not ship TextDecoder.
  const message = Buffer.from(out.signedMessage).toString('utf8');
  const f = parseSignInMessageText(message);
  if (!f) return { ok: false, reason: 'not a Sign In With Solana message' };
  if (f.domain !== input.domain) return { ok: false, reason: `domain mismatch (${f.domain})` };
  if (f.address !== out.address) return { ok: false, reason: 'address mismatch' };
  if (input.address && f.address !== input.address) return { ok: false, reason: 'unexpected account' };
  if (!input.nonce || f.nonce !== input.nonce) return { ok: false, reason: 'nonce mismatch' };
  if (input.statement !== undefined && f.statement !== input.statement) return { ok: false, reason: 'statement mismatch' };
  if (input.uri !== undefined && f.uri !== input.uri) return { ok: false, reason: 'uri mismatch' };
  if (f.chainId !== undefined && input.chainId !== undefined && f.chainId !== input.chainId) {
    return { ok: false, reason: `chain mismatch (${f.chainId})` };
  }
  const issued = f.issuedAt ? Date.parse(f.issuedAt) : NaN;
  if (!Number.isFinite(issued) || Math.abs(now - issued) > SIWS_SKEW_MS) return { ok: false, reason: 'stale or missing Issued At' };
  if (f.expirationTime && Date.parse(f.expirationTime) <= now) return { ok: false, reason: 'expired' };
  if (f.notBefore && Date.parse(f.notBefore) > now) return { ok: false, reason: 'not valid yet' };
  return { ok: true, message, fields: f };
}

export const utf8 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'utf8'));

/** Sign a SIWS message locally (the iOS dev wallet; tests). */
export function signInLocally(input: SignInInput, secretKey: Uint8Array): SignInOutput {
  const seed = secretKey.slice(0, 32);
  const pub = ed25519.getPublicKey(seed);
  const address = new PublicKey(pub).toBase58();
  const signedMessage = utf8(createSignInMessageText({ ...input, address }));
  return { address, signedMessage, signature: ed25519.sign(signedMessage, seed) };
}

/** What the app keeps (and shows) about the current sign-in. */
export interface SiwsProof {
  method: 'siws' | 'signMessage' | 'dev-local';
  /** "Seed Vault", the wallet's account label, or "Dev wallet". */
  signer: string;
  address: string;
  domain: string;
  chainId?: string;
  nonce: string;
  issuedAt: string;
  /** base64 of the signature, for display and re-verification */
  signature: string;
  message: string;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
export const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

export function proofOf(method: SiwsProof['method'], signer: string, input: SignInInput, v: Extract<VerifyResult, { ok: true }>, signature: Uint8Array): SiwsProof {
  return {
    method, signer, address: v.fields.address, domain: v.fields.domain, chainId: v.fields.chainId,
    nonce: input.nonce!, issuedAt: v.fields.issuedAt!, signature: b64(signature), message: v.message,
  };
}

/** Re-check a stored proof's signature and fields (on every app start). */
export function recheckProof(p: SiwsProof): boolean {
  const input: SignInInput = { domain: p.domain, nonce: p.nonce, chainId: p.chainId };
  const v = verifySignIn(input, { address: p.address, signedMessage: utf8(p.message), signature: fromB64(p.signature) }, Date.parse(p.issuedAt));
  return v.ok;
}
