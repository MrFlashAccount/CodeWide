#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_root=${TMPDIR:-/tmp}
bundle_root=$(mktemp -d "$temporary_root/codewide-android-bundle.XXXXXX")

cleanup() {
  case "$bundle_root" in
    "$temporary_root"/codewide-android-bundle.*) rm -rf -- "$bundle_root" ;;
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
  --sourcemap-output "$bundle_root/index.android.bundle.map" \
  --assets-dest "$bundle_root/assets"

test -s "$bundle_root/index.android.bundle"
node --input-type=module - "$bundle_root/index.android.bundle.map" "$bundle_root/index.android.bundle" <<'NODE'
import { readFileSync } from "node:fs";

const { sources } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const retired = sources.filter((source) => /(?:^|\/)src\/v2\//u.test(source));
if (retired.length !== 0) {
  throw new Error(`Android bundle retains ${retired.length} retired V2 modules`);
}
if (!sources.some((source) => /(?:^|\/)app\/\(workspace\)\/_layout\.tsx$/u.test(source))) {
  throw new Error("Android bundle does not contain the workspace entry");
}
if (!sources.some((source) => /(?:^|\/)src\/ui\/registerAppNoticeOverlay\.android\.ts$/u.test(source))) {
  throw new Error("Android bundle does not register the native notice surface");
}
if (!readFileSync(process.argv[3], "utf8").includes('CodeWideAppNotice')) {
  throw new Error("Android bundle does not contain the native notice component name");
}
console.log("Android bundle verified: workspace present, no V2 frontend or sync-client modules.");
NODE
