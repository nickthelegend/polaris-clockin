#!/usr/bin/env node
// @ts-check
/**
 * pnpm --filter @polaris/android fingerprint
 *
 * The SHA-256 fingerprint of the certificate the app is signed with (the
 * configured key, or the local debug key), read with `keytool -list -v`, and
 * what to set on the app's server so /.well-known/assetlinks.json vouches for
 * the app. Prints no password. Makes no key: run `build` first for the debug key.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { readManifest } from "./generate.mjs";
import { loadEnvFile } from "./lib/env.mjs";
import { ANDROID_DIR, ENV_FILE, KEYS_DIR } from "./lib/paths.mjs";
import { keystoreFingerprint, resolveSigning } from "./lib/signing.mjs";
import { findJdk } from "./lib/toolchain.mjs";

export async function fingerprint() {
  loadEnvFile(ENV_FILE);
  const signing = resolveSigning(process.env, KEYS_DIR);
  if (signing.create) {
    throw new Error("There is no signing key yet: `pnpm --filter @polaris/android build` makes the local debug key.");
  }
  const sha256 = await keystoreFingerprint(signing, findJdk());
  const manifest = readManifest();
  const where = signing.kind === "debug" ? path.relative(ANDROID_DIR, signing.keystore) : signing.keystore;
  console.log(`${signing.kind === "debug" ? "Local debug" : "Configured"} key "${signing.alias}" (${where})`);
  console.log(`SHA-256 ${sha256}`);
  console.log("");
  console.log(`On the server of https://${manifest.host} (apps/app), so /.well-known/assetlinks.json lists ${manifest.packageId}:`);
  console.log(`  POLARIS_ANDROID_SHA256_FINGERPRINTS=${sha256}`);
  if (manifest.packageId !== "app.polarispay.twa") console.log(`  POLARIS_ANDROID_PACKAGE=${manifest.packageId}`);
  console.log("Add Google Play's app signing key's fingerprint too, comma-separated, once the app is on Play.");
  return sha256;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  fingerprint().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
