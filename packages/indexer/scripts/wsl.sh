#!/usr/bin/env bash
# Run an indexer command on Linux: in WSL from Windows, or in Linux CI.
#
#   bash scripts/wsl.sh setup        # install (standalone, not the workspace) + envio codegen
#   bash scripts/wsl.sh test         # generate --check, codegen, typecheck, vitest
#   bash scripts/wsl.sh <pnpm args>  # anything else, e.g. `dev` (needs Docker) or `codegen`
#
# From Windows:  wsl -d <distro> -- bash packages/indexer/scripts/wsl.sh test
#
# The `envio` CLI has no Windows build, and a Windows `pnpm install` would
# skip its Linux binary, so this package is installed from Linux with its own
# lockfile (`--ignore-workspace`). WSL appends the Windows PATH, whose `node`
# and `pnpm` shims must not win: Linux entries go first.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)"
for dir in "$HOME/.local/opt/node22/bin" "$HOME/.local/share/pnpm"; do
  [ -d "$dir" ] && PATH="$dir:$PATH"
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo "No Linux Node.js on PATH. Install Node 22+ inside this distro (see README)." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Node $(node -v) is too old; envio needs 22+." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "No pnpm on PATH: npm install -g pnpm@10" >&2
  exit 1
fi

install() {
  pnpm install --ignore-workspace --config.confirmModulesPurge=false "$@"
}

case "${1:-}" in
  setup)
    shift
    install "$@"
    pnpm codegen
    ;;
  test)
    shift
    [ -d node_modules/envio ] || install --frozen-lockfile
    node scripts/generate.mjs --check
    pnpm codegen
    pnpm typecheck
    pnpm exec vitest run --test-timeout=60000 "$@"
    ;;
  "")
    echo "usage: bash scripts/wsl.sh setup | test | <pnpm args>" >&2
    exit 2
    ;;
  *)
    pnpm "$@"
    ;;
esac
