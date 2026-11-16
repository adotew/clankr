#!/bin/sh
# Builds the app and replaces /Applications/clankr.app with it.
set -eu
cd "$(dirname "$0")/.."

npm run app

# electron-builder writes to dist/mac-<arch>/.
for app in dist/mac*/clankr.app; do break; done
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# By path, so a running dev build is left alone.
pkill -f /Applications/clankr.app/ && sleep 1 || true
# The old copy is moved aside first, so a failed copy doesn't leave no app at all.
[ -e /Applications/clankr.app ] && mv /Applications/clankr.app "$tmp/old.app"
cp -R "$app" /Applications/clankr.app
open /Applications/clankr.app
echo "Installed /Applications/clankr.app"
