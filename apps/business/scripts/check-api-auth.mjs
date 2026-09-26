// Fails if any route handler under src/app/api is exported without withMerchant.
//
// The old merchant platform trusted a wallet address sent in a header. The rule
// here is that every handler authenticates through src/server/auth.ts, and this
// check makes it a build-time fact rather than a convention.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/app/api", import.meta.url));
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function* routes(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* routes(path);
    else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) yield path;
  }
}

const problems = [];
let checked = 0;

for (const file of routes(root)) {
  const source = readFileSync(file, "utf8");
  const rel = relative(process.cwd(), file);
  checked++;

  if (!/from\s+["']@\/server\/auth["']/.test(source)) {
    problems.push(`${rel}: does not import from @/server/auth`);
  }
  if (/x-wallet-address/i.test(source)) {
    problems.push(`${rel}: reads a wallet address from a header`);
  }
  for (const method of METHODS) {
    const declared = new RegExp(`export\\s+(async\\s+)?(function|const|let|var)\\s+${method}\\b`).test(source);
    if (!declared) continue;
    const wrapped = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withMerchant\\s*(<[^>]*>)?\\s*\\(`).test(source);
    if (!wrapped) problems.push(`${rel}: ${method} is not wrapped in withMerchant(...)`);
  }
  if (/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/.test(source)) {
    problems.push(`${rel}: re-exports a handler; declare it with withMerchant in place`);
  }
}

if (problems.length) {
  console.error(`API auth check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`API auth check: ${checked} route files, every handler wrapped in withMerchant.`);
