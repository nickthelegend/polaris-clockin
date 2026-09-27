/**
 * The few Node APIs the tests use, typed here.
 *
 * `@chainlink/cre-sdk` declares every Node built-in (`node:fs`,
 * `node:crypto`, `node:child_process`, …) with `never` exports, so that
 * workflow code cannot typecheck against APIs the WASM runtime lacks. That
 * declaration is global to any program importing the SDK, tests included,
 * so the tests load the modules through `createRequire` and declare the
 * signatures they rely on.
 */

import { createRequire } from "node:module";

const load = createRequire(import.meta.url);

export const fs = load("node:fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
  cpSync(from: string, to: string, opts: { recursive: boolean }): void;
  mkdtempSync(prefix: string): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
};

export const os = load("node:os") as { tmpdir(): string };

export const childProcess = load("node:child_process") as {
  execFileSync(file: string, args: string[], opts: { input?: string; encoding: "utf8"; maxBuffer?: number }): string;
};

export const crypto = load("node:crypto") as {
  createHmac(alg: "sha256", key: string): { update(data: string): { digest(enc: "hex"): string } };
};

/** For CommonJS modules of this monorepo (packages/contracts/lib/*.js). */
export const requireModule = load;
