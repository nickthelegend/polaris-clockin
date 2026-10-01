import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadEnvFile, parseEnv } from "../scripts/lib/env.mjs";

describe("parseEnv", () => {
  it("reads KEY=value lines, quotes, export and comments", () => {
    const text = [
      "# a comment",
      "",
      "A=1",
      "export B = two",
      'C="with # hash"',
      "D='single'",
      "E=plain # trailing comment",
      "not a line",
      "F=",
    ].join("\r\n");
    assert.deepEqual(parseEnv(text), { A: "1", B: "two", C: "with # hash", D: "single", E: "plain", F: "" });
  });

  it("keeps Windows paths as written (no escape processing)", () => {
    assert.deepEqual(parseEnv("POLARIS_ANDROID_JDK=F:\\tools\\gradle\\jdks\\eclipse_adoptium-17"), {
      POLARIS_ANDROID_JDK: "F:\\tools\\gradle\\jdks\\eclipse_adoptium-17",
    });
  });
});

describe("loadEnvFile", () => {
  it("adds what isn't set and never overrides the shell", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "polaris-android-env-"));
    const file = path.join(dir, ".env");
    writeFileSync(file, "A=from-file\nB=from-file\nC=from-file\n");
    const target = { A: "from-shell", C: "" };
    assert.deepEqual(loadEnvFile(file, target), ["B", "C"]);
    assert.deepEqual(target, { A: "from-shell", B: "from-file", C: "from-file" });
  });

  it("is a no-op without a file", () => {
    assert.deepEqual(loadEnvFile(path.join(os.tmpdir(), "polaris-android-no-such.env"), {}), []);
  });
});
