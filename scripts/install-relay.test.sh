#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TMP_ROOT=${TMPDIR:-/tmp}
TEST_ROOT=$(mktemp -d "$TMP_ROOT/codewide-relay-installer-test.XXXXXX")

cleanup() {
  case "$TEST_ROOT" in
    "$TMP_ROOT"/codewide-relay-installer-test.*) rm -rf -- "$TEST_ROOT" ;;
    *) printf 'Refusing to remove unexpected directory: %s\n' "$TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

DIST_ROOT=${CODEWIDE_RELAY_TEST_DIST_DIR:-"$TEST_ROOT/release"}
if [ -z "${CODEWIDE_RELAY_TEST_DIST_DIR:-}" ]; then
  CODEWIDE_RELAY_DIST_DIR=$DIST_ROOT \
    CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID=test-relay-update \
    CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI=dGVzdA== \
    "$REPO_ROOT/scripts/build-relay-linux" >/dev/null
fi
asset=codewide-relay-x86_64-unknown-linux-musl
updater_asset=codewide-relay-updater-x86_64-unknown-linux-musl
version=$("$DIST_ROOT/$asset" --version | awk '{print $2}')
INSTALL_ROOT="$TEST_ROOT/bin with spaces"

curl --fail --silent --show-error "file://$REPO_ROOT/install/relay" \
  | PATH="$INSTALL_ROOT:$PATH" CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh -s -- \
      --version "$version" \
      --install-dir "$INSTALL_ROOT" \
      --download-base-url "file://$DIST_ROOT" --no-start >"$TEST_ROOT/install.log"

# Execute by name in a fresh shell: an absolute-path version check alone missed
# the broken installation contract when ~/.local/bin was absent from PATH.
test "$(PATH="$INSTALL_ROOT:$PATH" sh -c 'command -v codewide-relay')" = "$INSTALL_ROOT/codewide-relay"
test "$(PATH="$INSTALL_ROOT:$PATH" sh -c 'codewide-relay --version')" = "codewide-relay $version"
grep -F 'Service activation skipped.' "$TEST_ROOT/install.log" >/dev/null
test "$(stat -c '%a' "$INSTALL_ROOT")" = 755
test "$(stat -c '%a' "$INSTALL_ROOT/codewide-relay")" = 755
test "$(stat -c '%a' "$INSTALL_ROOT/codewide-relay-updater")" = 755
installed_sha256=$(sha256sum "$INSTALL_ROOT/codewide-relay" | awk '{print $1}')
release_sha256=$(awk '{print $1}' "$DIST_ROOT/$asset.sha256")
test "$installed_sha256" = "$release_sha256"
test "$(sha256sum "$INSTALL_ROOT/codewide-relay-updater" | awk '{print $1}')" = \
  "$(awk '{print $1}' "$DIST_ROOT/$updater_asset.sha256")"

TAMPERED_ROOT="$TEST_ROOT/tampered"
mkdir -p "$TAMPERED_ROOT"
cp "$DIST_ROOT/$asset" "$TAMPERED_ROOT/$asset"
cp "$DIST_ROOT/$asset.sha256" "$TAMPERED_ROOT/$asset.sha256"
printf 'tampered\n' >>"$TAMPERED_ROOT/$asset"

if PATH="$INSTALL_ROOT:$PATH" CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh "$REPO_ROOT/install/relay" \
  --version "$version" \
  --install-dir "$INSTALL_ROOT" \
  --download-base-url "file://$TAMPERED_ROOT" --no-start >/dev/null 2>&1; then
  printf '%s\n' 'Installer accepted a tampered Relay artifact.' >&2
  exit 1
fi

test "$(sha256sum "$INSTALL_ROOT/codewide-relay" | awk '{print $1}')" = "$installed_sha256"

if CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh "$REPO_ROOT/install/relay" \
  --version "$version" --install-dir "$TEST_ROOT/not-in-path" \
  --download-base-url "file://$DIST_ROOT" --no-start >"$TEST_ROOT/path.log" 2>&1; then
  printf '%s\n' 'Installer reported success outside PATH.' >&2
  exit 1
fi
grep -F 'Installation directory is not in PATH' "$TEST_ROOT/path.log" >/dev/null
test ! -e "$TEST_ROOT/not-in-path"

if PATH="$INSTALL_ROOT:$TEST_ROOT/shadowed:$PATH" CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 \
  sh "$REPO_ROOT/install/relay" --version "$version" \
  --install-dir "$TEST_ROOT/shadowed" --download-base-url "file://$DIST_ROOT" --no-start \
  >"$TEST_ROOT/shadowed.log" 2>&1; then
  printf '%s\n' 'Installer hid the installed executable behind another PATH entry.' >&2
  exit 1
fi
grep -F 'Another codewide-relay is already selected by PATH' "$TEST_ROOT/shadowed.log" >/dev/null
test ! -e "$TEST_ROOT/shadowed"

# An explicit destination from the environment obeys the same PATH contract.
ENV_ROOT="$TEST_ROOT/from-env"
PATH="$ENV_ROOT:$PATH" CODEWIDE_RELAY_INSTALL_DIR="$ENV_ROOT" \
  CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 sh "$REPO_ROOT/install/relay" \
  --version "$version" --download-base-url "file://$DIST_ROOT" --no-start >/dev/null
test "$(PATH="$ENV_ROOT:$PATH" sh -c 'codewide-relay --version')" = "codewide-relay $version"
python3 "$REPO_ROOT/scripts/relay-installer-service.test.py" "$DIST_ROOT"
printf '%s\n' 'relay installer tests passed'
