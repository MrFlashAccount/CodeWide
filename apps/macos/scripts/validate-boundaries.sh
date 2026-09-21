#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)

if rg -n 'axum|reqwest|UnixListener|UnixStream|\.sock|/healthz' \
  "$mac_root/Sources"; then
  echo "macOS Swift sources contain a forbidden local transport." >&2
  exit 1
fi
if rg -n 'NSXPC|UnixStream|reqwest|axum|http::' \
  "$repo_root/crates/companion-control"; then
  echo "companion-control contains transport-specific types." >&2
  exit 1
fi
if rg -n 'codewide-companion|control\.sock' \
  "$mac_root/Resources" "$mac_root/Sources"; then
  echo "macOS bundle inputs reference the Linux CLI or control socket." >&2
  exit 1
fi

if command -v xmllint >/dev/null 2>&1; then
  xmllint --noout \
    "$mac_root/Resources/Info.plist" \
    "$mac_root/Resources/dev.codewide.runtime.plist"
elif command -v plutil >/dev/null 2>&1; then
  plutil -lint \
    "$mac_root/Resources/Info.plist" \
    "$mac_root/Resources/dev.codewide.runtime.plist"
else
  echo "XML plist validation skipped: xmllint and plutil are unavailable." >&2
fi
test "$(sed -n 's/.*macOS("\([0-9][0-9]*[.]0\)").*/\1/p' "$mac_root/Package.swift")" = 26.0
