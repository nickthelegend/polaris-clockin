// Copies the program's IDL, its TS types and the deployment records
// (packages/solana) into the app, so the app never reads outside its folder.
import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const sol = path.resolve(here, "../../../packages/solana");
const out = path.resolve(here, "../src/chain");
fs.copyFileSync(path.join(sol, "target/idl/polaris.json"), path.join(out, "polaris.json"));
fs.copyFileSync(path.join(sol, "target/types/polaris.ts"), path.join(out, "polaris-types.ts"));
const deployments = {};
for (const f of fs.readdirSync(path.join(sol, "deployments"))) {
  if (f.endsWith(".json") && !f.includes("smoke")) {
    const d = JSON.parse(fs.readFileSync(path.join(sol, "deployments", f), "utf8"));
    delete d.txs;
    deployments[d.network] = d;
  }
}
fs.writeFileSync(path.join(out, "deployments.json"), JSON.stringify(deployments, null, 2) + "\n");
console.log("synced", Object.keys(deployments));
