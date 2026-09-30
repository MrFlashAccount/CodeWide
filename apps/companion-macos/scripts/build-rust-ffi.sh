#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)
core_version=${CODEWIDE_CORE_VERSION:-dev}
version_key=$(printf '%s' "$core_version" | tr -c 'A-Za-z0-9._-' '_')
output_root=${1:-"$mac_root/.build/rust/$version_key"}
case "$output_root" in
  /*) ;;
  *) output_root="$repo_root/$output_root" ;;
esac
arm_target=aarch64-apple-darwin

export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-26.0}"

rustup target add "$arm_target"
cargo build --manifest-path "$repo_root/Cargo.toml" \
  --locked --release -p companion-swift-ffi --target "$arm_target"

mkdir -p "$output_root"
archive="$output_root/libcompanion_swift_ffi.a"
cp "$repo_root/target/$arm_target/release/libcompanion_swift_ffi.a" "$archive"

generated=$(mktemp -d "${TMPDIR:-/tmp}/codewide-uniffi-check.XXXXXX")
trap 'rm -rf -- "$generated"' EXIT HUP INT TERM
cargo run --manifest-path "$repo_root/Cargo.toml" --locked --quiet \
  -p companion-swift-ffi --bin uniffi-bindgen -- \
  generate \
  --library "$repo_root/target/$arm_target/release/libcompanion_swift_ffi.a" \
  --language swift \
  --out-dir "$generated"

swift_source=$(find "$generated" -maxdepth 1 -type f -name '*.swift' -print -quit)
header=$(find "$generated" -maxdepth 1 -type f -name '*.h' -print -quit)
perl -0pi -e 's/[ \t]+(?=\r?$)//mg; s/(?:\r?\n)+\z/\n/' "$swift_source" "$header"
if ! cmp -s "$swift_source" "$mac_root/Sources/CompanionSwiftFFI/companion_swift_ffi.swift" || \
   ! cmp -s "$header" "$mac_root/Sources/CompanionSwiftFFIFFI/include/companion_swift_ffiFFI.h"; then
  echo "Committed UniFFI bindings are stale; run apps/companion-macos/scripts/generate-swift-bindings.sh." >&2
  exit 1
fi

printf '%s\n' "$archive"
