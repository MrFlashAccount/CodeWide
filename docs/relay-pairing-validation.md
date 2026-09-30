# Interactive Relay pairing validation

Validated locally on macOS on 2026-09-26, with Linux build and deployment
preparation on 2026-09-27. These results describe source builds, not a published
release.

## Implemented flow

`codewide-relay pair` opens one sixty-second enrollment window on the running
daemon. The inline Ratatui panel shows its reachable address, remaining time,
and the connecting computer's label. CodeWide accepts the address alone.
Matching four-symbol verification and Enter in the Relay terminal authorize
automatic credential exchange. Success waits for the authenticated adapter.
Timeout, cancellation, and owner disconnect close enrollment and revoke
provisional credentials; an unsuccessful Mac attempt restores its old settings.

Administration uses the daemon's private control socket and discovers the
active Linux system service. It no longer creates an unrelated certificate or
registry when `pair`, `invite`, or `status` is run as the login user.

## Automated evidence

- `pnpm test:companion`: 520 passed, 2 ignored by the existing suite.
- Cargo Clippy across the workspace and all targets: passed with warnings denied.
- Cargo formatting and `git diff --check`: passed.
- Relay integration tests exercise real TLS, matching symbols, online adapter
  confirmation, candidate isolation, invalid nonce revelation, cancellation,
  provisional credential revocation, and a real one-minute deadline.
- The committed `apps/relay/tests/terminal.py` suite passes 13 checks against a
  real CLI in a pseudo-terminal. It covers premature Enter, saved computer
  labels, piped JSON/text output, a narrow no-color terminal, Ctrl+C, Esc,
  SIGTERM, immediate retry, real expiration, daemon disconnect, and terminal
  restoration after every exit path.
- Swift package tests: 58 passed, including cancellation before the first XPC reply,
  cancellation during confirmation, and secure archiving of the emoji payload.
- Universal macOS FFI builds and generated-binding comparison pass for Apple
  Silicon and Intel. The application bundle passes deep signature verification.
- `apps/companion-macos/scripts/validate-boundaries.sh`: passed.

Local logs and terminal recordings are under `test-results/macos/relay-*`.
The terminal suite can be repeated using the commands in the Relay README.

## Local installation

Source build `0.4.0 (100005.12)` is installed locally. The prior bundle was kept
for rollback; runtime state and identity hashes were unchanged by installation.
The authenticated helper health record matches the installed app and helper
signatures. The helper is running and listens on `0.0.0.0:8767`; loopback TLS
verification and the bootstrap WebSocket upgrade pass. LAN TLS still returns
an EOF while the system firewall reports blocking non-essential incoming
connections. External-device reachability is not verified.

## Visual evidence and limits

The four exported Ratatui states were inspected through Computer Use in the
local browser preview: waiting, matching symbols, connected, and expired.
The preview uses actual Ratatui cell buffers and synthetic names/addresses.
This is visual evidence; the interactive CLI evidence comes from the PTY suite.

The macOS dialog was built and its layout measured with fixture states in both
appearances. Offscreen SwiftUI export could not faithfully render its native
controls and Liquid Glass. Native macOS interaction through Computer Use is
unverified because native app control is unavailable in this session. These
fixtures are not recorded as a passed native interaction test.

## Linux artifact and deployment preparation

The repository's Linux builder ran in an x86_64 Linux container using its pinned
Rust/musl image. It produced static source build `0.4.0-pair.3c094758a870` with
SHA-256 `bb534a1df3d5e61b4435c5f39b67db58d724b365f7006b77935f79928481df02`.
The source snapshot and per-file checksums are retained with the local evidence.
The artifact was transferred to the target host; its checksum and reported
version were verified there without replacing the running service.

On Linux, all 30 Relay Rust tests passed in the release profile. The same
13-check PTY suite also passed against the exact static artifact, including
matching-symbol enrollment, the real one-minute deadline, signal cancellation,
daemon failure, and terminal restoration. The artifact checksum was unchanged
after validation.

Deployment requires preserving the existing state and adding `AF_UNIX` to the
service's allowed address families for the new private control socket. The
prepared installer checks the old binary and service configuration, takes a
consistent state backup while stopped, atomically replaces the binary, and
verifies the certificate, existing state hashes, private socket, and running
executable. A failed validation restores the previous binary and service
configuration, retaining both the original backup and failed state.

The remote service was upgraded to `0.4.0-pair.3c094758a870` after interactive
sudo authentication. The installation receipt confirms preservation of all
eight existing state files, the existing route, and the TLS identity. A separate
SSH and public-endpoint check confirms that the running executable has the
expected checksum and the public TLS 1.3 endpoint returns health status 204
with the same certificate. This proves deployment health; the real
Mac-to-remote-host pairing interaction remains unverified.

## Bare-command regression

After deployment, entering `codewide-relay` in an interactive terminal attempted
to start another server and failed with `Address in use`. The original CLI
defaulted to `serve`; the prior PTY suite exercised the explicit `pair` command
and missed the normal entry point.

The corrected default opens a Ratatui menu for the running service. Connecting,
viewing saved computers, returning to the menu, and exiting do not require
another shell command. Noninteractive bare invocations read status. Explicit
`serve` and existing noninteractive units with `--port` retain server behavior.
Administration never initializes a separate registry. The CLI change retains
the existing enrollment and private-control protocols.

The updated suite checks the bare command against an already running daemon,
unchanged identity, empty and populated lists, pairing from the menu, Escape
navigation, control signals, and recovery after daemon failure. Workspace tests
pass (521 tests), and Clippy passes with warnings denied. All 23 PTY checks pass
on both macOS and Linux. The Linux release profile passes all 31 Relay tests.

The corrected static build is `0.4.0-menu.da3c38d3b5aa`, SHA-256
`1b2bd2372f831b7299714ecc888a46aac7fdaa31a55725eb9ec66935c6889c17`.
It also passes a Linux upgrade check with the previous daemon: the new bare
command opens and exits the menu as the service owner, restores the terminal,
preserves identity, and leaves the daemon running. The installer uses that same
menu guard on the live service before declaring success.

This artifact is installed on the target host. The installation receipt confirms
that the service-owner menu opens, exits and restores the terminal; all nine
existing state files, the route and the TLS identity are preserved. A separate
SSH and pinned public TLS check verifies the running binary checksum and health
status 204. Fresh SSH sessions, including a pseudo-terminal, resolve
`codewide-relay` to `/usr/local/bin/codewide-relay` and report the menu build's
version. No release was published.

Existing direct-access firewall limitations remain outside this pairing change.

## Executable availability

The Linux installer previously defaulted to `~/.local/bin` and reported success
even if that directory was absent from PATH. It now defaults to `/usr/local/bin`,
elevates only filesystem installation operations when required, and verifies
the installed command by name. Invalid PATH destinations and a conflicting
earlier executable fail before installation. Custom destinations remain supported
when they are in PATH.

Validation uses the exact Linux menu artifact: unprivileged installation through
sudo, fresh Bash login lookup, execution by another service user, root upgrade,
custom directories containing spaces, permissions, conflicting PATH entries,
and rejection of a tampered download all pass. ShellCheck passes. These installer
changes are local source changes and have not been published.

The native Apple Silicon CLI is also installed in the Mac user's existing PATH.
A fresh Fish session resolves `codewide-relay` and successfully runs `--version`
and `--help`. This makes the executable available locally; administration of the
remote Relay still takes place on its host. Local CLI availability does not prove
native CodeWide UI or remote pairing end-to-end behavior.

## Service administration permissions

The first menu build found the running system service but could reach its
`0600` control socket only as the `codewide-relay` service account, so an
interactive invocation re-executed itself through `sudo -u` and requested the
operator's password. That was the immediate cause of the unexpected prompt.

The corrected service mode uses `--group-admin`. It gives the service group
execute-only access to the state root and read/write access to `control.sock`;
route directories and every credential file remain private. The CLI no longer
invokes sudo. An unauthorized account gets an actionable error naming the group
and can retry after an administrator adds it and the account signs in again.
