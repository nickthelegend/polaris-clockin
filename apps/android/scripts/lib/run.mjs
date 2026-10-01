// @ts-check
/** Child processes, the same way on Windows and elsewhere. */

import { spawn } from "node:child_process";

/**
 * Windows runs .cmd and .bat files only through a shell; quote what needs it.
 *
 * @param {string} arg
 */
function quoteForCmd(arg) {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
}

/**
 * Runs a command. With `capture`, resolves to its stdout (stderr is passed
 * through); otherwise output goes to this terminal. Rejects on a non-zero exit.
 * Nothing here logs the arguments or the environment, so secrets passed by
 * environment (`env:` for apksigner, `:env` for keytool) stay out of logs.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, capture?: boolean, label?: string }} [options]
 * @returns {Promise<string>}
 */
export function run(command, args, options = {}) {
  const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const child = viaShell
    ? spawn([command, ...args].map(quoteForCmd).join(" "), {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: true,
        stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"],
        windowsHide: true,
      })
    : spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"],
        windowsHide: true,
      });
  let out = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${options.label ?? command} exited with ${code}`));
    });
  });
}
