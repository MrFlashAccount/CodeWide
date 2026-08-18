# Rust companion rollout

The Rust companion has one network listener: its authenticated public transport
on `127.0.0.1:8766`. Administrative commands are available only through the CLI,
which talks to the running process over the private local endpoint
`$XDG_RUNTIME_DIR/codewide/companion-control.sock`. HTTP is only internal framing
over that OS-local transport; there is no administrative TCP port to expose.
The platform adapter uses a Unix socket on Linux/macOS and is the boundary for a
Windows Named Pipe implementation. The Node companion remains on
`127.0.0.1:8765` as a temporary rollback target.

## Headless operator CLI

The installed companion binary owns both `serve` and all local administration;
Node is not required:

```sh
codewide-host-rs create-token
CODEWIDE_PUBLIC_ENDPOINT=wss://host.example/v1/sync codewide-host-rs pair
codewide-host-rs devices
codewide-host-rs scopes DEVICE_ID threads.read,turns.start
codewide-host-rs revoke DEVICE_ID
```

These commands do not open a network listener. They contact the already running
`serve` process through the platform-local control endpoint and retain the
administrator token as a second authorization layer.

`pair` renders a camera-scannable QR directly in an interactive UTF-8 terminal.
Its default `--qr auto` mode uses compact Unicode when it fits, falls back to an
ANSI background renderer when block glyphs are unavailable, and writes a
mode-`0600` SVG when output is redirected, the terminal is `dumb`, or the symbol
would wrap. The fallback path is printed to stderr. Rendering can be forced for
diagnostics or scripting:

```sh
codewide-host-rs pair --qr unicode
codewide-host-rs pair --qr ansi
codewide-host-rs pair --qr svg --qr-output ./pairing.svg
codewide-host-rs pair --json
```

The pairing link and generated SVG contain a five-minute one-time secret. Do
not publish either artifact; delete an SVG after scanning it.

## Install or refresh the shadow

```sh
cargo build --release --workspace
apps/host-companion-rs/deploy/install-shadow.sh
apps/host-companion-rs/deploy/verify-shadow.sh
```

## Install or refresh production Rust

```sh
cargo build --release --workspace
apps/host-companion-rs/deploy/install-production.sh
apps/host-companion-rs/deploy/verify-production.sh
```

Production Rust requires the existing `~/.codewide/devices.json` authentication
registry but keeps all derived and operational state under
`~/.local/state/codewide-rust`. Sharing authentication does not create two state
owners.

## Gates

1. Frozen V1 HTTP, WebSocket, RPC, auth and scope contract passes.
2. Golden synthetic traces and real rollout pages are semantically identical.
3. Restart, truncation, partial-write, corrupt-index, upstream-disconnect and
   slow-client tests pass.
4. Cold and warm latency, throughput, RSS and CPU are measured on small and
   very large real threads.
5. Shadow performs no mutating App Server RPC and has no dual-write path.
6. A canary uses a separate hostname and device before production routing moves.
7. Node changes made during the rewrite pass the migration-delta audit in
   `docs/rust-companion-migration-delta.md`.

## Reproducible benchmark

The benchmark measures application-cold and warm history/resource reads, p50,
p95, p99, bounded concurrent load, errors, CPU time and RSS. It starts isolated
Node and Rust processes with private temporary state and never sends a mutating
RPC. The operating-system page cache is intentionally left in its normal state.

```sh
cargo build --release --workspace
CODEX_BENCH_THREADS='[
  {"name":"small","threadId":"<completed-small-thread>"},
  {"name":"large","threadId":"<completed-large-thread>"}
]' apps/host-companion-rs/deploy/benchmark-cold-shadow.sh
```

For a warm comparison against the already running production Node and Rust
shadow processes, use the same `CODEX_BENCH_THREADS` with:

```sh
pnpm --filter @codewide/host-companion bench:rust-shadow
```

Crash-restart soak keeps the production Node PID unchanged and verifies health
plus authenticated state after every forced Rust process death:

```sh
CODEX_RESTART_ITERATIONS=10 apps/host-companion-rs/deploy/restart-soak.sh
```

## Active route and rollback

`~/.config/frp/frpc.toml` currently routes `codewide` to `127.0.0.1:8766`.
Rollback is the same one-line change back to `8765`, followed by:

```sh
systemctl --user restart frpc-codewide.service
apps/host-companion-rs/deploy/verify-production.sh
```

The Node service stays running throughout. Stop the obsolete shadow with:

```sh
systemctl --user disable --now codewide-host-rust-shadow.service
```

The Rust redb files are derived indexes and operational state. Canonical Codex
rollout JSONL remains the source of full thread history, so rollback never
requires converting or copying thread data.
