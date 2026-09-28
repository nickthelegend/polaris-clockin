/**
 * Entry point `cre workflow build|simulate|deploy ./collections` compiles to
 * WASM. The workflow itself lives in ../src/collections/workflow.ts, where the
 * unit tests and the local end-to-end run import it from.
 */

import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow } from "../src/collections/workflow.ts";

export async function main() {
  const runner = await Runner.newRunner({ configSchema });
  await runner.run(initWorkflow);
}
