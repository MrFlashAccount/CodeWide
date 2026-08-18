#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
node_port=${CODEX_BENCH_NODE_PORT:-18765}
rust_port=${CODEX_BENCH_RUST_PORT:-18766}
token_source=${CODEWIDE_TOKEN_FILE:-"$HOME/.codewide/host.token"}
app_server_socket=${CODEX_APP_SERVER_SOCKET:-"$HOME/.codex/app-server-control/app-server-control.sock"}
runtime=$(mktemp -d "${TMPDIR:-/tmp}/codewide-bench.XXXXXX")
node_pid=
rust_pid=

cleanup() {
  if [ -n "$node_pid" ]; then
    kill "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
  fi
  if [ -n "$rust_pid" ]; then
    kill "$rust_pid" 2>/dev/null || true
    wait "$rust_pid" 2>/dev/null || true
  fi
  rm -rf -- "$runtime"
}
trap cleanup EXIT INT TERM

test -n "${CODEX_BENCH_THREADS:-}"
test -s "$token_source"
test -S "$app_server_socket"
test -x "$repo_root/target/release/codewide-host-rs"
test -x "$repo_root/node_modules/.bin/tsx"
cp "$token_source" "$runtime/host.token"
chmod 0600 "$runtime/host.token"
mkdir -p "$runtime/rust"

(
  export CODEWIDE_HOST=127.0.0.1
  export CODEWIDE_PORT="$node_port"
  export CODEWIDE_TOKEN_FILE="$runtime/host.token"
  export CODEWIDE_REPLAY_JOURNAL="$runtime/node-replay.jsonl"
  export CODEWIDE_QUEUE_FILE="$runtime/node-queue.json"
  export CODEWIDE_DEVICE_REGISTRY="$runtime/node-devices.json"
  export CODEWIDE_PREVIEW_ROOTS='["/tmp/codewide-attachments"]'
  cd "$repo_root"
  exec node --import tsx "$repo_root/apps/host-companion/src/cli.ts" serve
) >"$runtime/node.log" 2>&1 &
node_pid=$!

"$repo_root/target/release/codewide-host-rs" serve \
  --listen "127.0.0.1:$rust_port" \
  --control-endpoint "$runtime/rust-control.sock" \
  --state "$runtime/rust/state.redb" \
  --token-file "$runtime/host.token" \
  --app-server-socket "$app_server_socket" \
  --codex-home "${CODEX_HOME:-$HOME/.codex}" \
  --device-registry "$runtime/rust/devices.json" \
  >"$runtime/rust.log" 2>&1 &
rust_pid=$!

wait_for_http_health() {
  port=$1
  attempts=0
  until curl --fail --silent --max-time 2 "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      printf '%s\n' "service on port $port did not become healthy" >&2
      sed -n '1,200p' "$runtime/node.log" >&2
      sed -n '1,200p' "$runtime/rust.log" >&2
      exit 1
    fi
    sleep 0.2
  done
}

wait_for_control_health() {
  endpoint=$1
  attempts=0
  until curl --fail --silent --max-time 2 --unix-socket "$endpoint" http://localhost/healthz >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      printf '%s\n' "service on $endpoint did not become healthy" >&2
      sed -n '1,200p' "$runtime/rust.log" >&2
      exit 1
    fi
    sleep 0.2
  done
}

wait_for_http_health "$node_port"
wait_for_control_health "$runtime/rust-control.sock"

CODEX_NODE_SYNC="ws://127.0.0.1:$node_port/v1/sync" \
CODEX_RUST_SYNC="ws://127.0.0.1:$rust_port/v1/sync" \
CODEX_NODE_PID="$node_pid" \
CODEX_RUST_PID="$rust_pid" \
CODEWIDE_TOKEN_FILE="$runtime/host.token" \
  "$repo_root/node_modules/.bin/tsx" \
  "$repo_root/apps/host-companion/src/benchmark-rust-shadow.ts"
