#!/bin/sh
set -eu

[ "$#" -eq 3 ] || {
  echo "Usage: sh $0 <previous-app> <new-dmg> <new-version>" >&2
  exit 2
}
baseline_app=$1
target_dmg=$2
target_version=$3

if [ "$(uname -s)" != Darwin ]; then
  echo "macOS startup smoke requires macOS." >&2
  exit 1
fi
if [ "${CODEWIDE_ALLOW_ISOLATED_MACOS_SMOKE:-}" != 1 ]; then
  echo "Set CODEWIDE_ALLOW_ISOLATED_MACOS_SMOKE=1 in a disposable macOS account." >&2
  exit 1
fi
if [ "${CODEWIDE_EXPECT_MISSING_CODEX_SMOKE:-}" = 1 ]; then
  if command -v codex >/dev/null 2>&1; then
    echo "Missing-Codex smoke requires a disposable environment without Codex on PATH." >&2
    exit 1
  fi
  for executable in \
    "$HOME/.local/bin/codex" \
    "$HOME/.codex/packages/standalone/current/bin/codex" \
    "$HOME/Applications/Codex.app/Contents/Resources/codex" \
    /Applications/Codex.app/Contents/Resources/codex \
    /opt/homebrew/bin/codex /usr/local/bin/codex; do
    if [ -x "$executable" ]; then
      echo "Missing-Codex smoke requires an environment with no installed Codex. Nothing was changed." >&2
      exit 1
    fi
  done
fi

state_dir="$HOME/Library/Application Support/CodeWide/Companion"
job="gui/$(id -u)/dev.codewide.runtime"
if [ -e "$state_dir" ] || [ -L "$state_dir" ] || launchctl print "$job" >/dev/null 2>&1; then
  echo "Refusing to use an account with existing Companion state or a running LaunchAgent." >&2
  exit 1
fi
baseline_version=$(plutil -extract CFBundleShortVersionString raw "$baseline_app/Contents/Info.plist")
root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-update-smoke.XXXXXX")
mkdir -p "$HOME/Applications"
install_root=$(mktemp -d "$HOME/Applications/codewide-smoke.XXXXXX")
test_app="$install_root/CodeWide.app"
report="$state_dir/update-e2e-health.json"
marker="$state_dir/update-e2e.enabled"
mount="$root/mount"
mounted=false
app_pid=
runtime_pid=

cleanup() {
  if [ -n "$app_pid" ]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    launchctl bootout "$job" >/dev/null 2>&1 || true
  fi
  if [ "$mounted" = true ]; then
    if hdiutil detach "$mount"; then mounted=false; fi
  fi
  rm -f -- "$marker" "$report"
  rm -rf -- "$install_root"
  if [ "$mounted" = false ]; then rm -rf -- "$root"; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$mount" "$state_dir"
# Reuse the existing opt-in XPC health report; do not change app/updater behavior.
printf '%s\n' enabled > "$marker"
chmod 0600 "$marker"
mounted=true
hdiutil attach "$target_dmg" -readonly -nobrowse -mountpoint "$mount"
ditto "$mount/CodeWide.app" "$root/CodeWide.app"
hdiutil detach "$mount"
mounted=false
test "$(plutil -extract CFBundleShortVersionString raw "$root/CodeWide.app/Contents/Info.plist")" = "$target_version"
codesign --verify --deep --strict "$root/CodeWide.app"

start_and_wait() {
  expected_version=$1
  rm -f -- "$report"
  "$test_app/Contents/MacOS/CodeWide" >"$root/app-$expected_version.log" 2>&1 &
  app_pid=$!
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ! kill -0 "$app_pid" >/dev/null 2>&1; then break; fi
    if [ -f "$report" ] && jq -e \
      --arg version "$expected_version" --argjson appPid "$app_pid" '
      .phase == "running" and
      .appVersion == $version and .hostVersion == $version and .coreVersion == $version and
      .appProcessId == $appPid and
      (.processId | type == "number" and . > 0 and . == floor)
    ' "$report" >/dev/null; then
      runtime_pid=$(jq -er '.processId' "$report")
      if kill -0 "$runtime_pid" >/dev/null 2>&1; then
        echo "CodeWide $expected_version and its Companion started."
        return 0
      fi
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "CodeWide $expected_version did not start with a healthy Companion within 30 seconds." >&2
  cat "$root/app-$expected_version.log" >&2 || true
  launchctl print "$job" >&2 || true
  return 1
}

ditto "$baseline_app" "$test_app"
start_and_wait "$baseline_version"
kill "$app_pid"
launchctl bootout "$job"
attempt=0
while kill -0 "$app_pid" >/dev/null 2>&1 || kill -0 "$runtime_pid" >/dev/null 2>&1; do
  if [ "$attempt" -ge 10 ]; then
    echo "Previous application or Companion did not stop within 10 seconds." >&2
    exit 1
  fi
  sleep 1
  attempt=$((attempt + 1))
done
wait "$app_pid" >/dev/null 2>&1 || true
app_pid=
runtime_pid=

# Replace the entire disposable bundle at the same path, retaining ordinary state.
rm -rf -- "$test_app"
ditto "$root/CodeWide.app" "$test_app"
start_and_wait "$target_version"
if [ "${CODEWIDE_EXPECT_MISSING_CODEX_SMOKE:-}" = 1 ]; then
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    kill -0 "$app_pid" >/dev/null 2>&1 || break
    if jq -e '
      .codexNotFound == true and
      .setupTitle == "Install Codex to continue" and
      .setupAction == "Open Codex Guide" and .setupActionEnabled == true and
      (.setupExplanation | contains("Install and sign in"))
    ' "$report" >/dev/null 2>&1; then
      echo "Missing Codex: native app remains alive; Setup offers installation and an enabled Codex guide action."
      break
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ "$attempt" -ge 30 ] || ! kill -0 "$app_pid" >/dev/null 2>&1; then
    echo "Native app did not reach actionable missing-Codex state within 30 seconds." >&2
    exit 1
  fi
fi
jq -n --arg previousVersion "$baseline_version" --arg version "$target_version" \
  '{status:"ok", check:"startup-after-replacement", previousVersion:$previousVersion, version:$version}'
