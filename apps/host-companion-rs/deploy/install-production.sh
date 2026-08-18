#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary="$repo_root/target/release/codewide-host-rs"
unit_source="$repo_root/apps/host-companion-rs/deploy/codewide-host-rust.service"
binary_root="$HOME/.local/lib/codewide-rust"
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state_root="${XDG_STATE_HOME:-$HOME/.local/state}/codewide-rust"
control_endpoint="${CODEWIDE_CONTROL_ENDPOINT:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide/companion-control.sock}"

test -x "$binary"
mkdir -p "$binary_root" "$unit_root"

install -m 0755 "$binary" "$binary_root/codewide-host-rs"
install -m 0644 "$unit_source" "$unit_root/codewide-host-rust.service"
systemctl --user daemon-reload
systemctl --user disable --now codewide-host-rust-shadow.service 2>/dev/null || true

legacy_rust_active=0
legacy_node_active=0
if systemctl --user is-active --quiet codex-remote-host-rust.service; then
  legacy_rust_active=1
fi
if systemctl --user is-active --quiet codex-remote-host.service; then
  legacy_node_active=1
fi
restore_legacy() {
  systemctl --user stop codewide-host-rust.service 2>/dev/null || true
  if [ "$legacy_rust_active" -eq 1 ]; then
    systemctl --user start codex-remote-host-rust.service 2>/dev/null || true
  fi
  if [ "$legacy_node_active" -eq 1 ]; then
    systemctl --user start codex-remote-host.service 2>/dev/null || true
  fi
}

# Stop every legacy writer before the atomic rename. The migration leaves
# legacy symlink aliases behind, so rollback and old tooling still see the same
# bytes without maintaining a second copy of the state.
systemctl --user stop codex-remote-host-rust-shadow.service 2>/dev/null || true
systemctl --user stop codex-remote-host-rust.service 2>/dev/null || true
systemctl --user stop codex-remote-host.service 2>/dev/null || true
if ! "$binary_root/codewide-host-rs" migrate-state; then
  restore_legacy
  exit 1
fi

test -s "$HOME/.codewide/host.token"
test -s "$HOME/.codewide/devices.json"
mkdir -p "$state_root"

# Preserve the already-warmed derived resource projection. Canonical rollout
# JSONL remains the source of truth; this copy is only a cutover optimization.
# The shadow is stopped first so redb is copied from a stable file.
if [ ! -e "$state_root/resource-index.redb" ] && [ -e "$HOME/.local/state/codewide-rust-shadow/resource-index.redb" ]; then
  cp "$HOME/.local/state/codewide-rust-shadow/resource-index.redb" "$state_root/resource-index.redb"
fi

systemctl --user enable codewide-host-rust.service
systemctl --user restart codewide-host-rust.service

attempt=0
while ! curl --silent --fail --unix-socket "$control_endpoint" http://localhost/healthz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    systemctl --user status codewide-host-rust.service --no-pager >&2 || true
    restore_legacy
    exit 1
  fi
  sleep 0.2
done

# Rust is now the sole production companion. Disable the retired Node service
# only after the Rust health gate succeeds, so an unsuccessful install cannot
# take the existing endpoint down.
systemctl --user disable --now codewide-host.service 2>/dev/null || true
systemctl --user disable codex-remote-host-rust.service 2>/dev/null || true
systemctl --user disable codex-remote-host-rust-shadow.service 2>/dev/null || true
systemctl --user disable codex-remote-host.service 2>/dev/null || true
