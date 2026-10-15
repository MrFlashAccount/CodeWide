#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_app="$mac_root/scripts/build-app.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-release-tag.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT HUP INT TERM
mkdir -p "$test_root/bin"
cat >"$test_root/bin/swift" <<'SH'
#!/bin/sh
exit 73
SH
cat >"$test_root/bin/uname" <<'SH'
#!/bin/sh
if [ "$#" -ne 1 ] || [ "$1" != -s ]; then
  exit 74
fi
printf 'Darwin\n'
SH
chmod +x "$test_root/bin/swift" "$test_root/bin/uname"
output="$test_root/output"

run_build_tag() {
  tag=$1
  set +e
  PATH="$test_root/bin:$PATH" \
    CODEWIDE_RELEASE_TAG="$tag" \
    CODEWIDE_SPARKLE_PUBLIC_KEY=stub \
    CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI=AA== \
    CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID=release-v1 \
    CODEWIDE_SOURCE_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    CODEWIDE_FFI_ARCHIVE="$test_root/libcompanion_swift_ffi.a" \
    sh "$build_app" >"$output" 2>&1
  status=$?
  set -e
  return "$status"
}

# Accepted tags reach the stubbed Swift build and fail there with its status.
for tag in '' v0.0.0 v12.34.56 v01.002.0003 \
  release-2026-10-11.0 release-0000-00-00.123; do
  if run_build_tag "$tag"; then
    status=0
  else
    status=$?
  fi
  if [ "$status" -ne 73 ]; then
    echo "build-app rejected an accepted release tag: $tag" >&2
    cat "$output" >&2
    exit 1
  fi
done

newline_tag='v1.2.3
junk'
for tag in v1.2 v1.2.3.4 v1.2.3junk junkv1.2.3 \
  release-2026-10-11 release-2026-10-11.1junk \
  release-2026-1-11.1 release-2026-10-11.-1 "$newline_tag"; do
  if run_build_tag "$tag"; then
    status=0
  else
    status=$?
  fi
  if [ "$status" -ne 2 ] \
    || ! grep -Fq 'CODEWIDE_RELEASE_TAG must be' "$output"; then
    echo "build-app did not reject an invalid release tag: $tag" >&2
    cat "$output" >&2
    exit 1
  fi
done
