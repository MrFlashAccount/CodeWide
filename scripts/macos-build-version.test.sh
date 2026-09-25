#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
subject="$repo_root/scripts/macos-build-version"

assert_version() {
  expected=$1
  version=$2
  actual=$($subject "$version")
  if [ "$actual" != "$expected" ]; then
    printf 'expected %s for %s, got %s\n' "$expected" "$version" "$actual" >&2
    exit 1
  fi
}

assert_rejected() {
  version=$1
  if "$subject" "$version" >/dev/null 2>&1; then
    printf 'expected %s to be rejected\n' "$version" >&2
    exit 1
  fi
}

assert_version 200000.4.0 0.4.0
assert_version 200000.4.1 0.4.1
assert_version 200001.0.0 1.0.0
assert_rejected 0.4
assert_rejected 0.04.0
assert_rejected 0.4.0.
assert_rejected 0.4.0-beta.1

printf '%s\n' 'macOS build version tests passed'
