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
app_log="$root/app.log"
server_log="$root/http.log"
state_dir="$HOME/Library/Application Support/CodeWide/Companion"
report="$state_dir/update-e2e-health.json"
report_marker="$state_dir/update-e2e.enabled"
server_pid=

dump_diagnostics() {
  echo "--- CodeWide app log ---" >&2
  cat "$app_log" >&2 || true
  echo "--- Sparkle feed log ---" >&2
  cat "$server_log" >&2 || true
  echo "--- Runtime health report ---" >&2
  if [ -f "$report" ]; then
    cat "$report" >&2
  else
    echo "missing: $report" >&2
  fi
  echo "--- Runtime state ---" >&2
  for state_file in \
    "$state_dir/runtime-state.json" \
    "$state_dir/runtime-state.v0.backup.json" \
    "$state_dir/devices.json"; do
    if [ -f "$state_file" ]; then
      stat -f '%Sp %Su:%Sg %N' "$state_file" >&2 || true
      cat "$state_file" >&2 || true
    else
      echo "missing: $state_file" >&2
    fi
  done
  echo "--- launchd job ---" >&2
  launchctl print "gui/$(id -u)/dev.codewide.runtime" >&2 || true
  echo "--- Relevant unified log ---" >&2
  log show --style compact --last 10m \
    --predicate 'process == "CodeWideRuntime" OR eventMessage CONTAINS[c] "dev.codewide.runtime"' \
    >&2 || true
  echo "--- Direct runtime probe ---" >&2
  launchctl bootout "gui/$(id -u)/dev.codewide.runtime" >/dev/null 2>&1 || true
  runtime_probe_log="$root/runtime-probe.log"
  "$test_app/Contents/MacOS/CodeWideRuntime" >"$runtime_probe_log" 2>&1 &
  runtime_probe_pid=$!
  sleep 2
  if kill -0 "$runtime_probe_pid" >/dev/null 2>&1; then
    echo "Runtime remained alive for the two-second direct probe." >&2
    kill "$runtime_probe_pid" >/dev/null 2>&1 || true
    wait "$runtime_probe_pid" >/dev/null 2>&1 || true
  else
    if wait "$runtime_probe_pid"; then
      runtime_probe_status=0
    else
      runtime_probe_status=$?
    fi
    echo "Runtime direct probe exited with status $runtime_probe_status." >&2
  fi
  cat "$runtime_probe_log" >&2 || true
}

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
printf '%s\n' 'enabled' > "$report_marker"
chmod 0600 "$report_marker"
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
  "$test_app/Contents/MacOS/CodeWide" >"$app_log" 2>&1 &

baseline_ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if [ -f "$report" ] && jq -e '
    .appVersion == "0.0.0" and
    .hostVersion == "0.0.0" and
    .coreVersion == "0.0.0" and
    .stateSchema == 1 and
    .updateStatus == "none"
  ' "$report" >/dev/null; then
    baseline_ready=true
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done
if [ "$baseline_ready" != true ]; then
  echo "Baseline app did not produce a healthy runtime before the update check." >&2
  dump_diagnostics
  exit 1
fi
baseline_app_pid=$(jq -er '.appProcessId' "$report")
baseline_runtime_pid=$(jq -er '.processId' "$report")

updated=false
attempt=0
while [ "$attempt" -lt 180 ]; do
  if [ -f "$report" ] && jq -e \
    --arg version "$target_version" \
    --argjson baselineAppPid "$baseline_app_pid" \
    --argjson baselineRuntimePid "$baseline_runtime_pid" '
    .phase == "running" and
    .appVersion == $version and
    .hostVersion == $version and
    .coreVersion == $version and
    .appProcessId != $baselineAppPid and
    .processId != $baselineRuntimePid and
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
  dump_diagnostics
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
