// The repo sits under "/Volumes/Extreme SSD" (a space in the path). React
// Native's iOS "Bundle React Native code and images" phase runs its script
// through an unquoted backtick substitution, which splits on the space. Run it
// through a quoted command substitution instead.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const FROM =
  "`\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\"`";
const TO =
  "bash \\\"$(\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\")\\\"";

module.exports = function withSpaceSafePaths(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const dir = cfg.modRequest.platformProjectRoot;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".xcodeproj")) continue;
        const p = path.join(dir, f, "project.pbxproj");
        const s = fs.readFileSync(p, "utf8");
        if (s.includes(FROM)) fs.writeFileSync(p, s.split(FROM).join(TO));
      }
      return cfg;
    },
  ]);
};
