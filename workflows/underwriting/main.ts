/**
 * Entry point `cre workflow build|simulate|deploy ./underwriting` compiles to
 * WASM. The workflow itself lives in ../src/underwriting/workflow.ts, where
 * the unit tests and the local end-to-end run import it from.
 */

import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow } from "../src/underwriting/workflow.ts";

export async function main() {
  const runner = await Runner.newRunner({ configSchema });
  await runner.run(initWorkflow);
}
