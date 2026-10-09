#!/bin/sh
# Installs the CodeWide Claude agent host on this host and registers it as
# the `claude` provider in the companion's agent-providers.json. Linux (user
# systemd service) and macOS (CodeWide.app LaunchAgent) are supported.
#
# What it does:
#   1. finds the host payload: a release payload next to this script
#      (`claude-agent-host/` or `../share/claude-agent-host/`, holding dist/,
#      package.json, package-lock.json and VERSION) or, in a source checkout,
#      crates/agent-provider-claude/host/dist plus host/install/;
#   2. copies dist/ and the pinned manifest + lock into the install directory
#      and runs `npm ci --omit=optional --ignore-scripts` there (the Claude
#      Agent SDK always comes from npm; its bundled platform CLI binaries are
#      never installed; the user's own `claude` executable is used);
#   3. captures the service environment for the host child: PATH (default: the
#      absolute directories of the current PATH) and CLAUDE_CONFIG_DIR (when
#      set). A service manager starts the companion with a minimal PATH, so an
#      npm-global `claude` (`#!/usr/bin/env node`) and Claude's Bash tool would
#      otherwise not find node or the user's tools;
#   4. checks `node` and `claude --version` under exactly that environment
#      (`env -i`), not under this shell's;
#   5. atomically writes <state-dir>/agent-providers.json, replacing only
#      `providers.claude` and keeping every other key;
#   6. Linux only: installs the systemd drop-in
#      codewide-companion.service.d/claude-provider.conf (relaxations Claude
#      needs under the companion unit's hardening; see the file).
#
# It builds nothing in a checkout (run `pnpm --filter @codewide/claude-agent-host
# build` first) and never restarts the companion; it prints the restart
# command. Remove `providers.claude` from the file and restart to disable
# Claude again; bindings and the host's thread metadata stay.
#
# Migration from the former "Claude sidecar" install: the config keys
# (`sidecarEntry`, `journalDirectory`) are unchanged because the companion
# reads them. The default Linux install directory moved from
# ~/.local/lib/codewide/claude-sidecar to ~/.local/lib/codewide/claude-agent-host;
# re-running this script points `sidecarEntry` at the new directory, and the
# old one can be deleted after the companion restarted. The metadata
# directory default (<state-dir>/claude-journal) is unchanged; the host
# converts the version-1 journal there on its first start.
set -eu

usage() {
  cat <<'EOF'
Usage: install-claude-provider.sh [options]

  --node <abs>                 Node.js >= 22 that runs the host (default: node on PATH)
  --claude <abs>               the user's signed-in `claude` (default: claude on PATH)
  --service-path <PATH>        PATH for the host child, absolute directories only
                               (default: the absolute directories of the current PATH)
  --claude-config-dir <abs>    CLAUDE_CONFIG_DIR for the host child
                               (default: $CLAUDE_CONFIG_DIR when set)
  --install-dir <abs>          Linux default: ~/.local/lib/codewide/claude-agent-host
                               macOS default: ~/Library/Application Support/CodeWide/ClaudeAgentHost
  --state-dir <abs>            companion state directory
                               Linux default: ~/.local/state/codewide/companion
                               macOS default: ~/Library/Application Support/CodeWide/Companion
  --journal-dir <abs>          host metadata directory (config key journalDirectory)
                               default: <state-dir>/claude-journal
  --idle-release-minutes <n>   5..240, default 30
  --host-payload <dir>         host payload directory (default: found next to this script)
  --unit-dir <abs>             Linux: systemd user unit directory
                               default: ~/.config/systemd/user
  --no-systemd-drop-in         Linux: do not install the claude-provider.conf drop-in
  --dry-run                    print the plan and the config, change nothing
EOF
}

fail() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
os=$(uname -s)
case "$os" in
  Linux)
    install_dir="$HOME/.local/lib/codewide/claude-agent-host"
    state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/codewide/companion"
    ;;
  Darwin)
    install_dir="$HOME/Library/Application Support/CodeWide/ClaudeAgentHost"
    state_dir="$HOME/Library/Application Support/CodeWide/Companion"
    ;;
  *) fail "unsupported operating system: $os" 2 ;;
esac
node=
claude=
service_path=
service_path_given=0
claude_config_dir=${CLAUDE_CONFIG_DIR:-}
journal_dir=
idle_minutes=30
host_payload=
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
drop_in=1
dry_run=0

need_value() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    printf '%s needs a value\n' "$1" >&2
    usage >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --node) need_value "$@"; node=$2; shift 2 ;;
    --claude) need_value "$@"; claude=$2; shift 2 ;;
    --service-path) need_value "$@"; service_path=$2; service_path_given=1; shift 2 ;;
    --claude-config-dir) need_value "$@"; claude_config_dir=$2; shift 2 ;;
    --install-dir) need_value "$@"; install_dir=$2; shift 2 ;;
    --state-dir) need_value "$@"; state_dir=$2; shift 2 ;;
    --journal-dir) need_value "$@"; journal_dir=$2; shift 2 ;;
    --idle-release-minutes) need_value "$@"; idle_minutes=$2; shift 2 ;;
    --host-payload) need_value "$@"; host_payload=$2; shift 2 ;;
    --unit-dir) need_value "$@"; unit_dir=$2; shift 2 ;;
    --no-systemd-drop-in) drop_in=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[ "$os" = Linux ] || drop_in=0
[ -n "$journal_dir" ] || journal_dir="$state_dir/claude-journal"
[ -n "$node" ] || node=$(command -v node 2>/dev/null) || fail '--node is required (no node on PATH)' 2
[ -n "$claude" ] || claude=$(command -v claude 2>/dev/null) || fail '--claude is required (no claude on PATH)' 2

require_absolute() {
  case "$2" in
    /*) ;;
    *) fail "$1 must be an absolute path: $2" 2 ;;
  esac
}

require_absolute --node "$node"
require_absolute --claude "$claude"
require_absolute --install-dir "$install_dir"
require_absolute --state-dir "$state_dir"
require_absolute --journal-dir "$journal_dir"
[ -z "$claude_config_dir" ] || require_absolute --claude-config-dir "$claude_config_dir"
[ "$drop_in" -eq 0 ] || require_absolute --unit-dir "$unit_dir"
case "$idle_minutes" in
  ''|*[!0-9]*) fail '--idle-release-minutes must be an integer' 2 ;;
esac
if [ "$idle_minutes" -lt 5 ] || [ "$idle_minutes" -gt 240 ]; then
  fail '--idle-release-minutes must be in 5..240' 2
fi
node_dir=$(dirname -- "$node")
claude_dir=$(dirname -- "$claude")
# The companion builds the host's PATH by joining directories with ':'.
case "$node_dir$claude_dir" in
  *:*) fail 'the directories of --node and --claude must not contain ":"' 2 ;;
esac

# Keeps the absolute, existing, distinct directories of a PATH value.
absolute_directories() {
  result=
  old_ifs=$IFS
  IFS=:
  set -f
  for entry in $1; do
    case "$entry" in /*) ;; *) continue ;; esac
    [ -d "$entry" ] || continue
    case ":$result:" in *":$entry:"*) continue ;; esac
    result=${result:+$result:}$entry
  done
  set +f
  IFS=$old_ifs
  printf '%s' "$result"
}

if [ "$service_path_given" -eq 1 ]; then
  # Same rule as the companion: every entry absolute, no empty entry.
  case ":$service_path:" in
    *::*) fail '--service-path must not contain empty entries' 2 ;;
  esac
  old_ifs=$IFS
  IFS=:
  set -f
  for entry in $service_path; do
    case "$entry" in /*) ;; *) IFS=$old_ifs; fail "--service-path entries must be absolute: $entry" 2 ;; esac
  done
  set +f
  IFS=$old_ifs
else
  service_path=$(absolute_directories "${PATH:-}")
  [ -n "$service_path" ] || service_path=/usr/bin:/bin
fi
# Drops repeated entries of a PATH value, keeping the first position.
distinct_entries() {
  result=
  old_ifs=$IFS
  IFS=:
  set -f
  for entry in $1; do
    case ":$result:" in *":$entry:"*) continue ;; esac
    result=${result:+$result:}$entry
  done
  set +f
  IFS=$old_ifs
  printf '%s' "$result"
}
# What the companion gives the host child (ClaudeConfig::host_search_path).
effective_path=$(distinct_entries "$node_dir:$claude_dir:$service_path")

[ -x "$node" ] || fail "not executable: $node"
[ -x "$claude" ] || fail "not executable: $claude"

# Host payload: release layout next to this script, else a source checkout.
checkout_root=
if [ -z "$host_payload" ]; then
  for candidate in "$script_dir/claude-agent-host" "$script_dir/../share/claude-agent-host"; do
    if [ -f "$candidate/dist/main.js" ] && [ -f "$candidate/package.json" ]; then
      host_payload=$(CDPATH= cd -- "$candidate" && pwd)
      break
    fi
  done
fi
if [ -n "$host_payload" ]; then
  host_dist="$host_payload/dist"
  host_manifest_dir="$host_payload"
  drop_in_source="$host_payload/claude-provider.conf"
  [ -f "$host_dist/main.js" ] || fail "host payload has no dist/main.js: $host_payload"
  payload_version=
  [ ! -f "$host_payload/VERSION" ] || payload_version=$(cat "$host_payload/VERSION")
else
  checkout_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
  host_root="$checkout_root/crates/agent-provider-claude/host"
  [ -d "$host_root" ] || fail 'no Claude agent host payload found next to this script; pass --host-payload'
  host_dist="$host_root/dist"
  host_manifest_dir="$host_root/install"
  drop_in_source="$checkout_root/apps/companion-linux/deploy/claude-provider.conf"
  payload_version=
  [ -f "$host_dist/main.js" ] || fail 'crates/agent-provider-claude/host/dist is missing; run: pnpm --filter @codewide/claude-agent-host build'
fi
for manifest_file in package.json package-lock.json; do
  [ -f "$host_manifest_dir/$manifest_file" ] || fail "host $manifest_file is missing in $host_manifest_dir"
done
[ "$drop_in" -eq 0 ] || [ -f "$drop_in_source" ] || fail "systemd drop-in is missing: $drop_in_source"

# A release payload ships with one companion build; refuse a mismatched pair.
companion_bin=
for candidate in "$script_dir/../bin/codewide-companion" "$script_dir/../codewide-companion"; do
  if [ -x "$candidate" ]; then
    companion_bin=$candidate
    break
  fi
done
if [ -n "$payload_version" ] && [ -n "$companion_bin" ]; then
  companion_version=$("$companion_bin" --version | awk '{print $2}')
  [ "$companion_version" = "$payload_version" ] \
    || fail "host payload $payload_version does not match codewide-companion $companion_version"
fi

# Runs a command under the host child's environment, not this shell's.
in_service_env() {
  if [ -n "$claude_config_dir" ]; then
    env -i HOME="$HOME" PATH="$effective_path" CLAUDE_CONFIG_DIR="$claude_config_dir" "$@"
  else
    env -i HOME="$HOME" PATH="$effective_path" "$@"
  fi
}

node_major=$(in_service_env "$node" -p 'process.versions.node.split(".")[0]') \
  || fail "node does not start under the service PATH: $node"
if [ "$node_major" -lt 22 ]; then
  fail "Node.js >= 22 is required, found $("$node" --version)"
fi
env_node=$(in_service_env /bin/sh -c 'command -v node' || true)
claude_version=$(in_service_env "$claude" --version) || {
  printf 'claude --version failed under the service environment (PATH=%s)\n' "$effective_path" >&2
  fail 'pass --service-path with the directories claude needs (for an npm-global claude: the directory of its node)'
}
printf 'node: %s (Node.js %s; "env node" under the service PATH: %s)\n' "$node" "$node_major" "${env_node:-not found}"
printf 'claude: %s (%s)\n' "$claude" "$claude_version"
printf 'host PATH: %s\n' "$effective_path"
[ -z "$claude_config_dir" ] || printf 'CLAUDE_CONFIG_DIR: %s\n' "$claude_config_dir"
if [ "$os" = Linux ]; then
  case "$(readlink -f -- "$claude" 2>/dev/null || printf '%s' "$claude")" in
    /usr/*|/etc/*|/opt/*)
      printf '%s\n' 'note: claude lives on a path the companion unit mounts read-only (ProtectSystem=full); it cannot update itself while CodeWide runs it. Update it from a shell.' ;;
  esac
fi

config_path="$state_dir/agent-providers.json"
host_entry="$install_dir/dist/main.js"

# Merges providers.claude into the existing config (or a new one) and prints it.
render_config() {
  "$node" - "$config_path" "$node" "$host_entry" "$claude" "$journal_dir" "$idle_minutes" "$service_path" "$claude_config_dir" <<'EOF'
const fs = require("node:fs");
const [configPath, runtimeExecutable, sidecarEntry, claudeExecutable, journalDirectory, idle, path, claudeConfigDir] = process.argv.slice(2);
let config = { version: 1, primary: "codex", providers: {} };
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error("agent-providers.json is not an object");
}
const providers = typeof config.providers === "object" && config.providers !== null && !Array.isArray(config.providers) ? config.providers : {};
const environment = { PATH: path };
if (claudeConfigDir !== "") environment.CLAUDE_CONFIG_DIR = claudeConfigDir;
providers.claude = { runtimeExecutable, sidecarEntry, claudeExecutable, journalDirectory, idleReleaseMinutes: Number(idle), environment };
config.providers = providers;
process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
EOF
}

if [ "$os" = Darwin ]; then
  restart_hint="launchctl kickstart -k gui/$(id -u)/dev.codewide.runtime"
elif [ "$drop_in" -eq 1 ]; then
  restart_hint='systemctl --user daemon-reload && systemctl --user restart codewide-companion.service'
else
  restart_hint='systemctl --user restart codewide-companion.service'
fi
drop_in_target="$unit_dir/codewide-companion.service.d/claude-provider.conf"

if [ "$dry_run" -eq 1 ]; then
  printf 'dry run: would install %s and the manifest in %s into %s\n' "$host_dist" "$host_manifest_dir" "$install_dir"
  printf 'dry run: would run npm ci --omit=optional --ignore-scripts in %s\n' "$install_dir"
  if [ "$drop_in" -eq 1 ]; then
    printf 'dry run: would install %s as %s\n' "$drop_in_source" "$drop_in_target"
  fi
  printf 'dry run: would write %s:\n' "$config_path"
  render_config
  printf 'then restart the companion: %s\n' "$restart_hint"
  exit 0
fi

npm_bin="$node_dir/npm"
[ -x "$npm_bin" ] || npm_bin=$(command -v npm) || fail 'npm is required next to node or on PATH'

mkdir -p "$install_dir"
if [ ! -d "$state_dir" ]; then
  mkdir -p "$state_dir"
  chmod 0700 "$state_dir"
fi
staging=$(mktemp -d "$install_dir/.staging.XXXXXX")
config_tmp=
cleanup() {
  rm -rf -- "$staging"
  [ -z "$config_tmp" ] || rm -f -- "$config_tmp"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
cp -R "$host_dist" "$staging/dist"
cp "$host_manifest_dir/package.json" "$host_manifest_dir/package-lock.json" "$staging/"
(cd "$staging" && PATH="$node_dir:$PATH" "$npm_bin" ci --omit=optional --ignore-scripts --no-audit --no-fund)
rm -rf -- "$install_dir/dist" "$install_dir/node_modules"
mv "$staging/dist" "$install_dir/dist"
mv "$staging/node_modules" "$install_dir/node_modules"
mv "$staging/package.json" "$staging/package-lock.json" "$install_dir/"
if [ -n "$payload_version" ]; then
  printf '%s\n' "$payload_version" >"$install_dir/VERSION"
fi

mkdir -p "$journal_dir"
chmod 0700 "$journal_dir"
config_tmp=$(mktemp "$state_dir/.agent-providers.json.XXXXXX")
render_config >"$config_tmp"
chmod 0600 "$config_tmp"

# The companion's own check of the new entry, when its CLI is at hand.
if [ -n "$companion_bin" ]; then
  check_dir=$(mktemp -d "$staging/check.XXXXXX")
  cp "$config_tmp" "$check_dir/agent-providers.json"
  if ! "$companion_bin" providers status --state-dir "$check_dir" >"$check_dir/status.json"; then
    cat "$check_dir/status.json" >&2
    fail 'codewide-companion rejected the new Claude provider entry; the configuration was not changed'
  fi
fi
mv "$config_tmp" "$config_path"
config_tmp=

if [ "$drop_in" -eq 1 ]; then
  mkdir -p "$unit_dir/codewide-companion.service.d"
  drop_in_tmp=$(mktemp "$unit_dir/codewide-companion.service.d/.claude-provider.conf.XXXXXX")
  cp "$drop_in_source" "$drop_in_tmp"
  chmod 0644 "$drop_in_tmp"
  mv "$drop_in_tmp" "$drop_in_target"
  printf 'installed %s\n' "$drop_in_target"
fi

printf 'installed the Claude agent host into %s\n' "$install_dir"
printf 'wrote %s\n' "$config_path"
printf 'restart the companion to apply: %s\n' "$restart_hint"
