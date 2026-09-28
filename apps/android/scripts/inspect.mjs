#!/usr/bin/env node
// @ts-check
/**
 * pnpm --filter @polaris/android inspect [-- <apk>] [-- --out <dir>]
 *
 * Reads a built APK with the Android SDK's aapt2 and prints what Android will
 * see: the package, its version and SDK levels, the launcher activity, the URL
 * the Trusted Web Activity opens (the DEFAULT_URL meta-data, resolved), the
 * host its verified link intent filter claims, and the Digital Asset Links
 * statement the app declares. With --out, it also writes aapt2's raw dumps
 * (badging, the manifest tree) and the summary there.
 *
 * Without an APK argument it reads the one the last build recorded
 * (dist/build.json).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvFile } from "./lib/env.mjs";
import { ANDROID_DIR, DIST_DIR, ENV_FILE } from "./lib/paths.mjs";
import { run } from "./lib/run.mjs";
import { findAndroidSdk } from "./lib/toolchain.mjs";

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/**
 * `aapt2 dump badging`: package, versions, SDK levels, launcher, label.
 *
 * @param {string} text
 */
export function parseBadging(text) {
  /** @param {RegExp} re */
  const one = (re) => re.exec(text)?.[1] ?? null;
  return {
    packageName: one(/^package: name='([^']+)'/m),
    versionCode: one(/^package: .*versionCode='([^']+)'/m),
    versionName: one(/^package: .*versionName='([^']*)'/m),
    minSdk: one(/^(?:sdkVersion|minSdkVersion):'([^']+)'/m),
    targetSdk: one(/^targetSdkVersion:'([^']+)'/m),
    launchableActivity: one(/^launchable-activity: name='([^']+)'/m),
    label: one(/^application-label:'([^']*)'/m),
  };
}

/**
 * `aapt2 dump resources`: every string and bool resource, by id and by name.
 *
 * @param {string} text
 * @returns {{ byId: Map<string, string>, byName: Map<string, string> }}
 */
export function parseResources(text) {
  const byId = new Map();
  const byName = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = /resource (0x[0-9a-f]+) (string|bool|color|integer)\/(\S+)/.exec(/** @type {string} */ (lines[i]));
    if (!head) continue;
    const valueLine = lines[i + 1] ?? "";
    const quoted = /^\s*\(\) "(.*)"\s*$/.exec(valueLine);
    const plain = /^\s*\(\) (\S+)\s*$/.exec(valueLine);
    const value = quoted ? quoted[1] : plain ? plain[1] : null;
    if (value === null || value === undefined) continue;
    byId.set(/** @type {string} */ (head[1]).toLowerCase(), value);
    byName.set(`${head[2]}/${head[3]}`, value);
  }
  return { byId, byName };
}

/**
 * `aapt2 dump xmltree --file AndroidManifest.xml`: the TWA meta-data and the
 * verified link filter, with @0x7f… references resolved.
 *
 * @param {string} text
 * @param {Map<string, string>} resources by id
 */
export function parseManifestTree(text, resources) {
  /** @param {string | undefined} raw */
  const resolve = (raw) => {
    if (!raw) return null;
    const ref = /^@(0x[0-9a-f]+)$/i.exec(raw);
    if (ref) return resources.get(/** @type {string} */ (ref[1]).toLowerCase()) ?? raw;
    return raw.replace(/^"(.*)"(?: \(Raw: .*\))?$/, "$1");
  };
  const lines = text.split(/\r?\n/);
  /** @param {string} line @param {string} attr */
  const attr = (line, attr) => {
    const match = new RegExp(`A: (?:${ANDROID_NS.replaceAll(".", "\\.")}:|android:)${attr}\\([^)]*\\)=(.*)$`).exec(line.trim());
    return match ? /** @type {string} */ (match[1]).trim() : undefined;
  };
  /** @type {Record<string, string | null>} */
  const metaData = {};
  let autoVerifyHost = null;
  let pendingAutoVerify = false;
  for (let i = 0; i < lines.length; i++) {
    const line = /** @type {string} */ (lines[i]);
    if (/E: meta-data/.test(line)) {
      let name;
      let value;
      for (let j = i + 1; j < Math.min(i + 5, lines.length) && !/E: /.test(/** @type {string} */ (lines[j])); j++) {
        name ??= attr(/** @type {string} */ (lines[j]), "name");
        value ??= attr(/** @type {string} */ (lines[j]), "value") ?? attr(/** @type {string} */ (lines[j]), "resource");
      }
      const key = resolve(name);
      if (key) metaData[key] = resolve(value);
    }
    if (/E: intent-filter/.test(line)) pendingAutoVerify = false;
    if (attr(line, "autoVerify") !== undefined && /=(?:true|\(type 0x12\)0xffffffff|-1)$/.test(line.trim())) pendingAutoVerify = true;
    const host = attr(line, "host");
    if (host !== undefined && pendingAutoVerify && autoVerifyHost === null) autoVerifyHost = resolve(host);
  }
  return { metaData, autoVerifyHost };
}

/**
 * @param {string} apk
 * @param {{ outDir?: string }} [options]
 */
export async function inspectApk(apk, options = {}) {
  const sdk = findAndroidSdk();
  const aapt2 = sdk.buildTools.aapt2;
  const [badgingText, treeText, resourcesText] = await Promise.all([
    run(aapt2, ["dump", "badging", apk], { capture: true, label: "aapt2 dump badging" }),
    run(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", apk], { capture: true, label: "aapt2 dump xmltree" }),
    run(aapt2, ["dump", "resources", apk], { capture: true, label: "aapt2 dump resources" }),
  ]);
  const badging = parseBadging(badgingText);
  const { byId, byName } = parseResources(resourcesText);
  const tree = parseManifestTree(treeText, byId);
  const summary = {
    apk: path.relative(ANDROID_DIR, apk).split(path.sep).join("/"),
    aapt2: `build-tools ${sdk.buildTools.version}`,
    ...badging,
    defaultUrl: tree.metaData["android.support.customtabs.trusted.DEFAULT_URL"] ?? null,
    fallbackStrategy: tree.metaData["android.support.customtabs.trusted.FALLBACK_STRATEGY"] ?? null,
    screenOrientation: tree.metaData["android.support.customtabs.trusted.SCREEN_ORIENTATION"] ?? null,
    verifiedLinkHost: tree.autoVerifyHost,
    assetStatements: byName.get("string/assetStatements")?.replace(/\\"/g, '"').replace(/\s+/g, " ").trim() ?? null,
  };
  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    writeFileSync(path.join(options.outDir, "aapt2-badging.txt"), badgingText);
    writeFileSync(path.join(options.outDir, "aapt2-manifest-xmltree.txt"), treeText);
    writeFileSync(path.join(options.outDir, "apk-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  return summary;
}

/** @param {Awaited<ReturnType<typeof inspectApk>>} summary */
export function printSummary(summary) {
  const rows = [
    ["Package", summary.packageName],
    ["Version", `${summary.versionName} (code ${summary.versionCode})`],
    ["SDK", `min ${summary.minSdk}, target ${summary.targetSdk}`],
    ["Label", summary.label],
    ["Launcher activity", summary.launchableActivity],
    ["Opens (DEFAULT_URL)", summary.defaultUrl],
    ["Verified link host", summary.verifiedLinkHost],
    ["Fallback", summary.fallbackStrategy],
    ["Orientation", summary.screenOrientation],
    ["Asset statements", summary.assetStatements],
  ];
  for (const [label, value] of rows) console.log(`  ${String(label).padEnd(20)} ${value ?? "(not found)"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadEnvFile(ENV_FILE);
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const outIndex = args.indexOf("--out");
  const outDir = outIndex >= 0 ? path.resolve(ANDROID_DIR, args[outIndex + 1] ?? "") : undefined;
  const rest = args.filter((_, i) => outIndex < 0 || (i !== outIndex && i !== outIndex + 1));
  let apk = rest[0] ? path.resolve(rest[0]) : undefined;
  if (!apk) {
    const record = path.join(DIST_DIR, "build.json");
    if (!existsSync(record)) {
      console.error("No APK given and no dist/build.json: run `pnpm --filter @polaris/android build` first.");
      process.exit(1);
    }
    apk = path.join(ANDROID_DIR, JSON.parse(readFileSync(record, "utf8")).apk.file);
  }
  inspectApk(apk, { outDir })
    .then((summary) => {
      console.log(`aapt2 (${summary.aapt2}) on ${summary.apk}:`);
      printSummary(summary);
      if (outDir) console.log(`Wrote aapt2's dumps and the summary to ${path.relative(ANDROID_DIR, outDir)}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
