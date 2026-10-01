# codewide-relay

`codewide-relay` is the separately deployed blind reverse transport used to
connect a Companion and its remote clients when direct reachability is not
available.

## Owns

- sixty-second interactive pairing, legacy invitations, and route registration;
- bounded opaque forwarding between authenticated route peers;
- relay TLS identity and pinning material;
- relay-local route persistence, revocation, and status commands;
- listener lifecycle for the standalone `codewide-relay` process.

The relay transports encrypted application bytes. Companion authentication and
the inner application TLS session remain end-to-end boundaries; the relay must
not gain message, device, or command semantics.

## Does not own

- Companion domain APIs or device authorization;
- plaintext inspection or termination of the inner Companion session;
- Linux Companion process management;
- macOS XPC, LaunchAgent, or application updates;
- client projection state.

`companion-core` may use the relay client-side adapter, but the relay remains a
separate deployable service with independent state and failure handling.

## Running locally

```sh
cargo run -p codewide-relay -- --help
```

## Install on a Linux VPS

On Linux x86_64 with systemd, run as the user that will administer this Relay:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay | sh
codewide-relay pair
```

The installer verifies the released binary, installs it into PATH, and starts a
user service with autostart after logout and reboot. It requests administrator
access when needed, preserves existing service settings and identity, and
restores the previous deployment if the new daemon cannot become ready. Allow
inbound TCP `8780` in the VPS firewall; firewall settings are not changed by the
installer. `--no-start` is available for manually managed binary-only installs.

## Terminal commands

Run `codewide-relay` to open the interactive menu for the running service.
Choose **Connect a computer** or **Paired computers** with the arrow keys and
Enter. Escape returns to the menu; Escape from the menu exits without stopping
the server. Without an interactive terminal, the default command reads status.

Use `codewide-relay serve` to start a foreground server on `0.0.0.0:8780`.
Existing noninteractive service units using `--port` without a subcommand remain
compatible. Administration talks to the running process through its private
control socket and never starts another server.

## Connect a Mac

On the Relay host:

```sh
codewide-relay
```

Choose **Connect a computer**. The Ratatui panel displays the public IP, port,
and a one-minute countdown. In CodeWide on the Mac, choose **Advanced → Add Relay**,
enter that address, and click **Connect**. Check the four symbols shown on both
screens, then press **Enter** in the Relay terminal. Keys and the route ID are
exchanged automatically. The panel shows the Mac's computer name and reports
success once its authenticated Relay connection is established.

The minute includes confirmation and connection. Expiration, **Esc**, **Ctrl+C**,
or closing the terminal cancels incomplete pairing. Existing computers keep
their access. Only one terminal and one candidate can pair at a time.

If the external port differs from the listener, or public IP detection is
unavailable, specify the reachable address:

```sh
codewide-relay --address 203.0.113.42:8780
codewide-relay status
codewide-relay status --json
codewide-relay revoke --route <route-id>
```

On Linux, commands discover the active system or user `codewide-relay.service`
and its state directory. The curl-installed service is owned by the installing
user, who can administer it directly. A separately managed service owned by
another user should run with `--group-admin`; members of its Unix
group can then use the administration socket directly, without `sudo`. Only the
socket is group-readable and writable: credential files and route directories
remain private to the service user. After adding an administrator to the group,
sign in again so the new membership applies.

Use global `--state <directory>` for a manually managed Relay. Administration
never creates a new state directory or a second certificate. A daemon without
a control socket or group administration must be upgraded before these commands
can operate without changing users.

`codewide-relay pair` remains a shortcut that opens pairing directly and exits
when it finishes. In the menu, completed pairing returns to the updated list of
saved computers without another shell command.

The panel updates in place without entering the alternate screen. It needs a
terminal of at least 44 columns × 16 rows. `NO_COLOR=1` or `--color never`
disables color; confirmation remains keyboard accessible. `--json` is available
for administration commands, while `pair` requires an interactive terminal.
Exit status is `0` on success, `124` on expiration, `130` on keyboard cancellation,
`143` on SIGTERM, and `1` on other failures.

`invite` remains available for older Companion clients that accept a single-use
JSON invitation. Protocol and deployment details are in
[the Relay guide](../../docs/relay-rollout.md).

## Validation

```sh
cargo test -p codewide-relay
cargo clippy -p codewide-relay --all-targets -- -D warnings
```

Exercise the actual CLI in a pseudo-terminal, including a real sixty-second
expiration, cancellation signals, no-color output, and terminal restoration:

```sh
cargo build -p codewide-relay --bin codewide-relay --example enrollment-smoke
python3 apps/relay/tests/terminal.py
```

This suite uses isolated temporary state and a loopback peer. It never reads or
changes the installed Relay's state. Results go to `test-results/relay-cli/`;
set `CODEWIDE_RELAY_TEST_OUTPUT` to choose another evidence directory.
