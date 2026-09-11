#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_dir="$repo_root/target"
max_mib=${CODEWIDE_CARGO_TARGET_MAX_MIB:-40960}
min_free_mib=${CODEWIDE_CARGO_MIN_FREE_MIB:-51200}

if [ "${CODEWIDE_CARGO_TARGET_BUDGET_CHECKED:-0}" = "1" ]; then
  exit 0
fi

validate_mib() {
  variable_name=$1
  value=$2
  case "$value" in
    ''|*[!0-9]*)
      printf '%s must be a non-negative integer in MiB, got: %s\n' "$variable_name" "$value" >&2
      exit 2
      ;;
  esac
}

validate_mib CODEWIDE_CARGO_TARGET_MAX_MIB "$max_mib"
validate_mib CODEWIDE_CARGO_MIN_FREE_MIB "$min_free_mib"

if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  printf '%s\n' 'cargo-target-budget: CARGO_TARGET_DIR is already set; refusing to clean a target directory not owned by this workspace.' >&2
  exit 2
fi

if [ ! -d "$target_dir" ]; then
  exit 0
fi
if [ -L "$target_dir" ]; then
  printf '%s\n' 'cargo-target-budget: refusing to clean a symlinked target directory.' >&2
  exit 2
fi

target_kib=$(du -sk "$target_dir" | awk '{ print $1 }')
free_kib=$(df -Pk "$repo_root" | awk 'NR == 2 { print $4 }')
max_kib=$((max_mib * 1024))
min_free_kib=$((min_free_mib * 1024))
reason=

if [ "$max_mib" -gt 0 ] && [ "$target_kib" -gt "$max_kib" ]; then
  reason="target uses $((target_kib / 1024)) MiB; limit is $max_mib MiB"
elif [ "$min_free_mib" -gt 0 ] && [ "$free_kib" -lt "$min_free_kib" ]; then
  reason="filesystem has $((free_kib / 1024)) MiB free; minimum is $min_free_mib MiB"
fi

if [ -z "$reason" ]; then
  exit 0
fi

printf 'cargo-target-budget: %s; running cargo clean\n' "$reason"
cd "$repo_root"
exec cargo clean --target-dir "$target_dir"
