// The repo lives under "/Volumes/Extreme SSD": a path with a space. Two
// build scripts in expo-constants don't quote paths; quote them. Idempotent;
// runs on postinstall.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const edits = [
  [
    "node_modules/expo-constants/ios/EXConstants.podspec",
    `:script => "bash -l -c \\"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"",`,
    `:script => "bash -l -c \\"#{env_vars}'$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh'\\"",`,
  ],
  [
    "node_modules/expo-constants/scripts/get-app-config-ios.sh",
    `PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)`,
    `PROJECT_DIR_BASENAME=$(basename "$PROJECT_DIR")`,
  ],
];
for (const [file, from, to] of edits) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, "utf8");
  if (s.includes(to)) continue;
  if (!s.includes(from)) {
    console.warn(`patch-space-paths: pattern not found in ${file}`);
    continue;
  }
  fs.writeFileSync(p, s.replace(from, to));
  console.log(`patch-space-paths: patched ${file}`);
}
