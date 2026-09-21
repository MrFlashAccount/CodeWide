#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:-${CODEWIDE_VERSION:-0.1.0}}
app_dir=${2:-"$mac_root/.build/app/CodeWide.app"}
output=${3:-"$mac_root/dist/CodeWide-$version.dmg"}

case "$output" in
  /*.dmg) ;;
  *)
    echo "DMG output must be an absolute .dmg path." >&2
    exit 1
    ;;
esac
if [ ! -d "$app_dir" ]; then
  echo "App bundle not found: $app_dir" >&2
  exit 1
fi

staging=$(mktemp -d "${TMPDIR:-/tmp}/codewide-dmg.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT HUP INT TERM
mkdir -p "$(dirname -- "$output")"
ditto "$app_dir" "$staging/CodeWide.app"
ln -s /Applications "$staging/Applications"
rm -f -- "$output"
hdiutil create -quiet -fs HFS+ -volname CodeWide -srcfolder "$staging" "$output"
hdiutil verify "$output"
printf '%s\n' "$output"
