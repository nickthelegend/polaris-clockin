// @ts-check
/**
 * What the Android app opens, and where its icons come from.
 *
 * twa-manifest.json names the hosted app (`host`, `startUrl`) and takes every
 * icon from that site's /icons/ route (apps/app, which serves @polaris/brand).
 * POLARIS_ANDROID_APP_URL points it somewhere else; generation serves the same
 * brand files locally, so the project can be generated before the site is up.
 */

import { createHash } from "node:crypto";

export const DEFAULT_APP_URL = "https://app.polarispay.app/";

/**
 * The files behind /icons/<name> on the hosted app. apps/app's icon route
 * (src/app/icons/[name]/route.tsx) serves exactly these; a test holds the two
 * to each other.
 */
export const ICON_FILES = Object.freeze({
  "icon-192.png": "app-icon-192.png",
  "icon-512.png": "app-icon-512.png",
  "maskable-512.png": "app-icon-maskable-512.png",
  "shortcut-send.png": "shortcut-send.png",
  "shortcut-receive.png": "shortcut-receive.png",
});

/**
 * @typedef {{ host: string, startUrl: string }} AppTarget
 * @typedef {{ name: string, shortName: string, url: string, chosenIconUrl?: string, chosenMaskableIconUrl?: string, chosenMonochromeIconUrl?: string }} Shortcut
 * @typedef {Record<string, unknown> & { packageId: string, host: string, startUrl: string, iconUrl?: string, maskableIconUrl?: string, monochromeIconUrl?: string, fullScopeUrl?: string, webManifestUrl?: string, shortcuts?: Shortcut[] }} TwaManifestJson
 */

/**
 * The host and start path the app opens. A Trusted Web Activity needs https,
 * and its intent filter matches a bare host, so ports, credentials and
 * fragments are refused rather than silently dropped.
 *
 * @param {string | undefined} value
 * @returns {AppTarget}
 */
export function resolveAppUrl(value) {
  const raw = value?.trim() || DEFAULT_APP_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`POLARIS_ANDROID_APP_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") throw new Error(`POLARIS_ANDROID_APP_URL must be https (a Trusted Web Activity only opens https): ${raw}`);
  if (url.port) throw new Error(`POLARIS_ANDROID_APP_URL must not name a port (Android matches the bare host): ${raw}`);
  if (url.username || url.password) throw new Error("POLARIS_ANDROID_APP_URL must not carry credentials");
  if (url.hash) throw new Error(`POLARIS_ANDROID_APP_URL must not have a #fragment: ${raw}`);
  return { host: url.hostname, startUrl: `${url.pathname}${url.search}` };
}

/**
 * Moves an https URL on the manifest's old host to the new one; leaves any
 * other URL alone.
 *
 * @param {string | undefined} value
 * @param {string} fromHost
 * @param {string} toHost
 */
function rehost(value, fromHost, toHost) {
  if (!value) return value;
  const url = new URL(value);
  if (url.hostname !== fromHost) return value;
  url.hostname = toHost;
  return url.toString();
}

/**
 * The manifest pointed at `target`: host, start URL, and every icon and scope
 * URL that was on the old host.
 *
 * @param {TwaManifestJson} manifest
 * @param {AppTarget} target
 * @returns {TwaManifestJson}
 */
export function applyAppTarget(manifest, target) {
  const from = manifest.host;
  const to = target.host;
  /** @type {TwaManifestJson} */
  const next = { ...manifest, host: to, startUrl: target.startUrl };
  for (const key of /** @type {const} */ (["iconUrl", "maskableIconUrl", "monochromeIconUrl", "fullScopeUrl", "webManifestUrl"])) {
    if (typeof manifest[key] === "string") next[key] = rehost(manifest[key], from, to);
  }
  if (manifest.shortcuts) {
    next.shortcuts = manifest.shortcuts.map((shortcut) => ({
      ...shortcut,
      chosenIconUrl: rehost(shortcut.chosenIconUrl, from, to),
      chosenMaskableIconUrl: rehost(shortcut.chosenMaskableIconUrl, from, to),
      chosenMonochromeIconUrl: rehost(shortcut.chosenMonochromeIconUrl, from, to),
    }));
  }
  return JSON.parse(JSON.stringify(next));
}

/** @param {TwaManifestJson} manifest */
export function targetOf(manifest) {
  return { host: manifest.host, startUrl: manifest.startUrl };
}

/**
 * Every icon URL in the manifest.
 *
 * @param {TwaManifestJson} manifest
 * @returns {string[]}
 */
export function iconUrls(manifest) {
  const urls = [manifest.iconUrl, manifest.maskableIconUrl, manifest.monochromeIconUrl];
  for (const shortcut of manifest.shortcuts ?? []) {
    urls.push(shortcut.chosenIconUrl, shortcut.chosenMaskableIconUrl, shortcut.chosenMonochromeIconUrl);
  }
  return /** @type {string[]} */ (urls.filter(Boolean));
}

/**
 * The @polaris/brand file behind an icon URL on the app's host, or null.
 *
 * @param {string} url
 * @param {string} host
 * @returns {string | null}
 */
export function brandFileFor(url, host) {
  const parsed = new URL(url);
  if (parsed.hostname !== host) return null;
  const match = /^\/icons\/([^/]+)$/.exec(parsed.pathname);
  if (!match) return null;
  const name = /** @type {string} */ (match[1]);
  return Object.hasOwn(ICON_FILES, name) ? ICON_FILES[/** @type {keyof typeof ICON_FILES} */ (name)] : null;
}

/**
 * The manifest with every icon on the app's host served from `localBase`
 * instead (the generator's local server over @polaris/brand). Throws if an
 * icon names a file the brand package doesn't have.
 *
 * @param {TwaManifestJson} manifest
 * @param {string} localBase e.g. http://127.0.0.1:3920
 * @returns {TwaManifestJson}
 */
export function localizeIcons(manifest, localBase) {
  /** @param {string | undefined} value */
  const local = (value) => {
    if (!value) return value;
    if (!brandFileFor(value, manifest.host)) {
      throw new Error(`${value} is not one of the app's /icons/ (${Object.keys(ICON_FILES).join(", ")})`);
    }
    return `${localBase}${new URL(value).pathname}`;
  };
  return JSON.parse(
    JSON.stringify({
      ...manifest,
      iconUrl: local(manifest.iconUrl),
      maskableIconUrl: local(manifest.maskableIconUrl),
      monochromeIconUrl: local(manifest.monochromeIconUrl),
      shortcuts: (manifest.shortcuts ?? []).map((shortcut) => ({
        ...shortcut,
        chosenIconUrl: local(shortcut.chosenIconUrl),
        chosenMaskableIconUrl: local(shortcut.chosenMaskableIconUrl),
        chosenMonochromeIconUrl: local(shortcut.chosenMonochromeIconUrl),
      })),
    }),
  );
}

/**
 * Bubblewrap's manifest checksum (manifest-checksum.txt): SHA-1 of the file's
 * bytes. `bubblewrap build` regenerates the project when it differs.
 *
 * @param {Buffer | string} contents
 */
export function manifestChecksum(contents) {
  return createHash("sha1").update(contents).digest("hex");
}

/** @param {string} value */
function xmlAttr(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;").replaceAll('"', "&quot;");
}

/**
 * app/src/main/res/xml/shortcuts.xml exactly as the generated app/build.gradle
 * writes it on every Gradle run (its generateShorcutsFile task, Groovy's
 * MarkupBuilder). `generate` writes the same bytes, so neither a generation
 * nor a build leaves the committed file changed.
 *
 * @param {TwaManifestJson} manifest
 */
export function renderShortcutsXml(manifest) {
  const pkg = xmlAttr(manifest.packageId);
  const lines = (manifest.shortcuts ?? []).flatMap((shortcut, i) => [
    `    <shortcut android:shortcutId='shortcut${i}' android:enabled='true' android:icon='@drawable/shortcut_${i}' android:shortcutShortLabel='@string/shortcut_short_name_${i}' android:shortcutLongLabel='@string/shortcut_name_${i}'>`,
    `        <intent android:action='android.intent.action.MAIN' android:targetPackage='${pkg}' android:targetClass='${pkg}.LauncherActivity' android:data='${xmlAttr(shortcut.url)}' />`,
    "        <categories android:name='android.intent.category.LAUNCHER' />",
    "    </shortcut>",
  ]);
  if (lines.length === 0) return "<shortcuts xmlns:android='http://schemas.android.com/apk/res/android' />\n";
  return ["<shortcuts xmlns:android='http://schemas.android.com/apk/res/android'>", ...lines, "</shortcuts>", ""].join("\n");
}
