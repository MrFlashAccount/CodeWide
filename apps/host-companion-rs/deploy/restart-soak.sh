#!/bin/sh
set -eu

unit=codewide-host-rust-shadow.service
node_unit=codewide-host.service
iterations=${CODEX_RESTART_ITERATIONS:-5}
token_file=${CODEWIDE_TOKEN_FILE:-"$HOME/.codewide/host.token"}
token=$(tr -d '\r\n' < "$token_file")
control_endpoint=${CODEWIDE_CONTROL_ENDPOINT:-"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide-shadow/companion-control.sock"}
node_pid=$(systemctl --user show --property MainPID --value "$node_unit")
started_at=$(date +%s)

case "$iterations" in
  ''|*[!0-9]*|0) printf '%s\n' 'CODEX_RESTART_ITERATIONS must be a positive integer' >&2; exit 2 ;;
esac

wait_for_recovery() {
  previous_pid=$1
  attempts=0
  while :; do
    current_pid=$(systemctl --user show --property MainPID --value "$unit")
    active=$(systemctl --user is-active "$unit" 2>/dev/null || true)
    if [ "$active" = active ] && [ "$current_pid" != 0 ] && [ "$current_pid" != "$previous_pid" ]; then
      if curl --fail --silent --max-time 2 --unix-socket "$control_endpoint" \
        http://localhost/healthz >/dev/null 2>&1 \
        && curl --fail --silent --max-time 2 --unix-socket "$control_endpoint" \
          -H "Authorization: Bearer $token" http://localhost/v1/devices >/dev/null 2>&1; then
        return 0
      fi
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      return 1
    fi
    sleep 0.2
  done
}

iteration=1
while [ "$iteration" -le "$iterations" ]; do
  rust_pid=$(systemctl --user show --property MainPID --value "$unit")
  test "$rust_pid" != 0
  systemctl --user kill --signal=KILL --kill-whom=main "$unit"
  wait_for_recovery "$rust_pid"
  test "$(systemctl --user show --property MainPID --value "$node_unit")" = "$node_pid"
  curl --fail --silent --max-time 2 http://127.0.0.1:8765/healthz >/dev/null
  iteration=$((iteration + 1))
done

finished_at=$(date +%s)
printf '{"status":"pass","iterations":%s,"nodePidUnchanged":true,"elapsedSeconds":%s}\n' \
  "$iterations" "$((finished_at - started_at))"
