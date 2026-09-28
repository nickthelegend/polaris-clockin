// Fails the production build if any dev-mock route made it into .next.
//
// The mock of the Polaris API (src/app/api/dev-polaris) lives in *.dev.ts(x)
// files that next.config.ts only treats as routes for `next dev`. This check
// proves it: after `next build`, no route manifest and no compiled route may
// mention dev-polaris, and no server chunk may carry the mock's code (its
// secrets holder, its API paths) or the constant secret it used to ship with.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(process.cwd(), ".next");
const problems = [];

for (const manifest of ["app-path-routes-manifest.json", "routes-manifest.json", path.join("server", "app-paths-manifest.json")]) {
  const file = path.join(dist, manifest);
  if (existsSync(file) && readFileSync(file, "utf8").includes("dev-polaris")) problems.push(`${manifest} lists a dev-polaris route`);
}

const appDir = path.join(dist, "server", "app");
if (existsSync(appDir)) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.includes("dev-polaris")) problems.push(`compiled route ${path.relative(dist, full)}`);
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(appDir);
} else {
  problems.push("no .next/server/app: run next build first");
}

// The mock's code, or a secret it once shipped with, anywhere in the server bundle.
const MARKERS = ["whsec_halcyon", "halcyonDevMock", "__halcyonDevMockSecrets", "/api/dev-polaris/api/v1"];
const serverDir = path.join(dist, "server");
if (existsSync(serverDir)) {
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(js|mjs|cjs|json|html|rsc)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        for (const marker of MARKERS) {
          if (text.includes(marker)) problems.push(`${path.relative(dist, full)} contains "${marker}"`);
        }
      }
    }
  };
  scan(serverDir);
}

if (problems.length > 0) {
  console.error("The dev mock of the Polaris API is in this production build:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("OK: no dev-polaris routes or dev mock code in the production build.");
