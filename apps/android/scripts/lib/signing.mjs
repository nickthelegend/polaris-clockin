// @ts-check
/**
 * The key the APK is signed with.
 *
 * - Configured: POLARIS_ANDROID_KEYSTORE, POLARIS_ANDROID_KEY_ALIAS,
 *   POLARIS_ANDROID_KEYSTORE_PASSWORD and (optionally, else the same)
 *   POLARIS_ANDROID_KEY_PASSWORD, from the shell or apps/android/.env.
 * - Otherwise a local debug key: .keys/polaris-debug.keystore, made on the
 *   first build with a random password kept beside it in
 *   .keys/polaris-debug.env. Both are git-ignored and never printed.
 *
 * Passwords reach keytool, apksigner and jarsigner through the child's
 * environment (`:env` / `env:`), never its command line.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseEnv } from "./env.mjs";
import { run } from "./run.mjs";

export const DEBUG_ALIAS = "polaris-debug";

/**
 * @typedef {{
 *   kind: "debug" | "configured",
 *   keystore: string,
 *   alias: string,
 *   storePassword: string,
 *   keyPassword: string,
 *   create: boolean,
 *   passwordFile?: string,
 * }} Signing
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} keysDir where the debug key lives
 * @returns {Signing}
 */
export function resolveSigning(env, keysDir) {
  const keystore = env.POLARIS_ANDROID_KEYSTORE?.trim();
  if (keystore) {
    const alias = env.POLARIS_ANDROID_KEY_ALIAS?.trim();
    const storePassword = env.POLARIS_ANDROID_KEYSTORE_PASSWORD;
    if (!alias) throw new Error("POLARIS_ANDROID_KEYSTORE is set: set POLARIS_ANDROID_KEY_ALIAS too");
    if (!storePassword) throw new Error("POLARIS_ANDROID_KEYSTORE is set: set POLARIS_ANDROID_KEYSTORE_PASSWORD too");
    if (!existsSync(keystore)) throw new Error(`POLARIS_ANDROID_KEYSTORE: no file at ${keystore}`);
    return {
      kind: "configured",
      keystore: path.resolve(keystore),
      alias,
      storePassword,
      keyPassword: env.POLARIS_ANDROID_KEY_PASSWORD || storePassword,
      create: false,
    };
  }

  const debugKeystore = path.join(keysDir, `${DEBUG_ALIAS}.keystore`);
  const passwordFile = path.join(keysDir, `${DEBUG_ALIAS}.env`);
  if (existsSync(debugKeystore)) {
    if (!existsSync(passwordFile)) {
      throw new Error(
        `${debugKeystore} exists but its password file ${passwordFile} does not. ` +
          "Delete the keystore to make a new debug key (the app's fingerprint, and so assetlinks.json, changes).",
      );
    }
    const saved = parseEnv(readFileSync(passwordFile, "utf8"));
    const storePassword = saved.POLARIS_ANDROID_KEYSTORE_PASSWORD;
    if (!storePassword) throw new Error(`${passwordFile} has no POLARIS_ANDROID_KEYSTORE_PASSWORD`);
    return { kind: "debug", keystore: debugKeystore, alias: DEBUG_ALIAS, storePassword, keyPassword: storePassword, create: false, passwordFile };
  }

  // A PKCS12 keystore has one password for the store and its key.
  const password = randomBytes(24).toString("base64url");
  return { kind: "debug", keystore: debugKeystore, alias: DEBUG_ALIAS, storePassword: password, keyPassword: password, create: true, passwordFile };
}

/**
 * The child environment that carries the passwords.
 *
 * @param {Signing} signing
 * @param {NodeJS.ProcessEnv} [base]
 */
export function signingEnv(signing, base = process.env) {
  return { ...base, POLARIS_SIGN_STORE_PASS: signing.storePassword, POLARIS_SIGN_KEY_PASS: signing.keyPassword };
}

/**
 * Makes the local debug key with keytool, and saves its password beside it.
 *
 * @param {Signing} signing
 * @param {{ keytool: string }} jdk
 */
export async function createDebugKeystore(signing, jdk) {
  if (!signing.create || !signing.passwordFile) throw new Error("only a new debug key is created here");
  mkdirSync(path.dirname(signing.keystore), { recursive: true });
  await run(
    jdk.keytool,
    [
      "-genkeypair",
      "-noprompt",
      "-keystore", signing.keystore,
      "-storetype", "PKCS12",
      "-alias", signing.alias,
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", "10000",
      "-dname", "CN=Polaris local debug, OU=Development, O=Polaris",
      "-storepass:env", "POLARIS_SIGN_STORE_PASS",
      "-keypass:env", "POLARIS_SIGN_KEY_PASS",
    ],
    { env: signingEnv(signing), capture: true, label: "keytool -genkeypair" },
  );
  writeFileSync(
    signing.passwordFile,
    [
      "# The local debug key's password (made by `pnpm --filter @polaris/android build`).",
      "# Git-ignored. Lose it and the key is useless: delete the keystore to make a new one.",
      `POLARIS_ANDROID_KEYSTORE_PASSWORD=${signing.storePassword}`,
      `POLARIS_ANDROID_KEY_ALIAS=${signing.alias}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  try {
    chmodSync(signing.passwordFile, 0o600);
  } catch {
    // Windows keeps its own ACLs.
  }
}

/**
 * "146de983…" or "14:6d:…" → "14:6D:E9:…", the form assetlinks.json uses.
 *
 * @param {string} value
 */
export function formatFingerprint(value) {
  const hex = value.replaceAll(":", "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("not a SHA-256 fingerprint");
  return /** @type {string[]} */ (hex.toUpperCase().match(/.{2}/g)).join(":");
}

/**
 * The SHA-256 line of `keytool -list -v`.
 *
 * @param {string} output
 */
export function parseKeytoolSha256(output) {
  const match = /SHA-?256:\s*([0-9A-Fa-f:]{95})/.exec(output);
  if (!match) throw new Error("keytool printed no SHA-256 certificate fingerprint");
  return formatFingerprint(/** @type {string} */ (match[1]));
}

/**
 * Every signer's SHA-256 in `apksigner verify --print-certs`.
 *
 * @param {string} output
 */
export function parseApksignerSha256(output) {
  const found = [...output.matchAll(/certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/g)].map((m) => formatFingerprint(/** @type {string} */ (m[1])));
  if (found.length === 0) throw new Error("apksigner printed no SHA-256 certificate digest");
  return [...new Set(found)];
}

/**
 * The SHA-256 fingerprint of the signing key's certificate.
 *
 * @param {Signing} signing
 * @param {{ keytool: string }} jdk
 */
export async function keystoreFingerprint(signing, jdk) {
  const output = await run(
    jdk.keytool,
    ["-list", "-v", "-keystore", signing.keystore, "-alias", signing.alias, "-storepass:env", "POLARIS_SIGN_STORE_PASS"],
    { env: signingEnv(signing), capture: true, label: "keytool -list" },
  );
  return parseKeytoolSha256(output);
}
