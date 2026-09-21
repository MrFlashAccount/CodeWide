#!/bin/sh
set -eu

baseline_app=${1:?baseline app path is required}
target_dmg=${2:?target DMG path is required}
sparkle_bin=${3:?Sparkle bin directory is required}
target_version=${4:?target version is required}
private_key=${SPARKLE_PRIVATE_KEY:-}

if [ "$(uname -s)" != Darwin ]; then
  echo "Update E2E requires macOS." >&2
  exit 1
fi
if [ "${CODEWIDE_ALLOW_DESTRUCTIVE_UPDATE_E2E:-}" != 1 ]; then
  echo "Set CODEWIDE_ALLOW_DESTRUCTIVE_UPDATE_E2E=1 in an isolated CI account." >&2
  exit 1
fi
if [ -z "$private_key" ]; then
  echo "SPARKLE_PRIVATE_KEY is required." >&2
  exit 1
fi

root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-update-e2e.XXXXXX")
test_app="$HOME/Applications/CodeWide-E2E-$$.app"
feed_dir="$root/feed"
report="$root/runtime-health.json"
app_log="$root/app.log"
server_log="$root/http.log"
state_dir="$HOME/Library/Application Support/CodeWide/Companion"
server_pid=

cleanup() {
  launchctl bootout "gui/$(id -u)/dev.codewide.runtime" >/dev/null 2>&1 || true
  if [ -n "$server_pid" ]; then
    kill "$server_pid" >/dev/null 2>&1 || true
  fi
  { pgrep -f "^$test_app/Contents/MacOS/CodeWide$" || true; } | while IFS= read -r pid; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  rm -rf -- "$test_app"
  if [ "${CODEWIDE_KEEP_UPDATE_E2E:-}" != 1 ]; then
    rm -rf -- "$root"
  else
    echo "Kept update E2E files at $root" >&2
  fi
}
trap cleanup EXIT HUP INT TERM

if [ -L "$state_dir" ]; then
  echo "Refusing to remove symlinked runtime state: $state_dir" >&2
  exit 1
fi
rm -rf -- "$state_dir"
mkdir -p "$state_dir" "$HOME/Applications" "$feed_dir"
printf '%s\n' '{"schemaVersion":0,"launchCount":0,"lastCoreVersion":"0.0.0"}' \
  > "$state_dir/runtime-state.json"
printf '%s\n' '{"version":5,"devices":[],"pairings":[]}' > "$state_dir/devices.json"
chmod 0600 "$state_dir/devices.json"
printf '%s\n' 'preserve-across-update' > "$state_dir/update-state-sentinel"
ditto "$baseline_app" "$test_app"
cp "$target_dmg" "$feed_dir/"

port=18766
printf '%s' "$private_key" | "$sparkle_bin/generate_appcast" \
  --ed-key-file - \
  --download-url-prefix "http://127.0.0.1:$port/" \
  --link "https://github.com/MrFlashAccount/CodeWide" \
  --maximum-versions 1 \
  "$feed_dir"
test -f "$feed_dir/appcast.xml"

python3 -m http.server "$port" --bind 127.0.0.1 \
  --directory "$feed_dir" >"$server_log" 2>&1 &
server_pid=$!

CODEWIDE_UPDATE_E2E=1 \
CODEWIDE_UPDATE_FEED_URL="http://127.0.0.1:$port/appcast.xml" \
CODEWIDE_UPDATE_E2E_REPORT_PATH="$report" \
  "$test_app/Contents/MacOS/CodeWide" >"$app_log" 2>&1 &

updated=false
attempt=0
while [ "$attempt" -lt 180 ]; do
  if [ -f "$report" ] && jq -e --arg version "$target_version" '
    .appVersion == $version and
    .hostVersion == $version and
    .coreVersion == $version and
    .stateSchema == 1 and
    .updateStatus == "applied" and
    .updateFromVersion == "0.0.0" and
    .updateTargetVersion == $version
  ' "$report" >/dev/null; then
    updated=true
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done
if [ "$updated" != true ]; then
  echo "Sparkle update did not produce a healthy new runtime." >&2
  cat "$app_log" >&2 || true
  cat "$server_log" >&2 || true
  test -f "$report" && cat "$report" >&2
  exit 1
fi

test -f "$state_dir/runtime-state.v0.backup.json"
test "$(cat "$state_dir/update-state-sentinel")" = preserve-across-update
test "$(jq -r '.version' "$state_dir/devices.json")" = 5
old_pid=$(jq -r '.processId' "$report")
old_launch_count=$(jq -r '.launchCount' "$report")
kill -9 "$old_pid"

recovered=false
attempt=0
while [ "$attempt" -lt 60 ]; do
  if [ -f "$report" ]; then
    new_pid=$(jq -r '.processId' "$report")
    new_launch_count=$(jq -r '.launchCount' "$report")
    if [ "$new_pid" != "$old_pid" ] && [ "$new_launch_count" -gt "$old_launch_count" ]; then
      recovered=true
      break
    fi
  fi
  sleep 1
  attempt=$((attempt + 1))
done
if [ "$recovered" != true ]; then
  echo "launchd did not recover the runtime after SIGKILL." >&2
  cat "$report" >&2 || true
  exit 1
fi
test "$(cat "$state_dir/update-state-sentinel")" = preserve-across-update
test "$(jq -r '.version' "$state_dir/devices.json")" = 5

jq -n \
  --arg version "$target_version" \
  --argjson previousPid "$old_pid" \
  --argjson recoveredPid "$new_pid" \
  --argjson launchCount "$new_launch_count" \
  '{status:"ok", version:$version, previousPid:$previousPid, recoveredPid:$recoveredPid, launchCount:$launchCount}'
