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

ordering="$repo_root/scripts/assert-newer-macos-version"
sh "$ordering" 0.5.0 0.4.0
sh "$ordering" 0.4.1 0.4.0
sh "$ordering" 0.10.0 0.9.99
sh "$ordering" 1.0.0 0.99.99
for versions in '0.4.0 0.4.0' '0.4.0 0.5.0' '0.9.99 0.10.0' '0.99.99 1.0.0'; do
  # Each case deliberately supplies the CLI's two separate version arguments.
  set -- $versions
  if sh "$ordering" "$1" "$2" >/dev/null 2>&1; then
    printf 'accepted a non-increasing macOS version: %s\n' "$versions" >&2
    exit 1
  fi
done
if sh "$ordering" 0.5.0-beta.1 0.4.0 >/dev/null 2>&1; then
  printf '%s\n' 'accepted a prerelease outside the stable macOS version contract' >&2
  exit 1
fi

printf '%s\n' 'macOS build version tests passed'
