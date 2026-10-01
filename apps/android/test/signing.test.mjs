import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEBUG_ALIAS,
  formatFingerprint,
  parseApksignerSha256,
  parseKeytoolSha256,
  resolveSigning,
  signingEnv,
} from "../scripts/lib/signing.mjs";

/** The signing key: a configured one from the environment, or a local debug key made once. */

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "polaris-android-sign-"));
const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

describe("resolveSigning: a configured key", () => {
  it("needs an alias and a password, and a keystore that exists", () => {
    const dir = tmp();
    const keystore = path.join(dir, "upload.jks");
    writeFileSync(keystore, "");
    assert.throws(() => resolveSigning({ POLARIS_ANDROID_KEYSTORE: keystore }, dir), /POLARIS_ANDROID_KEY_ALIAS/);
    assert.throws(() => resolveSigning({ POLARIS_ANDROID_KEYSTORE: keystore, POLARIS_ANDROID_KEY_ALIAS: "upload" }, dir), /POLARIS_ANDROID_KEYSTORE_PASSWORD/);
    assert.throws(
      () => resolveSigning({ POLARIS_ANDROID_KEYSTORE: path.join(dir, "missing.jks"), POLARIS_ANDROID_KEY_ALIAS: "upload", POLARIS_ANDROID_KEYSTORE_PASSWORD: "x" }, dir),
      /no file at/,
    );
  });

  it("uses the store password for the key unless one is given", () => {
    const dir = tmp();
    const keystore = path.join(dir, "upload.jks");
    writeFileSync(keystore, "");
    const env = { POLARIS_ANDROID_KEYSTORE: keystore, POLARIS_ANDROID_KEY_ALIAS: "upload", POLARIS_ANDROID_KEYSTORE_PASSWORD: "store-pw" };
    const signing = resolveSigning(env, dir);
    assert.equal(signing.kind, "configured");
    assert.equal(signing.create, false);
    assert.equal(signing.keyPassword, "store-pw");
    assert.equal(resolveSigning({ ...env, POLARIS_ANDROID_KEY_PASSWORD: "key-pw" }, dir).keyPassword, "key-pw");
  });
});

describe("resolveSigning: the local debug key", () => {
  it("is made on first use, with a fresh random password", () => {
    const dir = tmp();
    const a = resolveSigning({}, dir);
    const b = resolveSigning({}, dir);
    assert.equal(a.kind, "debug");
    assert.equal(a.create, true);
    assert.equal(a.alias, DEBUG_ALIAS);
    assert.equal(a.keystore, path.join(dir, "polaris-debug.keystore"));
    assert.equal(a.passwordFile, path.join(dir, "polaris-debug.env"));
    assert.match(a.storePassword, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(a.keyPassword, a.storePassword, "a PKCS12 store has one password");
    assert.notEqual(a.storePassword, b.storePassword);
  });

  it("is reused with its saved password", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "polaris-debug.keystore"), "");
    writeFileSync(path.join(dir, "polaris-debug.env"), "# saved\nPOLARIS_ANDROID_KEYSTORE_PASSWORD=saved-pw\n");
    const signing = resolveSigning({}, dir);
    assert.equal(signing.create, false);
    assert.equal(signing.storePassword, "saved-pw");
  });

  it("refuses a keystore whose password is gone rather than make a second key silently", () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "polaris-debug.keystore"), "");
    assert.throws(() => resolveSigning({}, dir), /password file .* does not/);
  });
});

describe("signingEnv", () => {
  it("carries the passwords in the child's environment only", () => {
    const env = signingEnv({ kind: "debug", keystore: "k", alias: "a", storePassword: "s", keyPassword: "p", create: false }, { PATH: "/bin" });
    assert.deepEqual(env, { PATH: "/bin", POLARIS_SIGN_STORE_PASS: "s", POLARIS_SIGN_KEY_PASS: "p" });
  });
});

describe("fingerprints", () => {
  it("formats a SHA-256 the way assetlinks.json wants it", () => {
    assert.equal(formatFingerprint(FP.replaceAll(":", "").toLowerCase()), FP);
    assert.equal(formatFingerprint(FP.toLowerCase()), FP);
    assert.throws(() => formatFingerprint("DA:39:A3"), /not a SHA-256/);
  });

  it("reads keytool -list -v", () => {
    const output = [
      "Alias name: polaris-debug",
      "Certificate fingerprints:",
      "\t SHA1: DA:39:A3:EE:5E:6B:4B:0D:32:55:BF:EF:95:60:18:90:AF:D8:07:09",
      `\t SHA256: ${FP}`,
      "Signature algorithm name: SHA384withRSA",
    ].join("\n");
    assert.equal(parseKeytoolSha256(output), FP);
    assert.throws(() => parseKeytoolSha256("nothing"), /no SHA-256/);
  });

  it("reads apksigner verify --print-certs", () => {
    const output = [
      "Verifies",
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Signer #1 certificate DN: CN=Polaris local debug, OU=Development, O=Polaris",
      `Signer #1 certificate SHA-256 digest: ${FP.replaceAll(":", "").toLowerCase()}`,
      "Signer #1 certificate SHA-1 digest: da39a3ee5e6b4b0d3255bfef95601890afd80709",
    ].join("\n");
    assert.deepEqual(parseApksignerSha256(output), [FP]);
    assert.throws(() => parseApksignerSha256("Verifies"), /no SHA-256/);
  });
});
