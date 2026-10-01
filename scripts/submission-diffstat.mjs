#!/usr/bin/env node
/**
 * The "What's new in Metropolis" evidence: `git diff --stat` from the commit
 * that imported the pre-existing foundation (polaris-solana@daca8ca) to a
 * later commit, in full, plus a summary by folder.
 *
 *   node scripts/submission-diffstat.mjs                # foundation..HEAD
 *   node scripts/submission-diffstat.mjs --to ae2ce19   # foundation..<ref>
 *   node scripts/submission-diffstat.mjs --print        # print only, write nothing
 *
 * Writes docs/submission/diffstat.txt (the summary table, then the full
 * stat) and prints the summary as a Markdown table for docs/submission/
 * writeup.md. The foundation commit is found by its subject, so the script
 * never needs a hard-coded hash.
 *
 * Summary rows: `apps/<name>` and `packages/<name>` each get a row, every other
 * top-level folder one row, and the root's own files one row. Binary files
 * (images, video) count as files, with no line counts (git reports "-").
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, "docs", "submission", "diffstat.txt");
/** The subject of the one commit that imported pre-existing code (README, "Pre-existing components"). */
export const FOUNDATION_SUBJECT = "Import pre-existing foundation from polaris-solana@";

/**
 * @typedef {{ folder: string, files: number, binary: number, insertions: number, deletions: number }} FolderRow
 */

/**
 * The summary folder a changed path belongs to.
 * @param {string} path a repository-relative path, forward slashes
 * @returns {string}
 */
export function folderOf(path) {
  const parts = path.split("/");
  if (parts.length === 1) return "(root files)";
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

/**
 * Sums `git diff --numstat` output by folder, largest insertions first.
 * @param {string} numstat the raw output: "<ins>\t<del>\t<path>" per line, "-" for binary files
 * @returns {{ rows: FolderRow[], total: FolderRow }}
 */
export function summarise(numstat) {
  /** @type {Map<string, FolderRow>} */
  const byFolder = new Map();
  const total = { folder: "Total", files: 0, binary: 0, insertions: 0, deletions: 0 };
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [ins, del, ...rest] = line.split("\t");
    const path = rest.join("\t");
    const folder = folderOf(path);
    const row = byFolder.get(folder) ?? { folder, files: 0, binary: 0, insertions: 0, deletions: 0 };
    for (const r of [row, total]) {
      r.files += 1;
      if (ins === "-" || del === "-") r.binary += 1;
      else {
        r.insertions += Number(ins);
        r.deletions += Number(del);
      }
    }
    byFolder.set(folder, row);
  }
  const rows = [...byFolder.values()].sort((a, b) => b.insertions - a.insertions || a.folder.localeCompare(b.folder));
  return { rows, total };
}

/** @param {number} n */
const fmt = (n) => n.toLocaleString("en-US");

/**
 * The summary as a Markdown table.
 * @param {{ rows: FolderRow[], total: FolderRow }} summary
 * @returns {string}
 */
export function toMarkdown({ rows, total }) {
  const lines = [
    "| Folder | Files changed | of which binary | Lines added | Lines removed |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const r of [...rows, total]) {
    const name = r === total ? "**Total**" : `\`${r.folder}\``;
    lines.push(`| ${name} | ${fmt(r.files)} | ${fmt(r.binary)} | ${fmt(r.insertions)} | ${fmt(r.deletions)} |`);
  }
  return lines.join("\n");
}

/**
 * The summary as fixed-width text, for diffstat.txt.
 * @param {{ rows: FolderRow[], total: FolderRow }} summary
 * @returns {string}
 */
export function toText({ rows, total }) {
  const width = Math.max(...rows.map((r) => r.folder.length), 12);
  const head = `${"folder".padEnd(width)}  ${"files".padStart(6)}  ${"binary".padStart(6)}  ${"added".padStart(8)}  ${"removed".padStart(8)}`;
  const line = (r) =>
    `${r.folder.padEnd(width)}  ${String(r.files).padStart(6)}  ${String(r.binary).padStart(6)}  ${String(r.insertions).padStart(8)}  ${String(r.deletions).padStart(8)}`;
  return [head, "-".repeat(head.length), ...rows.map(line), "-".repeat(head.length), line(total)].join("\n");
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const argv = process.argv.slice(2);
  const toIndex = argv.indexOf("--to");
  const to = toIndex >= 0 ? argv[toIndex + 1] : "HEAD";
  if (!to) throw new Error("--to needs a commit");
  const printOnly = argv.includes("--print");

  const base = git(["log", "--reverse", "--format=%H", "--fixed-strings", `--grep=${FOUNDATION_SUBJECT}`]).trim().split("\n")[0];
  if (!base) throw new Error(`No commit whose message contains "${FOUNDATION_SUBJECT}"`);
  const baseLine = git(["log", "-1", "--format=%h %ad %s", "--date=short", base]).trim();
  const toLine = git(["log", "-1", "--format=%h %ad %s", "--date=short", to]).trim();
  const toHash = git(["rev-parse", "--short", to]).trim();
  const commits = git(["rev-list", "--count", `${base}..${to}`]).trim();
  const nonMerge = git(["rev-list", "--count", "--no-merges", `${base}..${to}`]).trim();
  const foundation = git(["show", "--shortstat", "--format=", base]).trim();
  const shortstat = git(["diff", "--shortstat", `${base}..${to}`]).trim();
  const summary = summarise(git(["diff", "--numstat", `${base}..${to}`]));
  const stat = git(["diff", "--stat=240,200", "--stat-graph-width=40", "--stat-count=100000", `${base}..${to}`]);

  const text = [
    "git diff --stat from the foundation import to the Metropolis build",
    "",
    `Foundation (pre-existing code, imported unchanged): ${baseLine}`,
    `  that commit alone: ${foundation}`,
    `Compared with: ${toLine}`,
    `Commits since the foundation: ${commits} (${nonMerge} without merges)`,
    `Since the foundation: ${shortstat}`,
    "",
    `Regenerate: node scripts/submission-diffstat.mjs --to ${toHash}`,
    `Full stat by hand: git diff --stat ${base.slice(0, 7)}..${toHash}`,
    "",
    "By folder (binary files have no line counts):",
    "",
    toText(summary),
    "",
    "Every file:",
    "",
    stat.trimEnd(),
    "",
  ].join("\n");

  if (!printOnly) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`Wrote ${OUT.slice(REPO.length).replaceAll("\\", "/")} (${base.slice(0, 7)}..${toHash}).\n`);
  }
  console.log(`${commits} commits (${nonMerge} without merges); ${shortstat}\n`);
  console.log(toMarkdown(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
