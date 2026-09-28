import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  compareVersions,
  compileSdkOf,
  findAndroidSdk,
  findJdk,
  javaMajorFromRelease,
  jdkCandidates,
  pickBuildTools,
  sdkCandidates,
  ToolchainError,
} from "../scripts/lib/toolchain.mjs";

/** Finding a JDK and an Android SDK without downloading anything. */

const platform = process.platform;
const exe = platform === "win32" ? ".exe" : "";
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "polaris-android-tc-"));

/** @param {string} dir @param {string} version */
function fakeJdk(dir, version) {
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, "release"), `IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="${version}"\n`);
  writeFileSync(path.join(dir, "bin", `java${exe}`), "");
  return dir;
}

/** @param {string} sdk @param {string} version @param {{ aapt2?: boolean }} [opts] */
function fakeBuildTools(sdk, version, { aapt2 = true } = {}) {
  const dir = path.join(sdk, "build-tools", version);
  mkdirSync(path.join(dir, "lib"), { recursive: true });
  writeFileSync(path.join(dir, `zipalign${exe}`), "");
  writeFileSync(path.join(dir, "lib", "apksigner.jar"), "");
  if (aapt2) writeFileSync(path.join(dir, `aapt2${exe}`), "");
}

describe("javaMajorFromRelease", () => {
  it("reads the major version from a JDK's release file", () => {
    assert.equal(javaMajorFromRelease('JAVA_VERSION="17.0.11"'), 17);
    assert.equal(javaMajorFromRelease('IMPLEMENTOR="JetBrains"\nJAVA_VERSION="21.0.8"\n'), 21);
    assert.equal(javaMajorFromRelease('JAVA_VERSION="1.8.0_402"'), 8);
    assert.equal(javaMajorFromRelease("no version here"), null);
  });
});

describe("compareVersions", () => {
  it("orders build-tools versions, a release after its release candidates", () => {
    const sorted = ["36.1.0", "34.0.0", "35.0.0-rc1", "35.0.0", "36.0.0"].sort(compareVersions);
    assert.deepEqual(sorted, ["34.0.0", "35.0.0-rc1", "35.0.0", "36.0.0", "36.1.0"]);
  });
});

describe("pickBuildTools", () => {
  it("takes the newest complete build-tools at 34 or later", () => {
    const sdk = tmp();
    fakeBuildTools(sdk, "33.0.2");
    fakeBuildTools(sdk, "35.0.0");
    fakeBuildTools(sdk, "36.1.0", { aapt2: false });
    const tools = pickBuildTools(sdk, platform);
    assert.equal(tools?.version, "35.0.0");
    assert.equal(tools?.apksignerJar, path.join(sdk, "build-tools", "35.0.0", "lib", "apksigner.jar"));
  });

  it("is null without one", () => {
    const sdk = tmp();
    fakeBuildTools(sdk, "30.0.3");
    assert.equal(pickBuildTools(sdk, platform), null);
  });
});

describe("candidates", () => {
  it("looks at the override, then JAVA_HOME, then Bubblewrap's config and JDKs", () => {
    const home = tmp();
    mkdirSync(path.join(home, ".bubblewrap", "jdk", "jdk-17.0.11+9"), { recursive: true });
    writeFileSync(path.join(home, ".bubblewrap", "config.json"), JSON.stringify({ jdkPath: "/bw/jdk", androidSdkPath: "/bw/sdk" }));
    const env = { POLARIS_ANDROID_JDK: "/override", JAVA_HOME: "/java-home", POLARIS_ANDROID_SDK: "/sdk-override", ANDROID_HOME: "/android-home" };
    const jdks = jdkCandidates({ env, platform: "linux", home }).map((c) => c.source);
    assert.deepEqual(jdks.slice(0, 4), ["POLARIS_ANDROID_JDK", "JAVA_HOME", "~/.bubblewrap/config.json", "~/.bubblewrap/jdk"]);
    const sdks = sdkCandidates({ env, platform: "linux", home });
    assert.deepEqual(
      sdks.map((c) => c.path).slice(0, 4),
      ["/sdk-override", "/android-home", "/bw/sdk", path.join(home, ".bubblewrap", "android_sdk")],
    );
  });

  it("knows Android Studio's defaults on each platform", () => {
    const home = tmp();
    const win = sdkCandidates({ env: { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, platform: "win32", home });
    assert.equal(win.at(-1)?.path, path.join("C:\\Users\\a\\AppData\\Local", "Android", "Sdk"));
    assert.equal(sdkCandidates({ env: {}, platform: "darwin", home }).at(-1)?.path, path.join(home, "Library", "Android", "sdk"));
  });
});

describe("findJdk", () => {
  it("takes the first JDK 17 or later and skips older ones", () => {
    const home = tmp();
    const old = fakeJdk(path.join(home, "jdk11"), "11.0.2");
    const good = fakeJdk(path.join(home, "jdk21"), "21.0.8");
    const jdk = findJdk({ env: { POLARIS_ANDROID_JDK: old, JAVA_HOME: good }, platform, home });
    assert.equal(jdk.path, good);
    assert.equal(jdk.major, 21);
    assert.equal(jdk.source, "JAVA_HOME");
    assert.equal(jdk.keytool, path.join(good, "bin", `keytool${exe}`));
  });

  it("says what it tried and how to get one", () => {
    const home = tmp();
    const old = fakeJdk(path.join(home, "jdk11"), "11.0.2");
    assert.throws(
      () => findJdk({ env: { POLARIS_ANDROID_JDK: old }, platform: "linux", home }),
      (error) => error instanceof ToolchainError && /Java 11/.test(error.message) && /bubblewrap\/cli@1\.25\.0 doctor/.test(error.message),
    );
  });
});

describe("findAndroidSdk", () => {
  it("takes the first SDK with usable build-tools, and lists its platforms", () => {
    const home = tmp();
    const empty = path.join(home, "empty-sdk");
    mkdirSync(empty);
    const sdk = path.join(home, "sdk");
    fakeBuildTools(sdk, "36.1.0");
    mkdirSync(path.join(sdk, "platforms", "android-36"), { recursive: true });
    const found = findAndroidSdk({ env: { POLARIS_ANDROID_SDK: empty, ANDROID_HOME: sdk }, platform, home });
    assert.equal(found.path, sdk);
    assert.equal(found.buildTools.version, "36.1.0");
    assert.deepEqual(found.platforms, ["android-36"]);
  });

  it("fails with what it tried", () => {
    const home = tmp();
    assert.throws(() => findAndroidSdk({ env: {}, platform: "linux", home }), (error) => error instanceof ToolchainError && /Tried:/.test(error.message));
  });
});

describe("compileSdkOf", () => {
  it("reads Bubblewrap's compileSdkVersion and the newer compileSdk =", () => {
    assert.equal(compileSdkOf("android {\n    compileSdkVersion 36\n"), 36);
    assert.equal(compileSdkOf("android {\n    compileSdk = 35\n"), 35);
    assert.equal(compileSdkOf("nothing"), null);
  });
});
