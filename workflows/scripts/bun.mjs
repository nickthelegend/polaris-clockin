#!/usr/bin/env node
/**
 * Run the pinned Bun (the `bun` devDependency) without needing Bun installed:
 *
 *   node scripts/bun.mjs test ./test
 *
 * The workflows' tests run on Bun because the CRE SDK's test runtime
 * (@chainlink/cre-sdk/test) is built on `bun:test`, and `cre workflow build`
 * compiles with Bun too.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findBunDir, ROOT } from "./cre.mjs";

export function bunBinary() {
  const dir = findBunDir();
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  if (dir && existsSync(join(dir, exe))) return join(dir, exe);
  return exe; // fall back to a Bun on PATH
}

export function runBun(args, opts = {}) {
  return spawnSync(bunBinary(), args, { cwd: ROOT, stdio: "inherit", ...opts });
}

if (process.argv[1] && /bun\.mjs$/.test(process.argv[1])) {
  const r = runBun(process.argv.slice(2));
  if (r.error) console.error(r.error.message);
  process.exitCode = r.status ?? 1;
}
