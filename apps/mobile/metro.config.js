// Metro: Expo defaults, plus one fix. The Mobile Wallet Adapter packages
// export a "browser" build that throws "Protocol must be executed in a secure
// context" in React Native (solana-mobile/mobile-wallet-adapter#1302), so
// resolve both straight to their React Native builds.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const MWA = {
  "@solana-mobile/mobile-wallet-adapter-protocol": "lib/cjs/index.native.js",
  "@solana-mobile/mobile-wallet-adapter-protocol-web3js": "lib/cjs/index.native.js",
};
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (MWA[moduleName]) {
    return {
      type: "sourceFile",
      filePath: path.join(__dirname, "node_modules", moduleName, MWA[moduleName]),
    };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
