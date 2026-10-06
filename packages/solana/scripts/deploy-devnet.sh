#!/usr/bin/env bash
# Deploy (or upgrade) the polaris program to devnet with the repo's own keys,
# then run the one-time setup. Never touches the global Solana CLI config.
#   bash scripts/deploy-devnet.sh            # deploy + setup
#   SKIP_SETUP=1 bash scripts/deploy-devnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."
URL=${SOLANA_URL:-https://api.devnet.solana.com}
DEPLOYER=keys/deployer.json
PROGRAM=keys/polaris-program.json
echo "deployer $(solana-keygen pubkey $DEPLOYER): $(solana balance -u "$URL" -k $DEPLOYER)"
[ -f target/deploy/polaris.so ] || anchor build
cp "$PROGRAM" target/deploy/polaris-keypair.json
solana program deploy target/deploy/polaris.so \
  --program-id "$PROGRAM" -k "$DEPLOYER" -u "$URL" \
  --max-sign-attempts 50 --use-rpc 2>&1 | tee .anchor/deploy-devnet.log
# reclaim any buffer a failed attempt left behind
solana program close --buffers -k "$DEPLOYER" -u "$URL" --bypass-warning || true
if [ -z "${SKIP_SETUP:-}" ]; then
  SOLANA_URL="$URL" npx ts-node --transpile-only scripts/setup-devnet.ts
fi
