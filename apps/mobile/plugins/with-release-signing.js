// Signs release builds with a keystore kept outside git. Point
// POLARIS_SIGNING_PROPERTIES at a properties file with storeFile,
// storePassword, keyAlias and keyPassword (default:
// /Volumes/Extreme SSD/Projects/clockin/.keys/polaris-clockin-signing.properties).
// Release packaging refuses missing or incomplete credentials.
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

const PACKAGER_LIMIT = "\n// clockin-release-packager-single-worker\nreact { extraPackagerArgs = [\"--max-workers\", \"1\"] }\n";

const RELEASE_GUARD = "\n// clockin-release-requires-existing-identity\ngradle.taskGraph.whenReady { graph ->\n    if (graph.allTasks.any { it.name in ['assembleRelease', 'bundleRelease', 'packageRelease'] } && !(polarisSigningFile.exists() && ['storeFile','storePassword','keyAlias','keyPassword'].every { polarisSigning[it] } && new File(polarisSigning['storeFile']).exists())) {\n        throw new GradleException('Release signing credentials are missing or incomplete; refusing a debug-signed release')\n    }\n}\n";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) cfg.modResults.contents += SNIPPET;
    if (!cfg.modResults.contents.includes('clockin-release-requires-existing-identity')) cfg.modResults.contents += RELEASE_GUARD;
    if (!cfg.modResults.contents.includes('// clockin-release-packager-single-worker')) cfg.modResults.contents += PACKAGER_LIMIT;
    return cfg;
  });
};
