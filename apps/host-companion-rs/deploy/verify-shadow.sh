#!/bin/sh
set -eu

token_file=${CODEWIDE_TOKEN_FILE:-"$HOME/.codewide/host.token"}
token=$(tr -d '\r\n' < "$token_file")
control_endpoint=${CODEWIDE_CONTROL_ENDPOINT:-"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide-shadow/companion-control.sock"}

wait_for_health() {
  endpoint=$1
  attempts=0
  until curl --fail --silent --max-time 2 --unix-socket "$endpoint" http://localhost/healthz >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      return 1
    fi
    sleep 0.2
  done
}

curl --fail --silent --max-time 2 http://127.0.0.1:8765/healthz >/dev/null
wait_for_health "$control_endpoint"
curl --fail --silent --show-error --max-time 5 --unix-socket "$control_endpoint" \
  -H "Authorization: Bearer $token" \
  http://localhost/v1/devices >/dev/null

printf '%s\n' 'node=healthy rust-shadow=healthy auth=healthy'
