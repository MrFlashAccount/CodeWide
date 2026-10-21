# codewide-companion

`codewide-companion` is the headless Linux host and command-line delivery of
the CodeWide Companion.

It imports `companion-core` directly in the same process. Portable execution
and the systemd-installed service are packaging modes of this Rust host, not a
client/server split between the host and the core.

## Owns

- the `codewide-companion` executable and CLI parsing;
- Linux process startup, shutdown, logging, and runtime composition;
- systemd installation and operational verification under `deploy/`;
- Linux administrative commands such as pairing, device listing, revocation,
  identity management, indexing, and diagnostics;
- the optional private Unix control endpoint used when a CLI command must act
  on the already-running daemon.

The Unix endpoint is a Linux management transport. It exists to avoid opening
a second competing runtime over the same state and resources. It is not the
host-to-core boundary, and it must not be copied into the macOS application.

## Does not own

- shared Companion domain behavior, which belongs in `companion-core`;
- macOS menu UI, XPC, LaunchAgent, or Sparkle integration;
- relay internals;
- Android client behavior.

`src/lib.rs` is a compatibility facade that re-exports `companion-core` for
existing Rust consumers. New domain behavior should normally be implemented in
the core rather than in the executable.

## Logging

`main.rs` installs the shared companion filter (`companion_core::log_filter`):
`warn` for every target and `info` for the companion, provider wiring, child
transports and provider adapters.
`RUST_LOG` refines it per target; it never replaces the defaults, so a unit
that names only `codewide_companion` cannot silence the provider crates. The
user unit sets no `RUST_LOG`; read the records with
`journalctl --user -u codewide-companion.service`.

## Agent providers

`codewide-companion providers status [--state-dir <dir>]` prints the
configured providers from `agent-providers.json` as JSON and exits non-zero
unless every configured provider could start. It is offline (configuration
and file metadata only). Codex is always enabled; a host without Codex is not
supported. Claude needs no setup and ships nothing: the companion drives the
user's own `claude` CLI directly and runs Claude when a signed-in `claude` is
found;
`"claude": false` in `agent-providers.json` turns it off. See
[docs/agent-providers.md](../../docs/agent-providers.md#install-and-configuration).

## Running locally

Inspect the available commands and required paths with:

```sh
cargo run -p codewide-companion -- --help
```

Do not infer production security from the default local listen address. The
authenticated device protocol, relay route, administrator token, state paths,
and mutation mode must be configured by the deployment owner.

## Dictation proxy

Companion owns its dictation proxy setting; it never reads a Codex `.env`
file. With no saved setting, reqwest keeps its standard `HTTP_PROXY`,
`HTTPS_PROXY`, and `NO_PROXY` process-environment behavior. A managed Linux
host can persist an explicit override and then restart the service:

```sh
codewide-companion proxy configure --https-proxy http://127.0.0.1:3129
systemctl --user restart codewide-companion.service
```

`--http-proxy` and `--no-proxy` are also accepted. Run
`codewide-companion proxy clear` to remove the application override and return
to process-environment discovery. The private settings file lives in the
Companion state directory and stores no Codex configuration. It is internal
state: if it is damaged or unreadable, Companion logs a warning and falls back
to process-environment discovery; the next `configure` replaces it.

## Distribution

The portable `x86_64-unknown-linux-musl` release bundle contains the headless
host, bundled Git provider, memory
watcher and user-systemd units. After a
release is published, the checksummed standalone installer installs and starts
that bundle with:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/companion | sh
```

The same release asset feeds the `codewide-companion` formula in
`MrFlashAccount/homebrew-codewide`. The curl installer owns user-systemd
activation and rollback; the Homebrew formula uses `brew services` and prints
the required one-time state and Git-provider initialization commands.

Managed installations use immutable directories under
`~/.local/lib/codewide/generations/`. The stable systemd unit executes only
`current/bin/codewide-companion`; activation replaces the relative `current`
symlink on the same filesystem. A distinct guardian executable lives under
`bootstrap/`, outside every generation. Its journal lives independently under
`~/.local/state/codewide/host-update`. The guardian owns that journal,
downloads only the target authenticated by the signed release descriptor,
waits for exact health and the initiating device's reconnect, and switches back
to the certified previous generation on any failure. It never restores or
rewrites Companion's authoritative state. Existing flat installations report
`manual_bootstrap_required` until the standalone installer establishes this
layout and its pinned trust configuration.

A managed installation can also update itself from its own terminal:

```sh
codewide-companion update           # install the newest release
codewide-companion update --check   # only report whether one is available
```

The command talks to the running service through its private control socket
with the administrator token, so it needs no paired phone. The terminal is the
update's initiating device: it follows the restart and confirms the new
Companion, which commits the update; if that fails, the guardian restores the
previous generation. It exits non-zero unless the Companion ends on the newest
release, and `--json` prints the result instead of progress lines. An
interrupted run leaves the update to roll back at its reconnect deadline;
running `update` again before then follows it and confirms it.

## Validation and release

```sh
cargo test -p codewide-companion
cargo clippy -p codewide-companion --all-targets -- -D warnings
./scripts/release-companion --dry-run
```

Publishing is owned by the repository one-shot command:

```sh
./scripts/release-companion-linux <version>
```

`./scripts/release-companion` remains the validated local deployment command.
