#!/usr/bin/env node
/**
 * A fresh, signed trigger payload for simulating `polaris-underwrite`:
 *
 *   pnpm --filter @polaris/cre-workflows payload:underwriting   # writes underwriting/payload.json
 *
 * `simulate:underwriting` runs this first. The workflow rejects a run the
 * account did not sign for (src/underwriting/consent.ts), and a consent is
 * good for 15 minutes, so no static example payload can work.
 *
 * The account's key comes from POLARIS_UNDERWRITE_ACCOUNT_KEY; without it a
 * throwaway key is generated, which underwrites a brand-new account with no
 * history. To bring a history wallet, set POLARIS_UNDERWRITE_WALLET_KEY too.
 * Both are read from the environment or workflows/.env (git-ignored). Use
 * test keys only: this signs with them locally and prints the addresses,
 * never the keys.
 *
 * Options: --out <file> (default underwriting/payload.json), --chain-id <id>
 * (default: underwriting/config.staging.json's recipe.accountChainId, 10143).
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { linkMessage } from "@polarispay/underwriting/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { underwriteConsentMessage } from "../src/underwriting/consent.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_OUT = join(ROOT, "underwriting", "payload.json");

const KEY = /^0x[0-9a-fA-F]{64}$/;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/**
 * The payload `{ user, consent, linked? }`, signed by `accountKey` (and the
 * history wallet's `walletKey`, if any) at `issuedAt`. Pure but for signing.
 */
export async function underwritingPayload({ accountKey, walletKey = null, chainId, issuedAt, nonce = randomBytes(12).toString("base64url") }) {
  if (!KEY.test(accountKey ?? "")) throw new Error("the account key must be 32 bytes of 0x-prefixed hex");
  if (walletKey !== null && !KEY.test(walletKey)) throw new Error("the wallet key must be 32 bytes of 0x-prefixed hex");
  const account = privateKeyToAccount(accountKey);
  const wallet = walletKey ? privateKeyToAccount(walletKey) : null;
  const consentSignature = await account.signMessage({
    message: underwriteConsentMessage({ account: account.address, wallet: wallet?.address ?? null, chainId, issuedAt, nonce }),
  });
  const payload = { user: account.address, consent: { issuedAt, nonce, signature: consentSignature } };
  if (!wallet) return payload;
  const linkSignature = await wallet.signMessage({ message: linkMessage({ account: account.address, wallet: wallet.address, issuedAt, nonce }) });
  return { ...payload, linked: { wallet: wallet.address, issuedAt, nonce, signature: linkSignature } };
}

async function main() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    // no workflows/.env: the environment alone
  }
  const chainId = Number(arg("chain-id") ?? JSON.parse(readFileSync(join(ROOT, "underwriting", "config.staging.json"), "utf8")).recipe.accountChainId);
  const generated = !process.env.POLARIS_UNDERWRITE_ACCOUNT_KEY;
  const payload = await underwritingPayload({
    accountKey: process.env.POLARIS_UNDERWRITE_ACCOUNT_KEY || generatePrivateKey(),
    walletKey: process.env.POLARIS_UNDERWRITE_WALLET_KEY || null,
    chainId,
    issuedAt: Math.floor(Date.now() / 1000),
  });
  const out = arg("out") ?? DEFAULT_OUT;
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Underwriting payload for ${payload.user}${generated ? " (a new throwaway account)" : ""}, chain ${chainId}`);
  if (payload.linked) console.log(`  bringing the history of ${payload.linked.wallet}`);
  console.log(`  consent good for 15 minutes: ${out}`);
}

if (process.argv[1] && /underwriting-payload\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
