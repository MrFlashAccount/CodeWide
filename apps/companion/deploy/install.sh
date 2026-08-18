#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary="$repo_root/target/release/codewide-companion"
unit_source="$repo_root/apps/companion/deploy/codewide-companion.service"
binary_root="$HOME/.local/lib/codewide"
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
state_root="$state_home/codewide/companion"
previous_state_root="$state_home/codewide-rust"
control_endpoint="${CODEWIDE_CONTROL_ENDPOINT:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide/companion-control.sock}"

test -x "$binary"
mkdir -p "$binary_root" "$unit_root"
install -m 0755 "$binary" "$binary_root/codewide-companion"
install -m 0644 "$unit_source" "$unit_root/codewide-companion.service"
systemctl --user daemon-reload

previous_unit=
for candidate in codewide-host-rust.service codewide-host.service codex-remote-host-rust.service codex-remote-host.service; do
  if systemctl --user is-active --quiet "$candidate"; then
    previous_unit=$candidate
    break
  fi
done

restore_previous() {
  systemctl --user stop codewide-companion.service 2>/dev/null || true
  if [ -n "$previous_unit" ]; then
    systemctl --user start "$previous_unit" 2>/dev/null || true
  fi
}

# No two companion generations may write the same outbox or replay state.
for legacy in codewide-host-rust-shadow.service codewide-host-rust.service codewide-host.service codex-remote-host-rust-shadow.service codex-remote-host-rust.service codex-remote-host.service; do
  systemctl --user stop "$legacy" 2>/dev/null || true
done

if ! "$binary_root/codewide-companion" migrate-state; then
  restore_previous
  exit 1
fi

test -s "$HOME/.codewide/host.token"

# `codewide-rust` is the previous production state location. Move it once and
# leave a compatibility alias so rollback binaries continue to see the same
# bytes instead of creating a divergent database.
if [ ! -e "$state_root" ] && [ -d "$previous_state_root" ] && [ ! -L "$previous_state_root" ]; then
  mkdir -p "$(dirname -- "$state_root")"
  mv "$previous_state_root" "$state_root"
  ln -s "$state_root" "$previous_state_root"
fi
if [ -e "$state_root" ] && [ -d "$previous_state_root" ] && [ ! -L "$previous_state_root" ]; then
  printf '%s\n' 'refusing to merge two non-empty companion state roots' >&2
  restore_previous
  exit 1
fi
mkdir -p "$state_root"

systemctl --user enable codewide-companion.service
systemctl --user restart codewide-companion.service

attempt=0
while ! curl --silent --fail --unix-socket "$control_endpoint" http://localhost/healthz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    systemctl --user status codewide-companion.service --no-pager >&2 || true
    restore_previous
    exit 1
  fi
  sleep 0.2
done

for legacy in codewide-host-rust-shadow.service codewide-host-rust.service codewide-host.service codex-remote-host-rust-shadow.service codex-remote-host-rust.service codex-remote-host.service; do
  systemctl --user disable "$legacy" 2>/dev/null || true
done
