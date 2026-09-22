#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP_ROOT=${TMPDIR:-/tmp}
TEST_ROOT=$(mktemp -d "$TMP_ROOT/codewide-relay-installer-test.XXXXXX")

cleanup() {
  case "$TEST_ROOT" in
    "$TMP_ROOT"/codewide-relay-installer-test.*) rm -rf -- "$TEST_ROOT" ;;
    *) printf 'Refusing to remove unexpected directory: %s\n' "$TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

DIST_ROOT="$TEST_ROOT/release"
CODEWIDE_RELAY_DIST_DIR=$DIST_ROOT "$REPO_ROOT/scripts/build-relay-linux" >/dev/null
asset=codewide-relay-x86_64-unknown-linux-musl
version=$($DIST_ROOT/$asset --version | awk '{print $2}')

curl --fail --silent --show-error "file://$REPO_ROOT/install/relay" \
  | CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh -s -- \
      --install-dir "$TEST_ROOT/bin" \
      --download-base-url "file://$DIST_ROOT" >/dev/null

test "$($TEST_ROOT/bin/codewide-relay --version)" = "codewide-relay $version"
installed_sha256=$(sha256sum "$TEST_ROOT/bin/codewide-relay" | awk '{print $1}')
release_sha256=$(awk '{print $1}' "$DIST_ROOT/$asset.sha256")
test "$installed_sha256" = "$release_sha256"

TAMPERED_ROOT="$TEST_ROOT/tampered"
mkdir -p "$TAMPERED_ROOT"
cp "$DIST_ROOT/$asset" "$TAMPERED_ROOT/$asset"
cp "$DIST_ROOT/$asset.sha256" "$TAMPERED_ROOT/$asset.sha256"
printf 'tampered\n' >>"$TAMPERED_ROOT/$asset"

if CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh "$REPO_ROOT/install/relay" \
  --version "$version" \
  --install-dir "$TEST_ROOT/bin" \
  --download-base-url "file://$TAMPERED_ROOT" >/dev/null 2>&1; then
  printf '%s\n' 'Installer accepted a tampered Relay artifact.' >&2
  exit 1
fi

test "$(sha256sum "$TEST_ROOT/bin/codewide-relay" | awk '{print $1}')" = "$installed_sha256"
printf '%s\n' 'relay installer tests passed'
