#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)

if grep -RnE 'axum|reqwest|UnixListener|UnixStream|\.sock|/healthz' \
  "$mac_root/Sources"; then
  echo "macOS Swift sources contain a forbidden local transport." >&2
  exit 1
else
  result=$?
  [ "$result" -eq 1 ] || exit "$result"
fi
if grep -RnE 'NSXPC|UnixStream|reqwest|axum|http::' \
  "$repo_root/crates/companion-core/src/runtime_host.rs" \
  "$repo_root/crates/companion-swift-ffi"; then
  echo "macOS runtime/FFI boundary contains transport-specific types." >&2
  exit 1
else
  result=$?
  [ "$result" -eq 1 ] || exit "$result"
fi
if grep -RnE 'codewide-companion|control\.sock' \
  "$mac_root/Resources" "$mac_root/Sources"; then
  echo "macOS bundle inputs reference the Linux CLI or control socket." >&2
  exit 1
else
  result=$?
  [ "$result" -eq 1 ] || exit "$result"
fi

# Contents/Helpers may hold exactly one Rust helper, the built-in GitHub forge
# plugin (plus the E2E-only unregister helper). The companion itself never
# ships as a helper.
helpers=$(grep -oE '"\$helpers_dir/[A-Za-z0-9_.-]+"' "$mac_root/scripts/build-app.sh" | LC_ALL=C sort -u | tr '\n' ' ')
if [ "$helpers" != '"$helpers_dir/CodeWideE2EUnregister" "$helpers_dir/codewide-forge-github" ' ]; then
  echo "build-app.sh installs unexpected helpers: $helpers" >&2
  exit 1
fi
if grep -nE 'Helpers/codewide-companion"?$' "$mac_root/scripts/build-app.sh" | grep -v 'test ! -e' >/dev/null; then
  echo "build-app.sh must never ship codewide-companion as a helper." >&2
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
sh "$repo_root/scripts/macos-build-version.test.sh"
sh "$mac_root/scripts/build-app-release-tag.test.sh"
