#!/usr/bin/env node
// @ts-check
/**
 * pnpm --filter @polaris/android build [-- --bundle]
 *
 * Builds a signed APK of the Polaris Trusted Web Activity (and, with
 * --bundle, a signed Android App Bundle for Google Play). The same steps as
 * `bubblewrap build` (Gradle's assembleRelease, zipalign, apksigner), run
 * here so that:
 *
 * - it works with any Android Studio or Bubblewrap SDK layout, found without
 *   a Bubblewrap config (lib/toolchain.mjs);
 * - passwords reach apksigner, jarsigner and keytool through the environment,
 *   never a command line;
 * - without a configured key it makes a local debug key once (lib/signing.mjs).
 *
 * It regenerates the project first when twa-manifest.json changed since the
 * last generation, or POLARIS_ANDROID_APP_URL names another host.
 *
 * Output (git-ignored): dist/polaris-<version>-<debug|release>.apk (.aab),
 * and dist/build.json with each file's size and SHA-256, the signer's
 * certificate fingerprint, and what aapt2 reads from the APK.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BUBBLEWRAP_CLI, generate, readManifest } from "./generate.mjs";
import { inspectApk, printSummary } from "./inspect.mjs";
import { loadEnvFile } from "./lib/env.mjs";
import { ANDROID_DIR, DIST_DIR, ENV_FILE, KEYS_DIR, MANIFEST_CHECKSUM, TOOLCHAIN_DIR, TWA_MANIFEST } from "./lib/paths.mjs";
import { run } from "./lib/run.mjs";
import { createDebugKeystore, keystoreFingerprint, parseApksignerSha256, resolveSigning, signingEnv } from "./lib/signing.mjs";
import { manifestChecksum, resolveAppUrl, targetOf } from "./lib/target.mjs";
import { compileSdkOf, findAndroidSdk, findJdk, ToolchainError } from "./lib/toolchain.mjs";

const UNSIGNED_APK = path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk");
const UNSIGNED_AAB = path.join(ANDROID_DIR, "app", "build", "outputs", "bundle", "release", "app-release.aab");

/** Why the project has to be generated again, or null. */
function staleReason() {
  if (!existsSync(path.join(ANDROID_DIR, "app", "build.gradle"))) return "the Android project has not been generated";
  if (!existsSync(MANIFEST_CHECKSUM)) return "manifest-checksum.txt is missing";
  if (readFileSync(MANIFEST_CHECKSUM, "utf8").trim() !== manifestChecksum(readFileSync(TWA_MANIFEST))) {
    return "twa-manifest.json changed since the project was generated";
  }
  if (process.env.POLARIS_ANDROID_APP_URL) {
    const wanted = resolveAppUrl(process.env.POLARIS_ANDROID_APP_URL);
    const current = targetOf(readManifest());
    if (wanted.host !== current.host || wanted.startUrl !== current.startUrl) {
      return `POLARIS_ANDROID_APP_URL is https://${wanted.host}${wanted.startUrl}`;
    }
  }
  return null;
}

/** @param {string} file */
function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** @param {string} file */
function describeFile(file) {
  return { file: path.relative(ANDROID_DIR, file).split(path.sep).join("/"), bytes: statSync(file).size, sha256: sha256File(file) };
}

/** @param {number} bytes */
function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** The Gradle version the wrapper pins. */
function gradleVersion() {
  const file = path.join(ANDROID_DIR, "gradle", "wrapper", "gradle-wrapper.properties");
  return /gradle-([\d.]+)-(?:bin|all)\.zip/.exec(readFileSync(file, "utf8"))?.[1] ?? "unknown";
}

export async function build({ bundle = false } = {}) {
  loadEnvFile(ENV_FILE);

  const stale = staleReason();
  if (stale) {
    console.log(`Regenerating first: ${stale}.`);
    await generate();
  }
  const manifest = readManifest();

  const jdk = findJdk();
  const sdk = findAndroidSdk();
  console.log(`JDK ${jdk.major} (${jdk.source}): ${jdk.path}`);
  console.log(`Android SDK (${sdk.source}): ${sdk.path}, build-tools ${sdk.buildTools.version}`);
  const compileSdk = compileSdkOf(readFileSync(path.join(ANDROID_DIR, "app", "build.gradle"), "utf8"));
  if (compileSdk && !sdk.platforms.includes(`android-${compileSdk}`)) {
    console.warn(
      `The project compiles against android-${compileSdk}, which this SDK doesn't have; Gradle will try to download it ` +
        `(the SDK's licences must be accepted: sdkmanager --licenses).`,
    );
  }

  const signing = resolveSigning(process.env, KEYS_DIR);
  if (signing.create) {
    console.log(`Making a local debug key: ${path.relative(ANDROID_DIR, signing.keystore)} (password in ${path.relative(ANDROID_DIR, signing.passwordFile ?? "")}, git-ignored)`);
    await createDebugKeystore(signing, jdk);
  }
  const certificate = await keystoreFingerprint(signing, jdk);
  console.log(`Signing with the ${signing.kind === "debug" ? "local debug" : "configured"} key "${signing.alias}", certificate SHA-256 ${certificate}`);

  // Gradle: the found JDK and SDK, and a Gradle home on this drive unless one is set.
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(TOOLCHAIN_DIR, "gradle");
  /** @type {NodeJS.ProcessEnv} */
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: jdk.path,
    ANDROID_HOME: sdk.path,
    GRADLE_USER_HOME: gradleHome,
    PATH: `${path.join(jdk.path, "bin")}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
  };
  delete gradleEnv.ANDROID_SDK_ROOT;
  if (process.platform === "win32") delete gradleEnv.Path;
  rmSync(UNSIGNED_APK, { force: true });
  rmSync(UNSIGNED_AAB, { force: true });
  const tasks = ["assembleRelease", ...(bundle ? ["bundleRelease"] : [])];
  console.log(`gradlew ${tasks.join(" ")} (Gradle ${gradleVersion()}, GRADLE_USER_HOME ${gradleHome})`);
  await run(
    process.platform === "win32" ? path.join(ANDROID_DIR, "gradlew.bat") : path.join(ANDROID_DIR, "gradlew"),
    [...tasks, "--no-daemon", "--console=plain", "--stacktrace"],
    { cwd: ANDROID_DIR, env: gradleEnv, label: "gradlew" },
  );
  if (!existsSync(UNSIGNED_APK)) throw new Error(`Gradle finished but ${UNSIGNED_APK} is missing`);

  const kind = signing.kind === "debug" ? "debug" : "release";
  const base = `polaris-${manifest.appVersion ?? manifest.appVersionCode}-${kind}`;
  mkdirSync(DIST_DIR, { recursive: true });
  const aligned = path.join(TOOLCHAIN_DIR, "app-release-aligned.apk");
  const apk = path.join(DIST_DIR, `${base}.apk`);
  rmSync(apk, { force: true });
  await run(sdk.buildTools.zipalign, ["-f", "-p", "4", UNSIGNED_APK, aligned], { capture: true, label: "zipalign" });
  const env = signingEnv(signing, gradleEnv);
  const apksigner = ["-Xmx1024M", "-jar", sdk.buildTools.apksignerJar];
  await run(
    jdk.java,
    [
      ...apksigner,
      "sign",
      "--ks", signing.keystore,
      "--ks-key-alias", signing.alias,
      "--ks-pass", "env:POLARIS_SIGN_STORE_PASS",
      "--key-pass", "env:POLARIS_SIGN_KEY_PASS",
      "--out", apk,
      aligned,
    ],
    { env, label: "apksigner sign" },
  );
  rmSync(`${apk}.idsig`, { force: true });
  const verified = await run(jdk.java, [...apksigner, "verify", "--verbose", "--print-certs", apk], { env: gradleEnv, capture: true, label: "apksigner verify" });
  const signers = parseApksignerSha256(verified);
  if (!signers.includes(certificate)) throw new Error("The APK's signer is not the key it was signed with");
  const schemes = [...verified.matchAll(/Verified using (v[\d.]+) scheme \(([^)]+)\): true/g)].map((m) => m[1]);

  /** @type {ReturnType<typeof describeFile> | undefined} */
  let aabRecord;
  if (bundle) {
    if (!existsSync(UNSIGNED_AAB)) throw new Error(`Gradle finished but ${UNSIGNED_AAB} is missing`);
    const aab = path.join(DIST_DIR, `${base}.aab`);
    copyFileSync(UNSIGNED_AAB, aab);
    await run(
      jdk.jarsigner,
      ["-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", "-keystore", signing.keystore, "-storepass:env", "POLARIS_SIGN_STORE_PASS", "-keypass:env", "POLARIS_SIGN_KEY_PASS", aab, signing.alias],
      { env, capture: true, label: "jarsigner" },
    );
    aabRecord = describeFile(aab);
  }

  const summary = await inspectApk(apk);
  const apkRecord = describeFile(apk);
  const record = {
    builtAt: new Date().toISOString(),
    apk: { ...apkRecord, signatureSchemes: schemes },
    ...(aabRecord ? { aab: aabRecord } : {}),
    packageId: manifest.packageId,
    versionName: manifest.appVersion,
    versionCode: manifest.appVersionCode,
    opens: `https://${manifest.host}${manifest.startUrl}`,
    signing: { kind: signing.kind, alias: signing.alias, certificateSha256: certificate },
    toolchain: {
      generator: BUBBLEWRAP_CLI,
      gradle: gradleVersion(),
      jdk: `${jdk.major} (${jdk.source})`,
      buildTools: sdk.buildTools.version,
    },
    aapt2: summary,
  };
  writeFileSync(path.join(DIST_DIR, "build.json"), `${JSON.stringify(record, null, 2)}\n`);

  console.log("");
  console.log(`APK   ${apkRecord.file}`);
  console.log(`      ${formatBytes(apkRecord.bytes)} (${apkRecord.bytes} bytes), SHA-256 ${apkRecord.sha256}`);
  console.log(`      signed ${schemes.join(", ") || "(schemes not reported)"} by ${certificate}`);
  if (aabRecord) console.log(`AAB   ${aabRecord.file}, ${formatBytes(aabRecord.bytes)}, SHA-256 ${aabRecord.sha256}`);
  console.log("");
  printSummary(summary);
  console.log("");
  console.log(`Install on a phone (USB debugging on): adb install -r ${apkRecord.file}`);
  console.log(`Verify the app on https://${manifest.host}: set this on the app's server, then check /.well-known/assetlinks.json`);
  console.log(`  POLARIS_ANDROID_SHA256_FINGERPRINTS=${certificate}`);
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  build({ bundle: process.argv.includes("--bundle") }).catch((error) => {
    console.error(error instanceof ToolchainError ? error.message : error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
