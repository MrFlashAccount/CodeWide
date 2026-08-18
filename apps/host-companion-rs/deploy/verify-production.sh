#!/bin/sh
set -eu

token_file=${CODEWIDE_TOKEN_FILE:-"$HOME/.codewide/host.token"}
control_endpoint=${CODEWIDE_CONTROL_ENDPOINT:-"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/codewide/companion-control.sock"}

test -s "$token_file"
token=$(tr -d '\r\n' < "$token_file")
curl --fail --silent --show-error --max-time 3 --unix-socket "$control_endpoint" \
  http://localhost/healthz >/dev/null
curl --fail --silent --show-error --max-time 3 --unix-socket "$control_endpoint" \
  -H "Authorization: Bearer $token" \
  http://localhost/v1/devices >/dev/null
systemctl --user is-active --quiet codewide-host-rust.service
if systemctl --user is-active --quiet codewide-host.service; then
  printf '%s\n' 'retired Node companion is unexpectedly active' >&2
  exit 1
fi
printf '%s\n' 'rust=healthy mutations=enabled node=inactive'
