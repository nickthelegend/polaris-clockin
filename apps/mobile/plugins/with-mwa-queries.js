// Android 11+ package visibility: declare that Polaris looks for apps that
// handle the Mobile Wallet Adapter's `solana-wallet:` scheme, so wallets
// (Seed Vault, Phantom, Solflare) are visible to the association intent.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withMwaQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const q = manifest.queries[0];
    q.intent = q.intent ?? [];
    const has = q.intent.some((i) => (i.data ?? []).some((d) => d.$?.["android:scheme"] === "solana-wallet"));
    if (!has) {
      q.intent.push({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
        data: [{ $: { "android:scheme": "solana-wallet" } }],
      });
    }
    return cfg;
  });
};
