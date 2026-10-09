#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
baseline_app=${1:?baseline app path is required}
target_dmg=${2:?target DMG path is required}
sparkle_bin=${3:?Sparkle bin directory is required}
target_version=${4:?target version is required}
private_key=${SPARKLE_PRIVATE_KEY:-}
host_update_private_key=${CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY:-}
host_update_public_key=${CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI:-}
host_update_key_id=${CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID:-}
e2e_namespace=${CODEWIDE_E2E_NAMESPACE:-0}

case "$e2e_namespace" in
  0)
    app_identifier=dev.codewide.app
    runtime_label=dev.codewide.runtime
    runtime_mach_service=dev.codewide.runtime.control
    runtime_plist_name=dev.codewide.runtime.plist
    guardian_label=dev.codewide.update-guardian
    guardian_plist_name=dev.codewide.update-guardian.plist
    application_support_tree=CodeWide
    ;;
  1)
    app_identifier=dev.codewide.app.e2e
    runtime_label=dev.codewide.runtime.e2e
    runtime_mach_service=dev.codewide.runtime.control.e2e
    runtime_plist_name=dev.codewide.runtime.e2e.plist
    guardian_label=dev.codewide.update-guardian.e2e
    guardian_plist_name=dev.codewide.update-guardian.e2e.plist
    application_support_tree=CodeWideE2E
    ;;
  *)
    echo "CODEWIDE_E2E_NAMESPACE must be 0 or 1." >&2
    exit 1
    ;;
esac

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
if [ "$e2e_namespace" = 1 ] && \
   { [ -z "$host_update_private_key" ] || [ -z "$host_update_public_key" ] || \
     [ -z "$host_update_key_id" ]; }; then
  echo "Host-update E2E signing private key, public SPKI, and key id are required." >&2
  exit 1
fi

root=$(mktemp -d "${TMPDIR:-/tmp}/codewide-update-e2e.XXXXXX")
test_app="$HOME/Applications/CodeWide-E2E-$$.app"
feed_dir="$root/feed"
host_dir="$root/host"
app_log="$root/app.log"
server_log="$root/http.log"
target_mount="$root/target-mount"
baseline_image_dir="$root/baseline-image"
baseline_dmg="$root/CodeWide-baseline.dmg"
state_dir="$HOME/Library/Application Support/$application_support_tree/Companion"
updater_dir="$HOME/Library/Application Support/$application_support_tree/Updater"
guardian_plist="$HOME/Library/LaunchAgents/$guardian_plist_name"
report="$state_dir/update-e2e-health.json"
report_marker="$state_dir/update-e2e.enabled"
guardian_inbox="$updater_dir/v1/ipc/inbox"
guardian_outbox="$updater_dir/v1/ipc/outbox"
guardian_commands="$updater_dir/v1/commands"
runtime_observation="$updater_dir/v1/runtime-observation.json"
port=18766
server_origin="http://127.0.0.1:$port"
server_pid=
production_guard_pid=
production_guard_failure="$root/production-runtime-changed"
e2e_cleanup_armed=false
target_mounted=false
e2e_smappservice_unregistered=false
production_runtime_pid=absent
production_identity_digest=absent
production_state_dir="$HOME/Library/Application Support/CodeWide/Companion"
production_identity="$production_state_dir/identity/secure-store.json"

if [ "$e2e_namespace" = 1 ]; then
  observed_production_pid=$(launchctl print "gui/$(id -u)/dev.codewide.runtime" \
    2>/dev/null | awk '/pid =/{print $3; exit}') || true
  if [ -n "$observed_production_pid" ]; then
    production_runtime_pid=$observed_production_pid
  fi
  if [ -f "$production_identity" ]; then
    production_identity_digest=$(shasum -a 256 "$production_identity" | awk '{print $1}')
  fi
fi

verify_namespaced_app() {
  candidate=$1
  candidate_plist="$candidate/Contents/Library/LaunchAgents/$runtime_plist_name"
  candidate_guardian="$candidate/Contents/Resources/UpdaterBootstrap/CodeWideUpdateGuardian"
  candidate_unregister="$candidate/Contents/Helpers/CodeWideE2EUnregister"
  candidate_identifier=$(plutil -extract CFBundleIdentifier raw -o - \
    "$candidate/Contents/Info.plist") || return 1
  [ "$candidate_identifier" = "$app_identifier" ] || return 1
  [ -f "$candidate_plist" ] || return 1
  [ ! -e "$candidate/Contents/Library/LaunchAgents/dev.codewide.runtime.plist" ] || return 1
  candidate_runtime_label=$(plutil -extract Label raw -o - "$candidate_plist") || return 1
  candidate_mach_service=$(/usr/libexec/PlistBuddy \
    -c "Print :MachServices:$runtime_mach_service" "$candidate_plist") || return 1
  [ "$candidate_runtime_label" = "$runtime_label" ] || return 1
  [ "$candidate_mach_service" = true ] || return 1
  codesign -d --verbose=4 "$candidate" 2>&1 \
    | grep -Fx "Identifier=$app_identifier" >/dev/null || return 1
  codesign -d --verbose=4 "$candidate/Contents/MacOS/CodeWideRuntime" 2>&1 \
    | grep -Fx "Identifier=$runtime_label" >/dev/null || return 1
  codesign -d --verbose=4 "$candidate_guardian" 2>&1 \
    | grep -Fx "Identifier=$guardian_label" >/dev/null || return 1
  [ -x "$candidate_unregister" ] || return 1
  codesign -d --verbose=4 "$candidate_unregister" 2>&1 \
    | grep -Fx 'Identifier=dev.codewide.e2e-unregister' >/dev/null || return 1
}

stop_test_app() {
  { pgrep -f "^$test_app/Contents/MacOS/CodeWide$" || true; } | while IFS= read -r pid; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  stop_attempt=0
  while [ "$stop_attempt" -lt 30 ] && \
        pgrep -f "^$test_app/Contents/MacOS/CodeWide$" >/dev/null 2>&1; do
    sleep 0.1
    stop_attempt=$((stop_attempt + 1))
  done
}

unregister_e2e_smappservice() {
  unregister_helper="$test_app/Contents/Helpers/CodeWideE2EUnregister"
  [ -x "$unregister_helper" ] || return 1
  "$unregister_helper"
}

publish_guardian_request() {
  request_id=$1
  source=$2
  temporary="$guardian_inbox/.$request_id.tmp"
  destination="$guardian_inbox/$request_id.json"
  cp "$source" "$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$destination"
}

wait_for_guardian_response() {
  request_id=$1
  maximum_attempts=$2
  response="$guardian_outbox/$request_id.json"
  response_attempt=0
  while [ "$response_attempt" -lt "$maximum_attempts" ]; do
    if [ -f "$response" ]; then
      printf '%s\n' "$response"
      return 0
    fi
    sleep 0.2
    response_attempt=$((response_attempt + 1))
  done
  return 1
}

verify_production_unchanged() {
  current_pid=$(launchctl print "gui/$(id -u)/dev.codewide.runtime" \
    2>/dev/null | awk '/pid =/{print $3; exit}') || true
  if [ -z "$current_pid" ]; then
    current_pid=absent
  fi
  current_identity_digest=absent
  if [ -f "$production_identity" ]; then
    current_identity_digest=$(shasum -a 256 "$production_identity" | awk '{print $1}')
  fi
  [ "$current_pid" = "$production_runtime_pid" ] && \
    [ "$current_identity_digest" = "$production_identity_digest" ]
}

production_guard_is_healthy() {
  [ ! -e "$production_guard_failure" ] && verify_production_unchanged
}

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
    "$state_dir/devices.json" \
    "$state_dir/identity/secure-store.json" \
    "$report_marker"; do
    if [ -f "$state_file" ]; then
      stat -f '%Sp %Su:%Sg %N' "$state_file" >&2 || true
      cat "$state_file" >&2 || true
    else
      echo "missing: $state_file" >&2
    fi
  done
  echo "--- Guardian transaction ---" >&2
  for guardian_file in \
    "$updater_dir/v1/state.json" \
    "$updater_dir/v1/journal.json" \
    "$updater_dir/v1/operation-context.json" \
    "$runtime_observation" \
    "$updater_dir/v1/logs/guardian.log" \
    "$updater_dir/v1/logs/guardian-error.log"; do
    if [ -f "$guardian_file" ]; then
      echo "--- $guardian_file ---" >&2
      cat "$guardian_file" >&2 || true
    fi
  done
  find "$guardian_inbox" "$guardian_outbox" "$guardian_commands" \
    -maxdepth 1 -type f -print -exec cat {} \; >&2 2>/dev/null || true
  echo "--- launchd job ---" >&2
  launchctl print "gui/$(id -u)/$runtime_label" >&2 || true
  if [ "$e2e_namespace" = 1 ]; then
    launchctl print "gui/$(id -u)/$guardian_label" >&2 || true
  fi
  echo "--- Relevant unified log ---" >&2
  log show --style compact --last 10m \
    --predicate "process == \"CodeWide\" OR process == \"CodeWideRuntime\" OR eventMessage CONTAINS[c] \"$runtime_label\"" \
    >&2 || true
  echo "--- Direct runtime probe ---" >&2
  launchctl bootout "gui/$(id -u)/$runtime_label" >/dev/null 2>&1 || true
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
  if [ -n "$production_guard_pid" ]; then
    kill "$production_guard_pid" >/dev/null 2>&1 || true
    wait "$production_guard_pid" >/dev/null 2>&1 || true
  fi
  if [ "$target_mounted" = true ]; then
    hdiutil detach "$target_mount" -force >/dev/null 2>&1 || true
  fi
  if [ "$e2e_namespace" = 1 ]; then
    launchctl bootout "gui/$(id -u)/$guardian_label" >/dev/null 2>&1 || true
    stop_test_app
    if [ "$e2e_smappservice_unregistered" != true ] && \
       [ -x "$test_app/Contents/Helpers/CodeWideE2EUnregister" ]; then
      unregister_e2e_smappservice || \
        echo "Failed to unregister the E2E runtime SMAppService." >&2
    fi
    launchctl bootout "gui/$(id -u)/$runtime_label" >/dev/null 2>&1 || true
  else
    launchctl bootout "gui/$(id -u)/$runtime_label" >/dev/null 2>&1 || true
  fi
  if [ -n "$server_pid" ]; then
    kill "$server_pid" >/dev/null 2>&1 || true
  fi
  stop_test_app
  rm -rf -- "$test_app"
  if [ "$e2e_namespace" = 1 ] && [ "$e2e_cleanup_armed" = true ]; then
    rm -rf -- "$updater_dir"
    rm -f -- "$guardian_plist"
  fi
  if [ "${CODEWIDE_KEEP_UPDATE_E2E:-}" != 1 ]; then
    if [ "$e2e_namespace" = 1 ] && [ "$e2e_cleanup_armed" = true ]; then
      rm -rf -- "$state_dir"
    fi
    rm -rf -- "$root"
  else
    echo "Kept update E2E files at $root" >&2
  fi
}
trap cleanup EXIT HUP INT TERM

if [ "$e2e_namespace" = 1 ]; then
  (
    while verify_production_unchanged; do
      sleep 0.2
    done
    printf '%s\n' "production runtime PID or identity changed" > "$production_guard_failure"
  ) &
  production_guard_pid=$!
fi

if [ -L "$state_dir" ]; then
  echo "Refusing to remove symlinked runtime state: $state_dir" >&2
  exit 1
fi
if [ "$e2e_namespace" = 1 ] && [ -L "$updater_dir" ]; then
  echo "Refusing to remove symlinked updater state: $updater_dir" >&2
  exit 1
fi
if [ "$e2e_namespace" = 1 ]; then
  if ! verify_namespaced_app "$baseline_app"; then
    echo "Namespaced E2E baseline does not use the isolated app, launchd, and signing contract." >&2
    exit 1
  fi
  mkdir -p "$target_mount"
  hdiutil attach -readonly -nobrowse -mountpoint "$target_mount" "$target_dmg" >/dev/null
  target_mounted=true
  if ! verify_namespaced_app "$target_mount/CodeWide.app"; then
    echo "Namespaced E2E target does not use the isolated app, launchd, and signing contract." >&2
    exit 1
  fi
  target_info="$target_mount/CodeWide.app/Contents/Info.plist"
  mounted_target_version=$(plutil -extract CFBundleShortVersionString raw -o - "$target_info")
  target_build=$(plutil -extract CFBundleVersion raw -o - "$target_info")
  target_revision=$(plutil -extract CodeWideSourceRevision raw -o - "$target_info")
  if [ "$mounted_target_version" != "$target_version" ]; then
    echo "Target argument does not match the target DMG version." >&2
    exit 1
  fi
  hdiutil detach "$target_mount" >/dev/null
  target_mounted=false
  e2e_cleanup_armed=true
  rm -rf -- "$updater_dir"
  rm -f -- "$guardian_plist"
fi
rm -rf -- "$state_dir"
mkdir -p "$state_dir" "$HOME/Applications" "$feed_dir" "$host_dir" "$baseline_image_dir"
printf '%s\n' '{"schemaVersion":0,"launchCount":0,"lastCoreVersion":"0.0.0"}' \
  > "$state_dir/runtime-state.json"
printf '%s\n' '{"version":5,"devices":[],"pairings":[]}' > "$state_dir/devices.json"
chmod 0600 "$state_dir/devices.json"
printf '%s\n' 'preserve-across-update' > "$state_dir/update-state-sentinel"
printf '%s\n' 'enabled' > "$report_marker"
chmod 0600 "$report_marker"
ditto "$baseline_app" "$test_app"
if [ "$e2e_namespace" = 1 ]; then
  # The remote-update user driver still delegates feed parsing and signature
  # verification to Sparkle. Pin only this disposable baseline to the local feed.
  plutil -replace SUFeedURL -string "$server_origin/feed/appcast.xml" \
    "$test_app/Contents/Info.plist"
else
  # Preserve the original isolated-CI Sparkle harness for production builds.
  plutil -replace SUAllowsAutomaticUpdates -bool YES "$test_app/Contents/Info.plist"
  plutil -replace SUAutomaticallyUpdate -bool YES "$test_app/Contents/Info.plist"
  plutil -replace SUEnableAutomaticChecks -bool YES "$test_app/Contents/Info.plist"
fi
codesign --force --sign - --identifier "$app_identifier" "$test_app"
codesign --verify --deep --strict "$test_app"
baseline_info="$test_app/Contents/Info.plist"
baseline_version=$(plutil -extract CFBundleShortVersionString raw -o - "$baseline_info")
baseline_build=$(plutil -extract CFBundleVersion raw -o - "$baseline_info")
baseline_revision=$(plutil -extract CodeWideSourceRevision raw -o - "$baseline_info")
cp "$target_dmg" "$feed_dir/"

if [ "$e2e_namespace" = 1 ]; then
  ditto "$test_app" "$baseline_image_dir/CodeWide.app"
  hdiutil create -quiet -ov -format UDZO -volname CodeWide-E2E \
    -srcfolder "$baseline_image_dir" "$baseline_dmg"
  appcast_prefix="$server_origin/feed/"
else
  appcast_prefix="$server_origin/"
fi
printf '%s' "$private_key" | "$sparkle_bin/generate_appcast" \
  --ed-key-file - \
  --download-url-prefix "$appcast_prefix" \
  --link "https://github.com/MrFlashAccount/CodeWide" \
  --maximum-versions 1 \
  "$feed_dir"
test -f "$feed_dir/appcast.xml"

if [ "$e2e_namespace" = 1 ]; then
  CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY="$host_update_private_key" \
  CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI="$host_update_public_key" \
  CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID="$host_update_key_id" \
    node "$mac_root/scripts/create-update-e2e-manifests.mjs" \
      "$host_dir" "$server_origin" "$baseline_dmg" "$target_dmg" \
      "$baseline_version" "$baseline_build" "$baseline_revision" \
      "$target_version" "$target_build" "$target_revision" \
      > "$root/manifest-summary.json"
fi

if [ "$e2e_namespace" = 1 ]; then
  server_directory=$root
else
  server_directory=$feed_dir
fi
python3 -m http.server "$port" --bind 127.0.0.1 \
  --directory "$server_directory" >"$server_log" 2>&1 &
server_pid=$!

if [ "$e2e_namespace" = 1 ]; then
  CODEWIDE_HOST_UPDATE_E2E_MANIFEST_BASE_URL="$server_origin/host" \
    "$test_app/Contents/MacOS/CodeWide" >"$app_log" 2>&1 &
else
  CODEWIDE_UPDATE_E2E=1 \
  CODEWIDE_UPDATE_FEED_URL="$server_origin/appcast.xml" \
    "$test_app/Contents/MacOS/CodeWide" >"$app_log" 2>&1 &
fi

baseline_ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if [ -f "$report" ] && jq -e --arg version "$baseline_version" '
    .appVersion == $version and
    .hostVersion == $version and
    .coreVersion == $version and
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
jq -e '.entries["tls-private-key"].backend == "private-file"' \
  "$state_dir/identity/secure-store.json" >/dev/null

if [ "$e2e_namespace" = 1 ]; then
  # This physical gate starts at the authenticated proxy's private IPC seam.
  # HTTP/session authorization is covered by companion-core tests; everything
  # from signed guardian admission through Sparkle, rollback, reconnect, and
  # durable commit runs through the production executables and file contracts.
  check_request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  check_request="$root/check-request.json"
  jq -n --arg requestId "$check_request_id" '{
  ipcVersion: 1,
  apiVersion: 1,
  guardianContractVersion: 1,
  journalVersion: 1,
  bootstrapVersion: 1,
  requestId: $requestId,
  method: "check"
}' > "$check_request"
  publish_guardian_request "$check_request_id" "$check_request"
  if ! check_response=$(wait_for_guardian_response "$check_request_id" 600); then
    echo "Guardian check did not return a response." >&2
    dump_diagnostics
    exit 1
  fi
  if ! jq -e '.error == null and .payload.availableTarget != null' \
    "$check_response" >/dev/null; then
    echo "Guardian rejected the signed E2E release manifests." >&2
    dump_diagnostics
    exit 1
  fi
  target_fingerprint=$(jq -er '.payload.availableTarget.targetFingerprint' "$check_response")
  mv "$feed_dir/appcast.xml" "$root/appcast-withheld.xml"

  initiating_device=e2e-device
  apply_request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  idempotency_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
  apply_request="$root/apply-request.json"
  jq -n \
  --arg requestId "$apply_request_id" \
  --arg fingerprint "$target_fingerprint" \
  --arg idempotencyKey "$idempotency_key" \
  --arg deviceId "$initiating_device" '{
    ipcVersion: 1,
    apiVersion: 1,
    guardianContractVersion: 1,
    journalVersion: 1,
    bootstrapVersion: 1,
    requestId: $requestId,
    method: "apply",
    command: {
      targetFingerprint: $fingerprint,
      idempotencyKey: $idempotencyKey,
      initiatingDeviceId: $deviceId
    }
  }' > "$apply_request"
  publish_guardian_request "$apply_request_id" "$apply_request"
  if ! apply_response=$(wait_for_guardian_response "$apply_request_id" 300); then
    echo "Guardian apply did not return a response." >&2
    dump_diagnostics
    exit 1
  fi
  if ! jq -e '.error == null and .payload.phase == "accepted"' \
    "$apply_response" >/dev/null; then
    echo "Guardian rejected the E2E apply request." >&2
    dump_diagnostics
    exit 1
  fi
  failure_operation_id=$(jq -er '.payload.operationId' "$apply_response")
  failure_terminal="$updater_dir/v1/operations/$failure_operation_id.json"
  rolled_back=false
  attempt=0
  while [ "$attempt" -lt 120 ]; do
    if [ -f "$failure_terminal" ] && \
       jq -e '.phase == "rolledBack" and .errorCode == "update_rolled_back"' \
         "$failure_terminal" >/dev/null; then
      rolled_back=true
      break
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ "$rolled_back" != true ]; then
    echo "Guardian did not roll back after the intentionally unavailable Sparkle appcast." >&2
    dump_diagnostics
    exit 1
  fi
  rolled_back_at=$(jq -er '.updatedAt' "$failure_terminal")
  rollback_ready=false
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    current_runtime_pid=$(launchctl print "gui/$(id -u)/$runtime_label" \
      2>/dev/null | awk '/pid =/{print $3; exit}') || true
    now_ms=$(($(date +%s) * 1000))
    if [ -n "$current_runtime_pid" ] && [ -f "$report" ] && \
       [ -f "$runtime_observation" ] && \
       jq -e \
         --arg version "$baseline_version" \
         --argjson baselineAppPid "$baseline_app_pid" \
         --argjson baselineRuntimePid "$baseline_runtime_pid" \
         --argjson currentRuntimePid "$current_runtime_pid" '
         .phase == "running" and
         .appVersion == $version and
         .hostVersion == $version and
         .coreVersion == $version and
         .appProcessId != $baselineAppPid and
         .processId != $baselineRuntimePid and
         .processId == $currentRuntimePid
       ' "$report" >/dev/null && \
       jq -e \
         --arg version "$baseline_version" \
         --argjson currentRuntimePid "$current_runtime_pid" \
         --argjson rolledBackAt "$rolled_back_at" \
         --argjson now "$now_ms" '
         .processID == $currentRuntimePid and
         .appVersion == $version and
         .coreRunning == true and
         .upstreamLive == true and
         .observedAt > $rolledBackAt and
         .observedAt <= $now and
         ($now - .observedAt) <= 5000
       ' "$runtime_observation" >/dev/null; then
        rollback_ready=true
        break
    fi
    if [ -e "$production_guard_failure" ]; then
      break
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ "$rollback_ready" != true ] || \
     [ "$(cat "$state_dir/update-state-sentinel")" != preserve-across-update ] || \
     ! production_guard_is_healthy; then
    echo "Rollback did not restore the baseline cleanly or changed the production instance." >&2
    dump_diagnostics
    exit 1
  fi
  mv "$root/appcast-withheld.xml" "$feed_dir/appcast.xml"

  apply_request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  idempotency_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
  apply_request="$root/apply-success-request.json"
  jq -n \
  --arg requestId "$apply_request_id" \
  --arg fingerprint "$target_fingerprint" \
  --arg idempotencyKey "$idempotency_key" \
  --arg deviceId "$initiating_device" '{
    ipcVersion: 1,
    apiVersion: 1,
    guardianContractVersion: 1,
    journalVersion: 1,
    bootstrapVersion: 1,
    requestId: $requestId,
    method: "apply",
    command: {
      targetFingerprint: $fingerprint,
      idempotencyKey: $idempotencyKey,
      initiatingDeviceId: $deviceId
    }
  }' > "$apply_request"
  publish_guardian_request "$apply_request_id" "$apply_request"
  if ! apply_response=$(wait_for_guardian_response "$apply_request_id" 300); then
    echo "Guardian success apply did not return a response." >&2
    dump_diagnostics
    exit 1
  fi
  if ! jq -e '.error == null and .payload.phase == "accepted"' \
    "$apply_response" >/dev/null; then
    echo "Guardian rejected the success E2E apply request." >&2
    dump_diagnostics
    exit 1
  fi
  operation_id=$(jq -er '.payload.operationId' "$apply_response")
  jq -n \
  --arg failureOperationId "$failure_operation_id" \
  --arg operationId "$operation_id" \
  --arg targetFingerprint "$target_fingerprint" \
  '{mode:"guardian-ipc-full-chain", transportBoundary:"guardian-ipc-direct",
    failureOperationId:$failureOperationId,
    operationId:$operationId,
    targetFingerprint:$targetFingerprint}' > "$root/e2e-boundary.json"
fi

updated=false
attempt=0
while [ "$attempt" -lt 180 ]; do
  if [ -f "$report" ] && jq -e \
    --arg version "$target_version" \
    --arg baselineVersion "$baseline_version" \
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
    .updateFromVersion == $baselineVersion and
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

if [ "$e2e_namespace" = 1 ]; then
  awaiting_reconnect=false
  attempt=0
  while [ "$attempt" -lt 180 ]; do
    operation_request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    operation_request="$root/operation-$attempt.json"
    jq -n \
    --arg requestId "$operation_request_id" \
    --arg operationId "$operation_id" '{
      ipcVersion: 1,
      apiVersion: 1,
      guardianContractVersion: 1,
      journalVersion: 1,
      bootstrapVersion: 1,
      requestId: $requestId,
      method: "operation",
      operationId: $operationId
    }' > "$operation_request"
    publish_guardian_request "$operation_request_id" "$operation_request"
    if operation_response=$(wait_for_guardian_response "$operation_request_id" 50); then
      operation_phase=$(jq -r '.payload.phase // "error"' "$operation_response")
      if [ "$operation_phase" = awaitingReconnect ]; then
        awaiting_reconnect=true
        break
      fi
      if [ "$operation_phase" = rolledBack ] || [ "$operation_phase" = failed ]; then
        echo "Guardian terminated the E2E operation in phase $operation_phase." >&2
        dump_diagnostics
        exit 1
      fi
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ "$awaiting_reconnect" != true ]; then
    echo "Guardian did not reach awaitingReconnect after the target became healthy." >&2
    dump_diagnostics
    exit 1
  fi

  reconnect_request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  reconnect_request="$root/reconnect-request.json"
  jq -n \
  --arg requestId "$reconnect_request_id" \
  --arg operationId "$operation_id" \
  --arg deviceId "$initiating_device" '{
    ipcVersion: 1,
    apiVersion: 1,
    guardianContractVersion: 1,
    journalVersion: 1,
    bootstrapVersion: 1,
    requestId: $requestId,
    method: "reconnect",
    receipt: {operationId: $operationId, deviceId: $deviceId}
  }' > "$reconnect_request"
  publish_guardian_request "$reconnect_request_id" "$reconnect_request"
  if ! reconnect_response=$(wait_for_guardian_response "$reconnect_request_id" 300); then
    echo "Guardian reconnect did not return a response." >&2
    dump_diagnostics
    exit 1
  fi
  if ! jq -e '.error == null and .payload.phase == "committed"' \
    "$reconnect_response" >/dev/null; then
    echo "Guardian did not commit after the fresh reconnect receipt." >&2
    dump_diagnostics
    exit 1
  fi
  terminal_operation="$updater_dir/v1/operations/$operation_id.json"
  jq -e '.phase == "committed"' "$terminal_operation" >/dev/null
fi

test -f "$state_dir/runtime-state.v0.backup.json"
test "$(cat "$state_dir/update-state-sentinel")" = preserve-across-update
test "$(jq -r '.version' "$state_dir/devices.json")" = 5
if [ "$e2e_namespace" = 1 ] && ! production_guard_is_healthy; then
  echo "The namespaced E2E changed the production runtime PID or identity state." >&2
  dump_diagnostics
  exit 1
fi
jq -e '.entries["tls-private-key"].backend == "private-file"' \
  "$state_dir/identity/secure-store.json" >/dev/null
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
if [ "$e2e_namespace" = 1 ] && ! production_guard_is_healthy; then
  echo "The namespaced E2E changed the production runtime PID or identity state." >&2
  dump_diagnostics
  exit 1
fi

if [ "$e2e_namespace" = 1 ]; then
  launchctl bootout "gui/$(id -u)/$guardian_label" >/dev/null 2>&1 || true
  stop_test_app
  if ! unregister_e2e_smappservice; then
    echo "Failed to unregister the E2E runtime SMAppService." >&2
    exit 1
  fi
  e2e_smappservice_unregistered=true
  launchctl bootout "gui/$(id -u)/$runtime_label" >/dev/null 2>&1 || true
fi

if [ "$e2e_namespace" = 1 ]; then
  jq -n \
    --arg version "$target_version" \
    --arg operationId "$operation_id" \
    --arg failureOperationId "$failure_operation_id" \
    --arg productionRuntimePid "$production_runtime_pid" \
    --argjson previousPid "$old_pid" \
    --argjson recoveredPid "$new_pid" \
    --argjson launchCount "$new_launch_count" \
    '{status:"ok", mode:"guardian-ipc-full-chain",
      transportBoundary:"guardian-ipc-direct", operationId:$operationId,
      failureOperationId:$failureOperationId, productionRuntimePid:$productionRuntimePid,
      version:$version, previousPid:$previousPid, recoveredPid:$recoveredPid,
      launchCount:$launchCount}'
else
  jq -n \
    --arg version "$target_version" \
    --argjson previousPid "$old_pid" \
    --argjson recoveredPid "$new_pid" \
    --argjson launchCount "$new_launch_count" \
    '{status:"ok", version:$version, previousPid:$previousPid,
      recoveredPid:$recoveredPid, launchCount:$launchCount}'
fi
