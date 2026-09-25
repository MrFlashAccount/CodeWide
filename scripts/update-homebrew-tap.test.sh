#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-homebrew-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT HUP INT TERM
tap_root="$test_root/tap"
mkdir -p "$tap_root/Formula" "$tap_root/Casks"
printf 'legacy formula\n' >"$tap_root/Formula/codewide-companion.rb"

linux_sha=$(printf '%064d' 1)
macos_sha=$(printf '%064d' 2)
relay_sha=$(printf '%064d' 3)

"$repo_root/scripts/update-homebrew-tap" linux 0.4.2 "$linux_sha" "$tap_root" v0.4.2
test ! -e "$tap_root/Formula/codewide-companion.rb"
test -f "$tap_root/Formula/codewide.rb"
grep -Fq 'class Codewide < Formula' "$tap_root/Formula/codewide.rb"
grep -Fq '/v0.4.2/codewide-companion-0.4.2-x86_64-unknown-linux-musl.tar.gz' "$tap_root/Formula/codewide.rb"
grep -Fq "sha256 \"$linux_sha\"" "$tap_root/Formula/codewide.rb"
grep -Fq 'brew services start codewide' "$tap_root/Formula/codewide.rb"
test "$(cat "$tap_root/formula_renames.json")" = '{"codewide-companion":"codewide"}'

"$repo_root/scripts/update-homebrew-tap" macos 0.4.2 "$macos_sha" "$tap_root" v0.4.2
"$repo_root/scripts/update-homebrew-tap" relay 0.4.2 "$relay_sha" "$tap_root" v0.4.2
test -f "$tap_root/Casks/codewide.rb"
test -f "$tap_root/Formula/codewide.rb"
grep -Fq 'class Relay < Formula' "$tap_root/Formula/relay.rb"
grep -Fq '/v0.4.2/codewide-relay-x86_64-unknown-linux-musl' "$tap_root/Formula/relay.rb"
grep -Fq "sha256 \"$relay_sha\"" "$tap_root/Formula/relay.rb"
grep -Fq 'using: :nounzip' "$tap_root/Formula/relay.rb"

"$repo_root/scripts/update-homebrew-tap" relay 0.4.0 "$relay_sha" "$tap_root"
grep -Fq '/relay-v0.4.0/codewide-relay-x86_64-unknown-linux-musl' "$tap_root/Formula/relay.rb"
test -f "$tap_root/Formula/codewide.rb"
test -f "$tap_root/Casks/codewide.rb"

if command -v ruby >/dev/null 2>&1; then
  ruby -c "$tap_root/Formula/codewide.rb" >/dev/null
  ruby -c "$tap_root/Formula/relay.rb" >/dev/null
  ruby -c "$tap_root/Casks/codewide.rb" >/dev/null
fi

printf '%s\n' 'Homebrew tap generation passed.'
