#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)
library=${1:-"$repo_root/target/release/libcompanion_swift_ffi.a"}

if [ ! -f "$library" ]; then
  cargo build --manifest-path "$repo_root/Cargo.toml" --release -p companion-swift-ffi
fi

generated=$(mktemp -d "${TMPDIR:-/tmp}/codewide-uniffi.XXXXXX")
trap 'rm -rf -- "$generated"' EXIT HUP INT TERM

cargo run --manifest-path "$repo_root/Cargo.toml" --quiet \
  -p companion-swift-ffi --bin uniffi-bindgen -- \
  generate --library "$library" --language swift --out-dir "$generated"

swift_source=$(find "$generated" -maxdepth 1 -type f -name '*.swift' -print -quit)
header=$(find "$generated" -maxdepth 1 -type f -name '*.h' -print -quit)
if [ -z "$swift_source" ] || [ -z "$header" ]; then
  echo "UniFFI did not generate the expected Swift source and C header." >&2
  exit 1
fi

cp "$swift_source" "$mac_root/Sources/CompanionSwiftFFI/companion_swift_ffi.swift"
cp "$header" "$mac_root/Sources/CompanionSwiftFFIFFI/include/companion_swift_ffiFFI.h"

# UniFFI emits trailing blanks in generated Swift/C output. Normalize only
# whitespace so the committed bindings remain reproducible and pass diff checks.
perl -0pi -e 's/[ \t]+(?=\r?$)//mg; s/(?:\r?\n)+\z/\n/' \
  "$mac_root/Sources/CompanionSwiftFFI/companion_swift_ffi.swift" \
  "$mac_root/Sources/CompanionSwiftFFIFFI/include/companion_swift_ffiFFI.h"
