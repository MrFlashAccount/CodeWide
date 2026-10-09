#!/bin/sh
# Installs the CodeWide Claude sidecar on this host and registers it as the
# `claude` provider in the companion's agent-providers.json.
#
# What it does:
#   1. copies apps/claude-sidecar/dist and the pinned host manifest + lock
#      into the install directory;
#   2. runs `npm ci --omit=optional --ignore-scripts` there (the SDK's bundled
#      platform CLI binaries are never installed; the user's own `claude`
#      executable is used);
#   3. checks `claude --version`;
#   4. atomically writes <state-dir>/agent-providers.json, replacing only
#      `providers.claude` and keeping every other key.
#
# It builds nothing (run `pnpm --filter @codewide/claude-sidecar build`
# first), never restarts a service and never installs a systemd drop-in:
# the E-HARDEN experiment has not run yet. Restart the companion yourself to
# pick up the new configuration. Remove `providers.claude` from the file and
# restart to disable Claude again; bindings and the journal stay.
set -eu

usage() {
  cat <<'EOF'
Usage: install-claude-provider.sh --node <abs> --claude <abs> [options]

  --node <abs>                 Node.js >= 22 executable that runs the sidecar
  --claude <abs>               the user's signed-in `claude` executable
  --install-dir <abs>          default: ~/.local/lib/codewide/claude-sidecar
  --state-dir <abs>            companion state directory
                               default: ~/.local/state/codewide/companion
  --journal-dir <abs>          default: <state-dir>/claude-journal
  --idle-release-minutes <n>   5..240, default 30
  --dry-run                    print the plan and the config, change nothing
EOF
}

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sidecar_root="$repo_root/apps/claude-sidecar"
node=
claude=
install_dir="${HOME}/.local/lib/codewide/claude-sidecar"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/codewide/companion"
journal_dir=
idle_minutes=30
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
    --install-dir) need_value "$@"; install_dir=$2; shift 2 ;;
    --state-dir) need_value "$@"; state_dir=$2; shift 2 ;;
    --journal-dir) need_value "$@"; journal_dir=$2; shift 2 ;;
    --idle-release-minutes) need_value "$@"; idle_minutes=$2; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$journal_dir" ] || journal_dir="$state_dir/claude-journal"

require_absolute() {
  case "$2" in
    /*) ;;
    *) printf '%s must be an absolute path: %s\n' "$1" "$2" >&2; exit 2 ;;
  esac
}

[ -n "$node" ] || { printf '%s\n' '--node is required' >&2; usage >&2; exit 2; }
[ -n "$claude" ] || { printf '%s\n' '--claude is required' >&2; usage >&2; exit 2; }
require_absolute --node "$node"
require_absolute --claude "$claude"
require_absolute --install-dir "$install_dir"
require_absolute --state-dir "$state_dir"
require_absolute --journal-dir "$journal_dir"
case "$idle_minutes" in
  ''|*[!0-9]*) printf '%s\n' '--idle-release-minutes must be an integer' >&2; exit 2 ;;
esac
if [ "$idle_minutes" -lt 5 ] || [ "$idle_minutes" -gt 240 ]; then
  printf '%s\n' '--idle-release-minutes must be in 5..240' >&2
  exit 2
fi

[ -x "$node" ] || { printf 'not executable: %s\n' "$node" >&2; exit 1; }
[ -x "$claude" ] || { printf 'not executable: %s\n' "$claude" >&2; exit 1; }
[ -f "$sidecar_root/dist/main.js" ] || {
  printf '%s\n' 'apps/claude-sidecar/dist is missing; run: pnpm --filter @codewide/claude-sidecar build' >&2
  exit 1
}
node_major=$("$node" -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  printf 'Node.js >= 22 is required, found %s\n' "$("$node" --version)" >&2
  exit 1
fi
claude_version=$("$claude" --version)
printf 'claude: %s\n' "$claude_version"

config_path="$state_dir/agent-providers.json"
sidecar_entry="$install_dir/dist/main.js"

# Merges providers.claude into the existing config (or a new one) and prints it.
render_config() {
  "$node" - "$config_path" "$node" "$sidecar_entry" "$claude" "$journal_dir" "$idle_minutes" <<'EOF'
const fs = require("node:fs");
const [configPath, runtimeExecutable, sidecarEntry, claudeExecutable, journalDirectory, idle] = process.argv.slice(2);
let config = { version: 1, primary: "codex", providers: {} };
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error("agent-providers.json is not an object");
}
const providers = typeof config.providers === "object" && config.providers !== null && !Array.isArray(config.providers) ? config.providers : {};
providers.claude = { runtimeExecutable, sidecarEntry, claudeExecutable, journalDirectory, idleReleaseMinutes: Number(idle) };
config.providers = providers;
process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
EOF
}

if [ "$dry_run" -eq 1 ]; then
  printf 'dry run: would install %s and %s into %s\n' "$sidecar_root/dist" "$sidecar_root/host" "$install_dir"
  printf 'dry run: would run npm ci --omit=optional --ignore-scripts in %s\n' "$install_dir"
  printf 'dry run: would write %s:\n' "$config_path"
  render_config
  printf '%s\n' 'note: no systemd drop-in is installed (E-HARDEN has not run); restart the companion to apply.'
  exit 0
fi

npm_bin=$(dirname -- "$node")/npm
[ -x "$npm_bin" ] || npm_bin=npm

mkdir -p "$install_dir" "$state_dir"
chmod 0700 "$state_dir"
staging=$(mktemp -d "$install_dir/.staging.XXXXXX")
trap 'rm -rf "$staging"' EXIT
cp -R "$sidecar_root/dist" "$staging/dist"
cp "$sidecar_root/host/package.json" "$sidecar_root/host/package-lock.json" "$staging/"
(cd "$staging" && PATH="$(dirname -- "$node"):$PATH" "$npm_bin" ci --omit=optional --ignore-scripts --no-audit --no-fund)
rm -rf "$install_dir/dist" "$install_dir/node_modules"
mv "$staging/dist" "$install_dir/dist"
mv "$staging/node_modules" "$install_dir/node_modules"
mv "$staging/package.json" "$staging/package-lock.json" "$install_dir/"

mkdir -p "$journal_dir"
chmod 0700 "$journal_dir"
config_tmp=$(mktemp "$state_dir/.agent-providers.json.XXXXXX")
render_config > "$config_tmp"
chmod 0600 "$config_tmp"
mv "$config_tmp" "$config_path"

printf 'installed Claude sidecar into %s\n' "$install_dir"
printf 'wrote %s\n' "$config_path"
printf '%s\n' 'note: no systemd drop-in is installed (E-HARDEN has not run); restart the companion to apply.'
