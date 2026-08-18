#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
separator=$(printf '\037')
remap="--remap-path-prefix=$HOME=/codewide-build"

if [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
  CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS}${separator}${remap}"
else
  CARGO_ENCODED_RUSTFLAGS=$remap
fi
export CARGO_ENCODED_RUSTFLAGS

cd "$repo_root"
exec cargo build --release -p codewide-companion "$@"
