#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_root=${TMPDIR:-/tmp}
test_root=$(mktemp -d "$tmp_root/codewide-companion-installer-test.XXXXXX")

cleanup() {
  case "$test_root" in
    "$tmp_root"/codewide-companion-installer-test.*) rm -rf -- "$test_root" ;;
    *) printf 'Refusing to remove unexpected directory: %s\n' "$test_root" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

dist_root=${CODEWIDE_COMPANION_DIST_DIR:-"$test_root/release"}
if ! find "$dist_root" -maxdepth 1 -name 'codewide-companion-*-x86_64-unknown-linux-musl.tar.gz' -print -quit 2>/dev/null | grep -q .; then
  CODEWIDE_COMPANION_DIST_DIR="$dist_root" "$repo_root/scripts/build-companion-linux" >/dev/null
fi

archive=$(find "$dist_root" -maxdepth 1 -name 'codewide-companion-*-x86_64-unknown-linux-musl.tar.gz' -print -quit)
asset=$(basename "$archive")
version=${asset#codewide-companion-}
version=${version%-x86_64-unknown-linux-musl.tar.gz}
bundle_name=codewide-companion-x86_64-unknown-linux-musl
bundled_trust="$test_root/bundled-trust.json"
tar -xOzf "$archive" "$bundle_name/bootstrap/config.json" >"$bundled_trust"
bundled_generation="$test_root/bundled-generation.json"
tar -xOzf "$archive" "$bundle_name/bootstrap/generation.json" >"$bundled_generation"
install_root="$test_root/install"
unit_root="$test_root/systemd"
test_home="$test_root/home"
mkdir -p "$test_home"

HOME="$test_home" \
XDG_CONFIG_HOME="$test_home/.config" \
XDG_STATE_HOME="$test_home/.local/state" \
CODEWIDE_COMPANION_ALLOW_INSECURE_DOWNLOAD=1 \
  sh "$repo_root/install/companion" \
    --version "$version" \
    --install-root "$install_root" \
    --unit-root "$unit_root" \
    --download-base-url "file://$dist_root" \
    --no-start >/dev/null

bundle_digest=$(awk 'NR == 1 { print $1 }' "$archive.sha256")
test -L "$install_root/current"
test "$(readlink "$install_root/current")" = "generations/$bundle_digest"
test -d "$install_root/generations/$bundle_digest"
test "$("$install_root/current/bin/codewide-companion" --version)" = "codewide-companion $version"
test -x "$install_root/current/libexec/codewide-vcs-git"
test -x "$install_root/current/libexec/codewide-companion-memory-watch"
grep -F '"artifactDigest":"'"$bundle_digest"'"' \
  "$install_root/current/metadata.json" >/dev/null
test -x "$install_root/bootstrap/codewide-companion-update-guardian"
test ! -e "$install_root/current/libexec/codewide-companion-update-guardian"
cmp "$bundled_trust" "$install_root/bootstrap/config.json"
expected_build=$(sed -n 's/.*"build":"\([0-9a-f]*\)".*/\1/p' "$bundled_generation")
expected_source_revision=$(sed -n 's/.*"sourceRevision":"\([0-9a-f]*\)".*/\1/p' "$bundled_generation")
test -n "$expected_build"
test -n "$expected_source_revision"
grep -F '"build":"'"$expected_build"'"' "$install_root/current/metadata.json" >/dev/null
grep -F '"sourceRevision":"'"$expected_source_revision"'"' \
  "$install_root/current/metadata.json" >/dev/null
test -r "$unit_root/codewide-companion.service"
test -r "$unit_root/codewide-companion-update.service"
test -r "$unit_root/codewide-companion-memory-watch.service"
test -r "$unit_root/codewide-companion-memory-watch.timer"
test -s "$test_home/.codewide/host.token"

installed_sha256=$(sha256sum "$install_root/current/bin/codewide-companion" | awk '{print $1}')
tampered_root="$test_root/tampered"
mkdir -p "$tampered_root"
cp "$archive" "$tampered_root/$asset"
cp "$archive.sha256" "$tampered_root/$asset.sha256"
printf 'tampered\n' >>"$tampered_root/$asset"

if HOME="$test_home" \
  XDG_CONFIG_HOME="$test_home/.config" \
  XDG_STATE_HOME="$test_home/.local/state" \
  CODEWIDE_COMPANION_ALLOW_INSECURE_DOWNLOAD=1 \
    sh "$repo_root/install/companion" \
      --version "$version" \
      --install-root "$install_root" \
      --unit-root "$unit_root" \
      --download-base-url "file://$tampered_root" \
      --no-start >/dev/null 2>&1; then
  printf '%s\n' 'Installer accepted a tampered Companion bundle.' >&2
  exit 1
fi

test "$(readlink "$install_root/current")" = "generations/$bundle_digest"
test "$(sha256sum "$install_root/current/bin/codewide-companion" | awk '{print $1}')" = "$installed_sha256"

legacy_home="$test_root/legacy-home"
legacy_install_root="$test_root/legacy-install"
legacy_unit_root="$test_root/legacy-systemd"
mkdir -p "$legacy_home/.codex-remote"
printf '%s\n' 'legacy-administrator-token-that-must-survive' >"$legacy_home/.codex-remote/host.token"
chmod 0600 "$legacy_home/.codex-remote/host.token"

HOME="$legacy_home" \
XDG_CONFIG_HOME="$legacy_home/.config" \
XDG_STATE_HOME="$legacy_home/.local/state" \
CODEWIDE_COMPANION_ALLOW_INSECURE_DOWNLOAD=1 \
  sh "$repo_root/install/companion" \
    --version "$version" \
    --install-root "$legacy_install_root" \
    --unit-root "$legacy_unit_root" \
    --download-base-url "file://$dist_root" \
    --no-start >/dev/null

test "$(cat "$legacy_home/.codewide/host.token")" = 'legacy-administrator-token-that-must-survive'
test -L "$legacy_home/.codex-remote"
printf '%s\n' 'companion installer tests passed'
