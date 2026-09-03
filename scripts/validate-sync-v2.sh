#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export CARGO_INCREMENTAL=0

cd "$repo_root"
pnpm --filter @codewide/sync-client contract:check
pnpm exec vitest run packages/sync-client/test/v2-*.test.ts
cargo test -p codewide-companion sync_v2 --lib

for source in \
  "$repo_root"/apps/companion/tests/v2_*.rs \
  "$repo_root"/apps/companion/tests/live_v2*.rs
do
  [ -f "$source" ] || continue
  target=${source##*/}
  target=${target%.rs}
  cargo test -p codewide-companion --test "$target"
done
