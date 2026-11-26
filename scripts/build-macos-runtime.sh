#!/bin/bash
set -euo pipefail

if [ "$#" != 1 ] || [ -e "$1" ]; then
  echo "Usage: $0 <new staging directory>" >&2
  exit 2
fi
node_exe="$(command -v node)"
if [ "$("$node_exe" -p 'process.platform + "/" + process.arch')" != darwin/arm64 ]; then
  echo 'Build the Apple Silicon package with native macOS arm64 Node.js.' >&2
  exit 1
fi

mkdir -p "$1"
output="$(cd -- "$1" && pwd -P)"
cd -- "$(dirname -- "$0")/.."
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
pnpm install --frozen-lockfile
pnpm build
store="$(pnpm store path --silent)"
pnpm --filter @ses/server --config.inject-workspace-packages=true --config.node-linker=hoisted \
  --config.package-import-method=copy deploy --offline --prod --store-dir "$store" "$output/server"

mkdir -p "$output/server/dist"
cp -p packages/server/dist/main.js "$output/server/dist/"
cp -R packages/client/dist "$output/client"
cp -p "$node_exe" "$output/node"
cp -p "$(dirname -- "$node_exe")/../LICENSE" "$output/LICENSE.node"

/usr/bin/lipo "$output/node" -verify_arch arm64
while IFS= read -r -d '' binary; do
  /usr/bin/lipo "$binary" -verify_arch arm64
done < <(find "$output/server/node_modules" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
"$output/node" -e 'const DB = require("node:module").createRequire(process.argv[1])("better-sqlite3"); new DB(":memory:").close()' \
  "$output/server/package.json"
