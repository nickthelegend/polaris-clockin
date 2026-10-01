// @ts-check
/**
 * Finds a JDK and an Android SDK on this machine; downloads nothing.
 *
 * Bubblewrap's first run offers to download both (a JDK 17 from Adoptium and
 * Google's Android command-line tools into ~/.bubblewrap), and this looks
 * there too, so `npx @bubblewrap/cli@1.25.0 doctor` is the way to get them on
 * a machine that has neither. An Android Studio install already has both.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export class ToolchainError extends Error {}

/**
 * The major version in a JDK's `release` file: JAVA_VERSION="17.0.11" → 17,
 * "1.8.0_402" → 8.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function javaMajorFromRelease(text) {
  const match = /^JAVA_VERSION="([^"]+)"/m.exec(text);
  if (!match) return null;
  const parts = /** @type {string} */ (match[1]).split(/[._+-]/).map(Number);
  const major = parts[0] === 1 ? parts[1] : parts[0];
  return Number.isInteger(major) ? /** @type {number} */ (major) : null;
}

/** @param {string} dir */
function readJavaMajor(dir) {
  const release = path.join(dir, "release");
  if (!existsSync(release)) return null;
  return javaMajorFromRelease(readFileSync(release, "utf8"));
}

/** @param {string} dir @param {NodeJS.Platform} platform */
function javaBinary(dir, platform, name = "java") {
  return path.join(dir, "bin", platform === "win32" ? `${name}.exe` : name);
}

/** @param {string} home */
function bubblewrapConfig(home) {
  const file = path.join(home, ".bubblewrap", "config.json");
  if (!existsSync(file)) return {};
  try {
    return /** @type {{ jdkPath?: string, androidSdkPath?: string }} */ (JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/** @param {string} dir */
function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

/**
 * @typedef {{ env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string }} Host
 * @typedef {{ path: string, source: string }} Candidate
 */

/** @returns {Host} */
export function thisHost() {
  return { env: process.env, platform: process.platform, home: os.homedir() };
}

/**
 * Where to look for a JDK, in order.
 *
 * @param {Host} host
 * @returns {Candidate[]}
 */
export function jdkCandidates({ env, platform, home }) {
  /** @type {Candidate[]} */
  const out = [];
  if (env.POLARIS_ANDROID_JDK) out.push({ path: env.POLARIS_ANDROID_JDK, source: "POLARIS_ANDROID_JDK" });
  if (env.JAVA_HOME) out.push({ path: env.JAVA_HOME, source: "JAVA_HOME" });
  const bubblewrap = bubblewrapConfig(home);
  if (bubblewrap.jdkPath) out.push({ path: bubblewrap.jdkPath, source: "~/.bubblewrap/config.json" });
  for (const dir of subdirs(path.join(home, ".bubblewrap", "jdk"))) out.push({ path: dir, source: "~/.bubblewrap/jdk" });
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")]) {
      if (base) out.push({ path: path.join(base, "Android", "Android Studio", "jbr"), source: "Android Studio" });
    }
  } else if (platform === "darwin") {
    out.push({ path: "/Applications/Android Studio.app/Contents/jbr/Contents/Home", source: "Android Studio" });
  } else {
    out.push({ path: "/opt/android-studio/jbr", source: "Android Studio" });
    out.push({ path: path.join(home, "android-studio", "jbr"), source: "Android Studio" });
  }
  return out;
}

/**
 * The first JDK 17 or later (Gradle 8.11 and Android Gradle Plugin 8.9 need 17).
 *
 * @param {Host} [host]
 * @returns {{ path: string, major: number, source: string, java: string, keytool: string, jarsigner: string }}
 */
export function findJdk(host = thisHost()) {
  const tried = [];
  for (const candidate of jdkCandidates(host)) {
    const major = readJavaMajor(candidate.path);
    const java = javaBinary(candidate.path, host.platform);
    if (major !== null && major >= 17 && existsSync(java)) {
      return {
        ...candidate,
        major,
        java,
        keytool: javaBinary(candidate.path, host.platform, "keytool"),
        jarsigner: javaBinary(candidate.path, host.platform, "jarsigner"),
      };
    }
    tried.push(`${candidate.source}: ${candidate.path}${major === null ? " (no JDK here)" : ` (Java ${major})`}`);
  }
  throw new ToolchainError(
    [
      "No JDK 17 or later found. Tried:",
      ...tried.map((line) => `  - ${line}`),
      "Set POLARIS_ANDROID_JDK (apps/android/.env) to one, or let Bubblewrap download Temurin 17 into ~/.bubblewrap:",
      "  npx @bubblewrap/cli@1.25.0 doctor",
    ].join("\n"),
  );
}

/**
 * Where to look for an Android SDK, in order.
 *
 * @param {Host} host
 * @returns {Candidate[]}
 */
export function sdkCandidates({ env, platform, home }) {
  /** @type {Candidate[]} */
  const out = [];
  if (env.POLARIS_ANDROID_SDK) out.push({ path: env.POLARIS_ANDROID_SDK, source: "POLARIS_ANDROID_SDK" });
  if (env.ANDROID_HOME) out.push({ path: env.ANDROID_HOME, source: "ANDROID_HOME" });
  if (env.ANDROID_SDK_ROOT) out.push({ path: env.ANDROID_SDK_ROOT, source: "ANDROID_SDK_ROOT" });
  const bubblewrap = bubblewrapConfig(home);
  if (bubblewrap.androidSdkPath) out.push({ path: bubblewrap.androidSdkPath, source: "~/.bubblewrap/config.json" });
  out.push({ path: path.join(home, ".bubblewrap", "android_sdk"), source: "~/.bubblewrap/android_sdk" });
  if (platform === "win32") {
    if (env.LOCALAPPDATA) out.push({ path: path.join(env.LOCALAPPDATA, "Android", "Sdk"), source: "Android Studio" });
  } else if (platform === "darwin") {
    out.push({ path: path.join(home, "Library", "Android", "sdk"), source: "Android Studio" });
  } else {
    out.push({ path: path.join(home, "Android", "Sdk"), source: "Android Studio" });
  }
  return out;
}

/**
 * Compares Android build-tools versions ("36.1.0", "35.0.0-rc1").
 *
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    if (x === undefined) return 1; // "36.0.0" is after "36.0.0-rc1"
    if (y === undefined) return -1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The newest build-tools that has what a signed build needs (zipalign,
 * apksigner, aapt2), at 34 or later.
 *
 * @param {string} sdk
 * @param {NodeJS.Platform} platform
 * @returns {{ version: string, dir: string, zipalign: string, apksignerJar: string, aapt2: string } | null}
 */
export function pickBuildTools(sdk, platform) {
  const exe = platform === "win32" ? ".exe" : "";
  const versions = subdirs(path.join(sdk, "build-tools"))
    .map((dir) => path.basename(dir))
    .filter((version) => Number(version.split(".")[0]) >= 34)
    .sort(compareVersions)
    .reverse();
  for (const version of versions) {
    const dir = path.join(sdk, "build-tools", version);
    const tools = {
      version,
      dir,
      zipalign: path.join(dir, `zipalign${exe}`),
      apksignerJar: path.join(dir, "lib", "apksigner.jar"),
      aapt2: path.join(dir, `aapt2${exe}`),
    };
    if (existsSync(tools.zipalign) && existsSync(tools.apksignerJar) && existsSync(tools.aapt2)) return tools;
  }
  return null;
}

/**
 * The first Android SDK with usable build-tools.
 *
 * @param {Host} [host]
 */
export function findAndroidSdk(host = thisHost()) {
  const tried = [];
  for (const candidate of sdkCandidates(host)) {
    if (!existsSync(candidate.path)) {
      tried.push(`${candidate.source}: ${candidate.path} (missing)`);
      continue;
    }
    const buildTools = pickBuildTools(candidate.path, host.platform);
    if (buildTools) {
      const platforms = subdirs(path.join(candidate.path, "platforms")).map((dir) => path.basename(dir));
      return { ...candidate, buildTools, platforms };
    }
    tried.push(`${candidate.source}: ${candidate.path} (no build-tools 34+ with zipalign, apksigner and aapt2)`);
  }
  throw new ToolchainError(
    [
      "No Android SDK with build-tools 34 or later found. Tried:",
      ...tried.map((line) => `  - ${line}`),
      "Set POLARIS_ANDROID_SDK or ANDROID_HOME, or let Bubblewrap download Google's command-line tools into ~/.bubblewrap:",
      "  npx @bubblewrap/cli@1.25.0 doctor",
    ].join("\n"),
  );
}

/**
 * The compileSdk the generated project asks for (app/build.gradle).
 *
 * @param {string} buildGradle
 * @returns {number | null}
 */
export function compileSdkOf(buildGradle) {
  const match = /compileSdk(?:Version)?\s*=?\s*(\d+)/.exec(buildGradle);
  return match ? Number(match[1]) : null;
}
