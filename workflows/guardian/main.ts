/**
 * Entry point `cre workflow build|simulate|deploy ./guardian` compiles to
 * WASM. The workflow itself lives in ../src/guardian/workflow.ts, where the
 * unit tests and the local end-to-end run import it from.
 */

import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow } from "../src/guardian/workflow.ts";

export async function main() {
  const runner = await Runner.newRunner({ configSchema });
  await runner.run(initWorkflow);
}
