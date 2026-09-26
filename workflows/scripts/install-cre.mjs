#!/usr/bin/env node
/**
 * Install the Chainlink CRE CLI from its official GitHub release, verified.
 *
 *   pnpm --filter @polaris/cre-workflows cre:install
 *
 * Downloads the pinned release asset from github.com/smartcontractkit/cre-cli,
 * checks its SHA-256 against the release's checksums.txt, extracts it, checks
 * the publisher's code signature where the OS can (Authenticode on Windows,
 * `codesign` on macOS, as the official install scripts do), and puts the
 * binary in `workflows/.tools/` (git-ignored), like a pinned devDependency.
 * It does not edit PATH, touch the system, or log in to anything.
 * `scripts/cre.mjs` runs it from there (or from $CRE_BIN, PATH, or where the
 * official installers put it: %LOCALAPPDATA%\Programs\cre, ~/.cre/bin).
 *
 * Environment: CRE_CLI_VERSION (default below), CRE_INSTALL_DIR (overrides the
 * directory), FORCE=1 to reinstall over a working binary.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The release docs/research/cre.md verified (17 Sep 2026). Monad testnet needs >= v1.30.0. */
export const CRE_CLI_VERSION = process.env.CRE_CLI_VERSION || "v1.35.0";
const RELEASES = "https://github.com/smartcontractkit/cre-cli/releases/download";

/** workflows/.tools: where this script installs, unless CRE_INSTALL_DIR says otherwise. */
export const TOOLS_DIR = fileURLToPath(new URL("../.tools/", import.meta.url));

export function defaultInstallDir() {
  return process.env.CRE_INSTALL_DIR || TOOLS_DIR;
}

/** Where the official install scripts put the binary. */
export function officialInstallDir(platform = process.platform) {
  if (platform === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "Programs", "cre");
  }
  return join(homedir(), ".cre", "bin");
}

export function binaryName(platform = process.platform) {
  return platform === "win32" ? "cre.exe" : "cre";
}

/** The release asset for this machine, and the name checksums.txt lists it under. */
export function assetFor(version, platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "arm64" : "amd64";
  if (platform === "win32") {
    // ARM64 Windows gets the amd64 build, as install.ps1 does.
    return { asset: "cre_windows_amd64.zip", listed: `cre_${version}_windows_amd64.zip`, archive: "zip" };
  }
  if (platform === "darwin") {
    return { asset: `cre_darwin_${cpu}.zip`, listed: `cre_${version}_darwin_${cpu}.zip`, archive: "zip" };
  }
  if (platform === "linux") {
    return { asset: `cre_linux_${cpu}.tar.gz`, listed: `cre_${version}_linux_${cpu}.tar.gz`, archive: "tar" };
  }
  throw new Error(`No CRE CLI release for ${platform}/${arch}`);
}

/** The expected hash for `listed` in a checksums.txt body (`<name>: <sha256>` lines). */
export function expectedHash(checksums, listed) {
  for (const line of checksums.split(/\r?\n/)) {
    const m = /^(\S+):\s*([0-9a-f]{64})\s*$/i.exec(line.trim());
    if (m && m[1] === listed) return m[2].toLowerCase();
  }
  throw new Error(`checksums.txt has no plain entry for ${listed}`);
}

function currentVersion(bin) {
  if (!existsSync(bin)) return null;
  const r = spawnSync(bin, ["version"], { encoding: "utf8" });
  const m = /v\d+\.\d+\.\d+/.exec(`${r.stdout}${r.stderr}`);
  return m ? m[0] : null;
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function findFile(dir, test) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, test);
      if (hit) return hit;
    } else if (test(entry.name)) return p;
  }
  return null;
}

function verifySignature(bin, platform) {
  if (platform === "win32") {
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${bin.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" }).trim();
    const [status, subject = ""] = out.split("|");
    if (status !== "Valid" || !/SmartContract/i.test(subject)) {
      throw new Error(`Authenticode check failed: ${out}`);
    }
    return `Authenticode ${status}, ${subject}`;
  }
  if (platform === "darwin") {
    execFileSync("codesign", ["--verify", "--strict", "--identifier", "com.smartcontract.cre.cli", bin]);
    return "codesign verified (com.smartcontract.cre.cli)";
  }
  return "SHA-256 only (the .sig check needs the release's public key; see install.sh)";
}

export async function install({ version = CRE_CLI_VERSION, dir = defaultInstallDir(), force = process.env.FORCE === "1" } = {}) {
  const platform = process.platform;
  const target = join(dir, binaryName(platform));
  const have = currentVersion(target);
  if (have === version && !force) {
    console.log(`CRE CLI ${have} already at ${target}`);
    return target;
  }

  const { asset, listed, archive } = assetFor(version, platform);
  console.log(`Downloading ${asset} (${version}) from github.com/smartcontractkit/cre-cli`);
  const [zip, sums] = await Promise.all([
    download(`${RELEASES}/${version}/${asset}`),
    download(`${RELEASES}/${version}/checksums.txt`),
  ]);

  const want = expectedHash(sums.toString("utf8"), listed);
  const got = createHash("sha256").update(zip).digest("hex");
  if (got !== want) throw new Error(`SHA-256 mismatch for ${asset}: got ${got}, checksums.txt says ${want}`);
  console.log(`SHA-256   ${got} (matches checksums.txt)`);

  const work = mkdtempSync(join(tmpdir(), "cre-cli-"));
  try {
    const file = join(work, asset);
    writeFileSync(file, zip);
    const out = join(work, "x");
    mkdirSync(out);
    if (archive === "zip" && platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${file}' -DestinationPath '${out}' -Force`]);
    } else if (archive === "zip") {
      execFileSync("unzip", ["-q", file, "-d", out]);
    } else {
      execFileSync("tar", ["-xzf", file, "-C", out]);
    }
    const exe = findFile(out, (n) => n.startsWith("cre") && (platform === "win32" ? n.endsWith(".exe") : !n.includes(".")));
    if (!exe) throw new Error(`No cre binary inside ${asset}`);
    console.log(`Signature ${verifySignature(exe, platform)}`);

    mkdirSync(dir, { recursive: true });
    const staged = `${target}.new`;
    copyFileSync(exe, staged);
    if (platform !== "win32") chmodSync(staged, 0o755);
    if (existsSync(target)) rmSync(target);
    renameSync(staged, target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const now = currentVersion(target);
  if (now !== version) throw new Error(`Installed binary reports ${now ?? "nothing"}, expected ${version}`);
  console.log(`Installed CRE CLI ${now} at ${target}`);
  console.log("Next: `cre login` (browser, once) before `cre workflow simulate`; builds need no login.");
  return target;
}

if (process.argv[1] && /install-cre\.mjs$/.test(process.argv[1])) {
  install().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}

export { currentVersion };
