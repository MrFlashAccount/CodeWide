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
systemctl --user is-active --quiet codewide-companion.service
for legacy in codewide-host-rust-shadow.service codewide-host-rust.service codewide-host.service codex-remote-host-rust-shadow.service codex-remote-host-rust.service codex-remote-host.service; do
  if systemctl --user is-active --quiet "$legacy"; then
    printf 'retired companion service is unexpectedly active: %s\n' "$legacy" >&2
    exit 1
  fi
done
printf '%s\n' 'companion=healthy mutations=enabled legacy=inactive'
