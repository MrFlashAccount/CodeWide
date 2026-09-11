#!/bin/sh
set -eu

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-cargo-budget-test.XXXXXX")
trap 'rm -rf -- "$fixture_root"' EXIT HUP INT TERM

repo="$fixture_root/repo"
fake_bin="$fixture_root/bin"
log="$fixture_root/cargo.log"
mkdir -p "$repo/scripts" "$repo/target" "$fake_bin"
cp "$source_root/scripts/cargo-target-budget.sh" "$repo/scripts/cargo-target-budget.sh"

dd if=/dev/zero of="$repo/target/artifact" bs=1048576 count=2 2>/dev/null

cat >"$fake_bin/cargo" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$CODEWIDE_CARGO_TEST_LOG"
EOF
chmod +x "$fake_bin/cargo"

run_guard() {
  PATH="$fake_bin:$PATH" \
    CODEWIDE_CARGO_TEST_LOG="$log" \
    CODEWIDE_CARGO_TARGET_MAX_MIB=$1 \
    CODEWIDE_CARGO_MIN_FREE_MIB=$2 \
    sh "$repo/scripts/cargo-target-budget.sh"
}

: >"$log"
run_guard 3 0
if [ -s "$log" ]; then
  printf '%s\n' 'expected an under-budget target to be preserved' >&2
  exit 1
fi

: >"$log"
run_guard 1 0
expected="clean --target-dir $repo/target"
if [ "$(cat "$log")" != "$expected" ]; then
  printf 'unexpected cleanup command: %s\n' "$(cat "$log")" >&2
  exit 1
fi

: >"$log"
run_guard 0 999999999
if [ "$(cat "$log")" != "$expected" ]; then
  printf '%s\n' 'expected low free space to trigger cleanup' >&2
  exit 1
fi

if PATH="$fake_bin:$PATH" \
  CODEWIDE_CARGO_TEST_LOG="$log" \
  CARGO_TARGET_DIR="$fixture_root/shared-target" \
  sh "$repo/scripts/cargo-target-budget.sh" >/dev/null 2>&1
then
  printf '%s\n' 'expected a custom CARGO_TARGET_DIR to be rejected' >&2
  exit 1
fi

: >"$log"
PATH="$fake_bin:$PATH" \
  CODEWIDE_CARGO_TEST_LOG="$log" \
  CODEWIDE_CARGO_TARGET_BUDGET_CHECKED=1 \
  CARGO_TARGET_DIR="$fixture_root/shared-target" \
  sh "$repo/scripts/cargo-target-budget.sh"
if [ -s "$log" ]; then
  printf '%s\n' 'expected an already-checked compound gate to skip cleanup' >&2
  exit 1
fi

printf '%s\n' 'cargo target budget tests passed'
