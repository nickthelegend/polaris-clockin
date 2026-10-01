// @ts-check
/** A small .env reader: KEY=value lines, # comments, optional quotes. No expansion. */

import { existsSync, readFileSync } from "node:fs";

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = /** @type {string} */ (match[1]);
    let value = /** @type {string} */ (match[2]);
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      // An unquoted value ends at a " #" comment.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Adds a .env file's values to `target` without overriding anything already
 * set (the shell wins). Returns the keys it added.
 *
 * @param {string} file
 * @param {NodeJS.ProcessEnv} [target]
 * @returns {string[]}
 */
export function loadEnvFile(file, target = process.env) {
  if (!existsSync(file)) return [];
  const added = [];
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (target[key] === undefined || target[key] === "") {
      target[key] = value;
      added.push(key);
    }
  }
  return added;
}
