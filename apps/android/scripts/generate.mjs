#!/usr/bin/env node
// @ts-check
/**
 * pnpm --filter @polaris/android generate
 *
 * Generates the Android project in this folder from twa-manifest.json with
 * Bubblewrap (`bubblewrap update`, @bubblewrap/cli pinned below, run by npx,
 * non-interactively). With POLARIS_ANDROID_APP_URL set to another host, it
 * first points twa-manifest.json there.
 *
 * Bubblewrap downloads the icons named in the manifest. They are the hosted
 * app's /icons/ (apps/app serves @polaris/brand there), so this serves the
 * same brand files on 127.0.0.1 while it runs: the project can be generated
 * before the site is live, and always from the repository's own artwork.
 *
 * Writes app/, gradle/, build.gradle, settings.gradle, gradle.properties,
 * gradlew(.bat), store_icon.png and manifest-checksum.txt; leaves everything
 * else here alone.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvFile } from "./lib/env.mjs";
import { ANDROID_DIR, BRAND_ASSETS, ENV_FILE, MANIFEST_CHECKSUM, TOOLCHAIN_DIR, TWA_MANIFEST } from "./lib/paths.mjs";
import { run } from "./lib/run.mjs";
import { applyAppTarget, ICON_FILES, localizeIcons, manifestChecksum, renderShortcutsXml, resolveAppUrl, targetOf } from "./lib/target.mjs";
import { findAndroidSdk, findJdk, ToolchainError } from "./lib/toolchain.mjs";

/** The Bubblewrap release this project is generated with. */
export const BUBBLEWRAP_CLI = "@bubblewrap/cli@1.25.0";

/**
 * @typedef {import("./lib/target.mjs").TwaManifestJson} TwaManifestJson
 */

/** @returns {TwaManifestJson} */
export function readManifest() {
  return JSON.parse(readFileSync(TWA_MANIFEST, "utf8"));
}

/**
 * Points twa-manifest.json at POLARIS_ANDROID_APP_URL when that names another
 * host or start URL. Returns the manifest to generate from.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function retarget(env = process.env) {
  const manifest = readManifest();
  if (!env.POLARIS_ANDROID_APP_URL) return { manifest, changed: false };
  const target = resolveAppUrl(env.POLARIS_ANDROID_APP_URL);
  const current = targetOf(manifest);
  if (target.host === current.host && target.startUrl === current.startUrl) return { manifest, changed: false };
  const next = applyAppTarget(manifest, target);
  writeFileSync(TWA_MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`twa-manifest.json: https://${current.host}${current.startUrl} → https://${target.host}${target.startUrl}`);
  return { manifest: next, changed: true };
}

/**
 * Serves /icons/<name> from @polaris/brand on 127.0.0.1, as the hosted app does.
 *
 * @param {number} port
 * @returns {Promise<import("node:http").Server>}
 */
function serveBrandIcons(port) {
  const server = createServer((request, response) => {
    const name = /^\/icons\/([^/?#]+)$/.exec(request.url ?? "")?.[1];
    const file = name && Object.hasOwn(ICON_FILES, name) ? ICON_FILES[/** @type {keyof typeof ICON_FILES} */ (name)] : null;
    if (request.method !== "GET" || !file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "image/png" }).end(readFileSync(path.join(BRAND_ASSETS, file)));
  });
  return new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(new Error(`Could not serve the icons on 127.0.0.1:${port} (${error.message}); set POLARIS_ANDROID_ICON_PORT to a free port`)),
    );
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Bubblewrap reads a config (jdkPath, androidSdkPath) before any command and
 * prompts for it if either is empty. `update` uses neither, but it must not
 * prompt, so this writes one for it (git-ignored), with the paths
 * `pnpm build` would use when they are found.
 */
function writeBubblewrapConfig() {
  /** @param {() => { path: string }} find */
  const found = (find) => {
    try {
      return find().path;
    } catch (error) {
      if (error instanceof ToolchainError) return "not-found-see-pnpm-build";
      throw error;
    }
  };
  const file = path.join(TOOLCHAIN_DIR, "bubblewrap-config.json");
  writeFileSync(file, `${JSON.stringify({ jdkPath: found(findJdk), androidSdkPath: found(findAndroidSdk) }, null, 2)}\n`);
  return file;
}

/** Every generated text file, to check nothing local leaked into the project. */
function generatedTextFiles() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "build") walk(full);
      } else if (/\.(gradle|xml|java|json|properties)$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(path.join(ANDROID_DIR, "app"));
  for (const file of ["build.gradle", "settings.gradle", "gradle.properties"]) out.push(path.join(ANDROID_DIR, file));
  return out;
}

export async function generate() {
  loadEnvFile(ENV_FILE);
  const { manifest } = retarget();
  mkdirSync(TOOLCHAIN_DIR, { recursive: true });

  const port = Number(process.env.POLARIS_ANDROID_ICON_PORT || 3920);
  const server = await serveBrandIcons(port);
  try {
    const localManifest = path.join(TOOLCHAIN_DIR, "twa-manifest.local.json");
    writeFileSync(localManifest, `${JSON.stringify(localizeIcons(manifest, `http://127.0.0.1:${port}`), null, 2)}\n`);
    const config = writeBubblewrapConfig();
    console.log(`Generating the Android project with ${BUBBLEWRAP_CLI} (icons from packages/brand)`);
    await run(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "-y",
        BUBBLEWRAP_CLI,
        "update",
        "--skipVersionUpgrade",
        `--manifest=${localManifest}`,
        `--directory=${ANDROID_DIR}`,
        `--config=${config}`,
        "--fetchEngine=node-fetch",
      ],
      { cwd: ANDROID_DIR, label: "bubblewrap update" },
    );
  } finally {
    server.close();
  }

  // Bubblewrap checksummed the icon-localised copy; record the committed
  // manifest instead, which is what `bubblewrap build` compares against.
  writeFileSync(MANIFEST_CHECKSUM, manifestChecksum(readFileSync(TWA_MANIFEST)));
  // The template's shortcuts.xml is a placeholder that every Gradle run
  // rewrites; write what Gradle would, so the tree stays clean either way.
  writeFileSync(path.join(ANDROID_DIR, "app", "src", "main", "res", "xml", "shortcuts.xml"), renderShortcutsXml(manifest));

  const leaked = generatedTextFiles().filter((file) => existsSync(file) && readFileSync(file, "utf8").includes("127.0.0.1"));
  if (leaked.length > 0) throw new Error(`The local icon server's address ended up in: ${leaked.join(", ")}`);
  console.log(`Generated for https://${manifest.host}${manifest.startUrl} (${manifest.packageId})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  generate().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
