// Signs release builds with a keystore kept outside git. Point
// POLARIS_SIGNING_PROPERTIES at a properties file with storeFile,
// storePassword, keyAlias and keyPassword (default:
// /Volumes/Extreme SSD/Projects/clockin/.keys/polaris-clockin-signing.properties).
// Without the file, release builds fall back to the debug key (Expo's default).
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// polaris: release signing";
const SNIPPET = `
${MARK}
def polarisSigningFile = file(System.getenv("POLARIS_SIGNING_PROPERTIES") ?: "/Volumes/Extreme SSD/Projects/clockin/.keys/polaris-clockin-signing.properties")
def polarisSigning = new Properties()
if (polarisSigningFile.exists()) { polarisSigningFile.withInputStream { polarisSigning.load(it) } }
android {
    signingConfigs {
        polarisRelease {
            if (polarisSigningFile.exists()) {
                storeFile file(polarisSigning['storeFile'])
                storePassword polarisSigning['storePassword']
                keyAlias polarisSigning['keyAlias']
                keyPassword polarisSigning['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (polarisSigningFile.exists()) { signingConfig signingConfigs.polarisRelease }
        }
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) cfg.modResults.contents += SNIPPET;
    return cfg;
  });
};
