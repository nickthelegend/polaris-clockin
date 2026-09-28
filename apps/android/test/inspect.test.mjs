import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parseBadging, parseManifestTree, parseResources } from "../scripts/inspect.mjs";
import { ANDROID_DIR } from "../scripts/lib/paths.mjs";

/**
 * The aapt2 readers behind `inspect` and the build's summary, run on the
 * dumps of the APK built on 28 Sep 2026 (evidence/2026-09-28) and on the
 * resource lines of that APK's `aapt2 dump resources`.
 */

const evidence = (/** @type {string} */ file) => readFileSync(path.join(ANDROID_DIR, "evidence", "2026-09-28", file), "utf8");

// Four entries of that APK's `aapt2 dump resources`, as printed.
const RESOURCES = [
  "Binary APK",
  "Package name=app.polarispay.twa id=7f",
  "  type bool id=04 entryCount=4",
  "    resource 0x7f040002 bool/enableNotification",
  "      () false",
  "  type string id=0d entryCount=80",
  "    resource 0x7f0d001e string/assetStatements",
  '      () "[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "web", "site": "https://app.polarispay.app" } }]"',
  "    resource 0x7f0d002d string/hostName",
  '      () "app.polarispay.app"',
  "    resource 0x7f0d002e string/launchUrl",
  '      () "https://app.polarispay.app/"',
].join("\n");

describe("parseBadging", () => {
  it("reads the package, versions, SDK levels, launcher and label", () => {
    assert.deepEqual(parseBadging(evidence("aapt2-badging.txt")), {
      packageName: "app.polarispay.twa",
      versionCode: "1",
      versionName: "1.0.0",
      minSdk: "28",
      targetSdk: "36",
      launchableActivity: "app.polarispay.twa.LauncherActivity",
      label: "Polaris",
    });
  });
});

describe("parseResources", () => {
  it("indexes values by id and by type/name", () => {
    const { byId, byName } = parseResources(RESOURCES);
    assert.equal(byId.get("0x7f0d002e"), "https://app.polarispay.app/");
    assert.equal(byName.get("string/hostName"), "app.polarispay.app");
    assert.equal(byName.get("bool/enableNotification"), "false");
    assert.match(byName.get("string/assetStatements") ?? "", /"site": "https:\/\/app\.polarispay\.app"/);
  });
});

describe("parseManifestTree", () => {
  it("resolves the TWA's DEFAULT_URL and the verified link host", () => {
    const { byId } = parseResources(RESOURCES);
    const tree = parseManifestTree(evidence("aapt2-manifest-xmltree.txt"), byId);
    assert.equal(tree.metaData["android.support.customtabs.trusted.DEFAULT_URL"], "https://app.polarispay.app/");
    assert.equal(tree.metaData["android.support.customtabs.trusted.FALLBACK_STRATEGY"] !== undefined, true);
    assert.equal(tree.autoVerifyHost, "app.polarispay.app");
  });

  it("leaves an unknown reference as it is rather than guess", () => {
    const tree = parseManifestTree(evidence("aapt2-manifest-xmltree.txt"), new Map());
    assert.equal(tree.metaData["android.support.customtabs.trusted.DEFAULT_URL"], "@0x7f0d002e");
  });
});
