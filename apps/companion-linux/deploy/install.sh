#!/bin/sh
# Manual baseline installer. Remote updates never execute this payload script;
# they are owned by the stable bootstrap guardian installed below.
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary=${CODEWIDE_COMPANION_BINARY:-"$repo_root/target/release/codewide-companion"}
git_plugin_binary=${CODEWIDE_COMPANION_GIT_PLUGIN_BINARY:-"$repo_root/target/release/codewide-vcs-git"}
update_guardian_binary=${CODEWIDE_COMPANION_UPDATE_GUARDIAN_BINARY:-"$repo_root/target/release/codewide-companion-update-guardian"}
unit_source=${CODEWIDE_COMPANION_UNIT_SOURCE:-"$repo_root/apps/companion-linux/deploy/codewide-companion.service"}
update_unit_source=${CODEWIDE_COMPANION_UPDATE_UNIT_SOURCE:-"$repo_root/apps/companion-linux/deploy/codewide-companion-update.service"}
memory_watch_source=${CODEWIDE_COMPANION_MEMORY_WATCH_SOURCE:-"$repo_root/apps/companion-linux/deploy/memory-watch.sh"}
memory_watch_service_source=${CODEWIDE_COMPANION_MEMORY_WATCH_SERVICE_SOURCE:-"$repo_root/apps/companion-linux/deploy/codewide-companion-memory-watch.service"}
memory_watch_timer_source=${CODEWIDE_COMPANION_MEMORY_WATCH_TIMER_SOURCE:-"$repo_root/apps/companion-linux/deploy/codewide-companion-memory-watch.timer"}
install_root=${CODEWIDE_COMPANION_INSTALL_ROOT:-"$HOME/.local/lib/codewide"}
unit_root=${CODEWIDE_COMPANION_UNIT_ROOT:-"${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"}
state_home=${XDG_STATE_HOME:-$HOME/.local/state}
state_root="$state_home/codewide/companion"
update_state_root="$state_home/codewide/host-update"
previous_state_root="$state_home/codewide-rust"
control_endpoint=${CODEWIDE_CONTROL_ENDPOINT:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide/companion-control.sock}
artifact_digest=${CODEWIDE_COMPANION_ARTIFACT_DIGEST:-}
source_revision=${CODEWIDE_COMPANION_SOURCE_REVISION:-0000000000000000000000000000000000000000}
build=${CODEWIDE_COMPANION_BUILD:-manual}
activate=${CODEWIDE_COMPANION_ACTIVATE:-1}

case "$activate" in 0|1) ;; *) printf '%s\n' 'CODEWIDE_COMPANION_ACTIVATE must be 0 or 1.' >&2; exit 2 ;; esac
test -x "$binary"
test -x "$git_plugin_binary"
test -x "$update_guardian_binary"
version=$($binary --version | awk 'NR == 1 { print $2 }')
case "$version" in ''|*[!0-9.]*) printf '%s\n' 'Companion binary reports an invalid version.' >&2; exit 2 ;; esac
if [ -z "$artifact_digest" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    artifact_digest=$(sha256sum "$binary" | awk '{print $1}')
  else
    artifact_digest=$(shasum -a 256 "$binary" | awk '{print $1}')
  fi
fi
case "$artifact_digest" in ????????????????????????????????????????????????????????????????) ;; *) printf '%s\n' 'Invalid Companion artifact digest.' >&2; exit 2 ;; esac
case "$artifact_digest" in *[!0-9a-f]*) printf '%s\n' 'Invalid Companion artifact digest.' >&2; exit 2 ;; esac
case "$source_revision" in ????????????????????????????????????????) ;; *) printf '%s\n' 'Invalid Companion source revision.' >&2; exit 2 ;; esac
case "$source_revision" in *[!0-9a-f]*) printf '%s\n' 'Invalid Companion source revision.' >&2; exit 2 ;; esac

umask 077
mkdir -p "$install_root/generations" "$install_root/bootstrap" "$update_state_root" "$unit_root"
chmod 0700 "$install_root/generations" "$install_root/bootstrap" "$update_state_root"
generation="$install_root/generations/$artifact_digest"
staging=
if [ ! -d "$generation" ]; then
  staging=$(mktemp -d "$install_root/generations/.manual-XXXXXX")
  trap 'test -z "$staging" || rm -rf -- "$staging"' EXIT HUP INT TERM
  mkdir -p "$staging/bin" "$staging/libexec"
  install -m 0755 "$binary" "$staging/bin/codewide-companion"
  install -m 0755 "$git_plugin_binary" "$staging/libexec/codewide-vcs-git"
  install -m 0755 "$memory_watch_source" "$staging/libexec/codewide-companion-memory-watch"
  printf '{"schemaVersion":1,"version":"%s","build":"%s","sourceRevision":"%s","artifactDigest":"%s"}\n' \
    "$version" "$build" "$source_revision" "$artifact_digest" >"$staging/metadata.json"
  chmod 0600 "$staging/metadata.json"
  mv "$staging" "$generation"
  staging=
fi

# This stable copy and its trust configuration are changed only by an explicit
# manual baseline installation, never by a remotely downloaded generation.
bootstrap_tmp="$install_root/bootstrap/.guardian-new"
install -m 0755 "$update_guardian_binary" "$bootstrap_tmp"
mv -f "$bootstrap_tmp" "$install_root/bootstrap/codewide-companion-update-guardian"
key_id=${CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID:-}
public_key=${CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI:-}
if [ -n "$key_id" ] || [ -n "$public_key" ]; then
  case "$key_id" in ''|*[!0-9A-Za-z_-]*) printf '%s\n' 'Invalid host-update signing key id.' >&2; exit 2 ;; esac
  case "$public_key" in ''|*[!0-9A-Za-z+/=]*) printf '%s\n' 'Invalid host-update public key.' >&2; exit 2 ;; esac
  config_tmp="$install_root/bootstrap/.config-new"
  printf '{"schemaVersion":1,"keyId":"%s","publicKeySpki":"%s","manifestUrl":"https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json"}\n' \
    "$key_id" "$public_key" >"$config_tmp"
  chmod 0600 "$config_tmp"
  mv -f "$config_tmp" "$install_root/bootstrap/config.json"
fi

install -m 0644 "$unit_source" "$unit_root/codewide-companion.service"
install -m 0644 "$update_unit_source" "$unit_root/codewide-companion-update.service"
install -m 0644 "$memory_watch_service_source" "$unit_root/codewide-companion-memory-watch.service"
install -m 0644 "$memory_watch_timer_source" "$unit_root/codewide-companion-memory-watch.timer"

previous_link=
if [ -L "$install_root/current" ]; then previous_link=$(readlink "$install_root/current"); fi
rm -f "$install_root/.current-new"
ln -s "generations/$artifact_digest" "$install_root/.current-new"
mv -f "$install_root/.current-new" "$install_root/current"

previous_unit=
if [ "$activate" -eq 1 ]; then
  systemctl --user daemon-reload
  for candidate in codewide-host-rust.service codewide-host.service codex-remote-host-rust.service codex-remote-host.service; do
    if systemctl --user is-active --quiet "$candidate"; then previous_unit=$candidate; break; fi
  done
fi
restore_previous() {
  [ "$activate" -eq 1 ] || return
  systemctl --user stop codewide-companion.service 2>/dev/null || true
  if [ -n "$previous_link" ]; then
    rm -f "$install_root/.current-restore"
    ln -s "$previous_link" "$install_root/.current-restore"
    mv -f "$install_root/.current-restore" "$install_root/current"
    systemctl --user start codewide-companion.service 2>/dev/null || true
  elif [ -n "$previous_unit" ]; then
    systemctl --user start "$previous_unit" 2>/dev/null || true
  fi
}

if [ "$activate" -eq 1 ]; then
  for legacy in codewide-host-rust-shadow.service codewide-host-rust.service codewide-host.service codex-remote-host-rust-shadow.service codex-remote-host-rust.service codex-remote-host.service; do
    systemctl --user stop "$legacy" 2>/dev/null || true
  done
fi
if [ ! -e "$HOME/.codewide/host.token" ] && [ ! -e "$HOME/.codex-remote" ]; then
  "$install_root/current/bin/codewide-companion" create-token >/dev/null
fi
if ! "$install_root/current/bin/codewide-companion" migrate-state; then restore_previous; exit 1; fi
test -s "$HOME/.codewide/host.token"

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
"$install_root/current/bin/codewide-companion" vcs plugin install \
  --id git --executable "$install_root/current/libexec/codewide-vcs-git" --priority=-1000 >/dev/null

[ "$activate" -eq 1 ] || exit 0
systemctl --user enable codewide-companion.service
systemctl --user enable codewide-companion-update.service
systemctl --user enable --now codewide-companion-memory-watch.timer
systemctl --user restart codewide-companion.service
attempt=0
while ! curl --silent --fail --unix-socket "$control_endpoint" http://localhost/healthz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    systemctl --user status codewide-companion.service --no-pager >&2 || true
    restore_previous
    exit 1
  fi
  sleep 0.2
done
for legacy in codewide-host-rust-shadow.service codewide-host-rust.service codewide-host.service codex-remote-host-rust-shadow.service codex-remote-host-rust.service codex-remote-host.service; do
  systemctl --user disable "$legacy" 2>/dev/null || true
done
