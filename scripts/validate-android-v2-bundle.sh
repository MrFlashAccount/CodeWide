#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_root=${TMPDIR:-/tmp}
bundle_root=$(mktemp -d "$temporary_root/codewide-v2-android-bundle.XXXXXX")

cleanup() {
  case "$bundle_root" in
    "$temporary_root"/codewide-v2-android-bundle.*) rm -rf -- "$bundle_root" ;;
    *) printf '%s\n' "Refusing to remove unexpected bundle directory: $bundle_root" >&2 ;;
  esac
}

trap cleanup EXIT
trap 'exit 130' HUP INT TERM

cd "$repo_root/apps/android"
CI=1 \
EXPO_NO_TELEMETRY=1 \
NODE_ENV=production \
pnpm exec expo export:embed \
  --entry-file index.js \
  --platform android \
  --dev false \
  --minify false \
  --unstable-transform-profile hermes \
  --max-workers "${CODEWIDE_METRO_MAX_WORKERS:-4}" \
  --bundle-output "$bundle_root/index.android.bundle" \
  --assets-dest "$bundle_root/assets"

test -s "$bundle_root/index.android.bundle"
