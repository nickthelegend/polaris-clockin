#!/usr/bin/env node
/**
 * Run the Chainlink CRE CLI from this project root, with Bun on PATH.
 *
 *   pnpm --filter @polaris/cre-workflows cre workflow build ./collections
 *   pnpm --filter @polaris/cre-workflows cre workflow simulate ./underwriting -T local-settings \
 *     --non-interactive --trigger-index 0 --http-payload ./underwriting/payload.example.json --broadcast
 *
 * `cre workflow build` shells out to `bun x cre-compile`, and CRE's
 * TypeScript toolchain runs on Bun, so this puts the pinned Bun from
 * node_modules (the `bun` devDependency's platform binary) first on PATH.
 *
 * The CLI is found at $CRE_BIN, else workflows/.tools (scripts/install-cre.mjs
 * puts it there), else on PATH, else where Chainlink's installers put it.
 *
 * Before `workflow build|simulate|deploy|hash` it builds @polarispay/underwriting
 * when its dist is missing or stale: the underwriting workflow bundles that
 * package's pure core, and CRE's bundler (Bun.build, target browser) resolves
 * the package's default export, which is dist, not the TypeScript source.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { binaryName, officialInstallDir, TOOLS_DIR } from "./install-cre.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

export function findCre() {
  const name = binaryName();
  const candidates = [process.env.CRE_BIN, join(TOOLS_DIR, name), onPath(name), join(officialInstallDir(), name)];
  const hit = candidates.find((p) => p && existsSync(p));
  if (!hit) {
    throw new Error("CRE CLI not found. Install it with `pnpm --filter @polaris/cre-workflows cre:install`, or set CRE_BIN.");
  }
  return hit;
}

/** The directory holding the pinned Bun binary, from the `bun` package's platform dependency. */
export function findBunDir() {
  const require = createRequire(join(ROOT, "package.json"));
  let bunPkg;
  try {
    bunPkg = dirname(require.resolve("bun/package.json"));
  } catch {
    return null;
  }
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  // The npm `bun` package ships the binary in an optional @oven/bun-<platform> dependency.
  const scopes = [join(bunPkg, "node_modules", "@oven"), join(bunPkg, "..", "@oven")];
  for (const scope of scopes) {
    if (!existsSync(scope)) continue;
    for (const pkg of readdirSync(scope)) {
      const bin = join(scope, pkg, "bin", exe);
      if (existsSync(bin)) return dirname(bin);
    }
  }
  const own = join(bunPkg, "bin", exe);
  return existsSync(own) ? dirname(own) : null;
}

/** PATH with the pinned Bun first. */
export function envWithBun(env = process.env) {
  const bunDir = findBunDir();
  if (!bunDir) return env;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${bunDir}${delimiter}${env[key] ?? ""}` };
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** Build @polarispay/underwriting's dist if it is missing or older than its source. */
export function ensureUnderwritingBuilt() {
  const pkg = join(ROOT, "..", "packages", "underwriting");
  const out = join(pkg, "dist", "core", "index.js");
  if (existsSync(out) && statSync(out).mtimeMs >= newestMtime(join(pkg, "src"))) return;
  console.log("Building @polarispay/underwriting (the underwriting workflow bundles its core) ...");
  const tsc = createRequire(join(pkg, "package.json")).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.json")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("@polarispay/underwriting failed to build");
}

const BUNDLING = new Set(["build", "simulate", "deploy", "hash"]);

export function runCre(args, opts = {}) {
  const cre = findCre();
  if (args[0] === "workflow" && BUNDLING.has(args[1])) ensureUnderwritingBuilt();
  return spawnSync(cre, args, { cwd: ROOT, stdio: "inherit", env: envWithBun(), ...opts });
}

if (process.argv[1] && /cre\.mjs$/.test(process.argv[1])) {
  try {
    if (process.argv[2] === "--deps") {
      // Only prepare what the workflows bundle (used by `pnpm typecheck`).
      ensureUnderwritingBuilt();
      process.exit(0);
    }
    const r = runCre(process.argv.slice(2));
    process.exitCode = r.status ?? 1;
  } catch (e) {
    console.error(e.message ?? e);
    process.exitCode = 1;
  }
}
