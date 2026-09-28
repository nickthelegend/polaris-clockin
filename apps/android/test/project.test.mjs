import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ANDROID_DIR, APP_ICON_ROUTE, BRAND_ASSETS, MANIFEST_CHECKSUM, REPO_ROOT, TWA_MANIFEST } from "../scripts/lib/paths.mjs";
import { brandFileFor, DEFAULT_APP_URL, ICON_FILES, iconUrls, manifestChecksum, renderShortcutsXml, resolveAppUrl } from "../scripts/lib/target.mjs";

/**
 * twa-manifest.json (Bubblewrap's input) and the project generated from it:
 * the decisions that make it Polaris's app, and a generated project that is
 * in step with the manifest.
 */

const read = (/** @type {string} */ file) => readFileSync(path.join(ANDROID_DIR, file), "utf8");
const manifest = JSON.parse(readFileSync(TWA_MANIFEST, "utf8"));
const appManifestSource = readFileSync(path.join(REPO_ROOT, "apps", "app", "src", "app", "manifest.ts"), "utf8");

describe("twa-manifest.json", () => {
  it("is Polaris, opening the hosted app", () => {
    assert.equal(manifest.packageId, "app.polarispay.twa");
    assert.equal(manifest.name, "Polaris");
    assert.equal(manifest.launcherName, "Polaris");
    assert.deepEqual({ host: manifest.host, startUrl: manifest.startUrl }, resolveAppUrl(DEFAULT_APP_URL));
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.orientation, "portrait");
    assert.equal(manifest.fullScopeUrl, `https://${manifest.host}/`);
  });

  it("takes its colours from the app's dark tokens (its web manifest)", () => {
    const theme = /theme_color:\s*"(#[0-9a-fA-F]{6})"/.exec(appManifestSource)?.[1];
    const background = /background_color:\s*"(#[0-9a-fA-F]{6})"/.exec(appManifestSource)?.[1];
    assert.ok(theme && background, "apps/app/src/app/manifest.ts names theme_color and background_color");
    for (const key of ["themeColor", "themeColorDark", "navigationColor", "navigationColorDark", "navigationDividerColor", "navigationDividerColorDark"]) {
      assert.equal(manifest[key].toLowerCase(), theme.toLowerCase(), key);
    }
    assert.equal(manifest.backgroundColor.toLowerCase(), background.toLowerCase());
  });

  it("offers Send and Receive, routes the app has", () => {
    assert.deepEqual(
      manifest.shortcuts.map((/** @type {{ shortName: string, url: string }} */ s) => [s.shortName, s.url]),
      [
        ["Send", "/send"],
        ["Receive", "/receive"],
      ],
    );
    for (const route of ["send", "receive"]) {
      assert.ok(existsSync(path.join(REPO_ROOT, "apps", "app", "src", "app", "(tabs)", route, "page.tsx")), `apps/app has /${route}`);
    }
  });

  it("uses icons @polaris/brand has, served by the app at the same /icons/ names", () => {
    const urls = iconUrls(manifest);
    assert.ok(urls.length >= 4);
    for (const url of urls) {
      const file = brandFileFor(url, manifest.host);
      assert.ok(file, `${url} is one of the app's /icons/`);
      assert.ok(existsSync(path.join(BRAND_ASSETS, file)), `packages/brand/assets/${file} exists`);
    }
    const route = readFileSync(APP_ICON_ROUTE, "utf8");
    for (const [name, file] of Object.entries(ICON_FILES)) {
      assert.ok(route.includes(`"${name}": "${file}"`), `apps/app's icon route serves ${name} from ${file}`);
    }
  });

  it("keeps Face ID working: Custom Tabs as the fallback, never a WebView, and Android 9 or later", () => {
    // A WebView has no passkeys from Google Password Manager (and no PRF); a
    // Custom Tab is Chrome itself. Mera's PRF needs Android 9 (API 28).
    assert.equal(manifest.fallbackType, "customtabs");
    assert.ok(manifest.minSdkVersion >= 28);
    assert.equal(manifest.enableNotifications, false, "the web app sends no notifications");
  });

  it("signs with a key under .keys/, which is git-ignored", () => {
    assert.match(manifest.signingKey.path, /^\.\/\.keys\//);
  });

  it("names nothing a buyer shouldn't read", () => {
    const words = [manifest.name, manifest.launcherName, ...manifest.shortcuts.flatMap((/** @type {{ name: string, shortName: string }} */ s) => [s.name, s.shortName])];
    for (const word of words) assert.doesNotMatch(word, /wallet|gas|blockchain|crypto|token|chain/i);
  });
});

describe("the generated project", () => {
  it("was generated from this twa-manifest.json", () => {
    assert.equal(readFileSync(MANIFEST_CHECKSUM, "utf8").trim(), manifestChecksum(readFileSync(TWA_MANIFEST)), "run `pnpm --filter @polaris/android generate`");
  });

  it("builds the manifest's app", () => {
    const gradle = read("app/build.gradle");
    assert.match(gradle, new RegExp(`applicationId: '${manifest.packageId.replaceAll(".", "\\.")}'`));
    assert.match(gradle, new RegExp(`hostName: '${manifest.host.replaceAll(".", "\\.")}'`));
    assert.match(gradle, new RegExp(`launchUrl: '${manifest.startUrl}'`));
    assert.match(gradle, new RegExp(`minSdkVersion ${manifest.minSdkVersion}\\b`));
    assert.match(gradle, new RegExp(`versionName "${manifest.appVersion}"`));
    assert.match(gradle, /com\.google\.androidbrowserhelper:androidbrowserhelper:/);
    assert.match(gradle, /generatorApp: 'bubblewrap-cli'/);
  });

  it("opens the start URL in a Trusted Web Activity and claims the host's links", () => {
    const androidManifest = read("app/src/main/AndroidManifest.xml");
    assert.match(androidManifest, /android\.support\.customtabs\.trusted\.DEFAULT_URL"\s+android:value="@string\/launchUrl"/);
    assert.match(androidManifest, /<intent-filter android:autoVerify="true">[\s\S]*?android:host="@string\/hostName"/);
    assert.match(androidManifest, /android:name="asset_statements"\s+android:resource="@string\/assetStatements"/);
    const strings = read("app/src/main/res/values/strings.xml");
    assert.match(strings, new RegExp(`\\\\"site\\\\": \\\\"https://${manifest.host.replaceAll(".", "\\.")}\\\\"`));
  });

  it("has the shortcuts Gradle writes, so neither generating nor building changes the file", () => {
    assert.equal(read("app/src/main/res/xml/shortcuts.xml").replaceAll("\r\n", "\n"), renderShortcutsXml(manifest));
    assert.match(renderShortcutsXml(manifest), /android:data='\/send'[\s\S]*android:data='\/receive'/);
    assert.match(
      renderShortcutsXml({ ...manifest, shortcuts: [{ name: "a", shortName: "a", url: "/pay?a=1&b='2'" }] }),
      /android:data='\/pay\?a=1&amp;b=&apos;2&apos;'/,
    );
  });

  it("has the launcher, splash and shortcut icons", () => {
    for (const file of [
      "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
      "app/src/main/res/mipmap-xxxhdpi/ic_maskable.png",
      "app/src/main/res/drawable-xxxhdpi/splash.png",
      "app/src/main/res/drawable-xxxhdpi/shortcut_0_maskable.png",
      "app/src/main/res/drawable-xxxhdpi/shortcut_1_maskable.png",
      "store_icon.png",
    ]) {
      assert.ok(existsSync(path.join(ANDROID_DIR, file)), file);
    }
  });

  it("carries no trace of the local icon server", () => {
    for (const file of ["app/build.gradle", "app/src/main/AndroidManifest.xml", "app/src/main/res/values/strings.xml"]) {
      assert.doesNotMatch(read(file), /127\.0\.0\.1|localhost/, file);
    }
  });
});

describe("secrets", () => {
  /** @returns {string[] | null} */
  const tracked = () => {
    try {
      return execFileSync("git", ["ls-files", "--", "."], { cwd: ANDROID_DIR, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      return null;
    }
  };

  it("never commits a keystore, its passwords, a local .env or a build", (t) => {
    const files = tracked();
    if (files === null) return t.skip("git is not available");
    for (const file of files) {
      assert.doesNotMatch(file, /\.(keystore|jks|apk|aab|idsig)$|(^|\/)\.keys\/|(^|\/)\.env$|(^|\/)(dist|\.toolchain)\//, file);
    }
  });

  it("ignores where the key, the toolchain and the builds go", (t) => {
    const probe = [".keys/polaris-debug.keystore", ".keys/polaris-debug.env", ".env", "dist/polaris-1.0.0-debug.apk", ".toolchain/gradle/x", "app/build/x", "upload.jks"];
    let ignored;
    try {
      ignored = execFileSync("git", ["check-ignore", "--", ...probe], { cwd: ANDROID_DIR, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      return t.skip("git is not available");
    }
    assert.deepEqual(ignored.sort(), [...probe].sort());
  });
});
