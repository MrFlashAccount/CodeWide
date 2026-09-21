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

## Running locally

Inspect the available commands and required paths with:

```sh
cargo run -p codewide-companion -- --help
```

Do not infer production security from the default local listen address. The
authenticated device protocol, relay route, administrator token, state paths,
and mutation mode must be configured by the deployment owner.

## Distribution

The portable `x86_64-unknown-linux-musl` release bundle contains the headless
host, bundled Git provider, memory watcher, and user-systemd units. After a
release is published, the checksummed standalone installer installs and starts
that bundle with:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/companion | sh
```

The same release asset feeds the `codewide-companion` formula in
`MrFlashAccount/homebrew-codewide`. The curl installer owns user-systemd
activation and rollback; the Homebrew formula uses `brew services` and prints
the required one-time state and Git-provider initialization commands.

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
