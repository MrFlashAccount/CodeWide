# Blind relay pairing and rollout

Relay is a standalone Rust application. Each Companion owns one random
256-bit route ID and one independently generated Relay access token. The phone
uses a WSS endpoint with the route ID in the WebSocket handshake header;
Companion authenticates its outbound control
socket with the token. Relay maps the route to the current outbound Companion
socket and forwards only opaque inner-TLS bytes.

Relay exposes one TCP listener. Both sides connect outbound to that same
`IP:port`:

- TLS ClientHello connections on the same port serve phone tunnels, Companion
  attachments, health, pairing, and control through built-in pinned TLS 1.3;
- plain HTTP/WebSocket routes remain temporarily for installed clients paired
  under the earlier `/c/<route-id>` link.

The Relay application replaces `frps`; the outbound adapter built into
Companion replaces `frpc`. FRP is not present anywhere in this data path.

The route ID is a selector, not an authentication secret. New phone connections
send it as `x-codewide-relay-route` inside the pinned WSS handshake. The existing phone-to-Companion TLS/mTLS still protects
all application data and Companion authority end to end; Relay terminates only
its outer TLS and sees route and control metadata there. Data-plane
frames remain inner-TLS ciphertext.

## Start Relay

```sh
./scripts/build-relay-linux
dist/relay/codewide-relay-x86_64-unknown-linux-musl --version
```

The build emits the Linux binary and its SHA-256 manifest under `dist/relay/`.
The current release target is statically linked Linux `x86_64`, built in a
digest-pinned musl container so the same artifact runs on glibc and musl hosts.
ARM64 is rejected explicitly until a matching release artifact exists.

After those two files are published under the matching GitHub Release tag,
install and verify the binary without cloning the repository:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay | sh
codewide-relay serve --port 8780
```

The installer downloads versions through `0.4.0` from `relay-v<version>` and
newer versions from the combined `v<version>` release, verifies the release SHA-256,
checks the binary-reported version, and atomically installs it to
`/usr/local/bin/codewide-relay`. It requests `sudo` for the installation when
needed; downloads and verification run as the invoking user. No shell restart or
manual PATH edit is required. Before reporting success it verifies both
`command -v codewide-relay` and `codewide-relay --version` by name.

Use `--version` to pin a release. `--install-dir` or
`CODEWIDE_RELAY_INSTALL_DIR` overrides the destination, which must already be in
PATH. The installer rejects destinations outside PATH and commands shadowed by
another existing executable before changing files. Publishing the GitHub
Release remains a separate approved operation.

The binary binds `0.0.0.0:<port>`; the default port is `8780`. Durable state
lives under `${XDG_STATE_HOME:-$HOME/.local/state}/codewide/relay/`:

```text
registry.lock
daemon.lock
control.sock
transport-cert.der
transport-key.der
routes/<route-id>
invitations/<invitation-hash>
```

Directories use mode `0700`; files and the local control socket use `0600`; route updates are atomic and
cross-process serialized. Tokens are stored only as hashes. Relay generates
and persists its own TLS certificate/key; Companion pins the exact certificate
from the invitation bundle. There is no SQLite service, external CA, or
environment-provided pairing credential. A future multi-instance
deployment may replace this registry with a shared object-store/transactional
backend without changing the route protocol.

Expose this as direct TCP or through an L4 passthrough/NAT. An ordinary L7 TLS
terminator cannot share this port because the Relay itself must receive both
plain HTTP Upgrade requests and TLS `ClientHello` records.

The service-plane connections permit TLS 1.3 only and disable resumption and
early data. Normal invitations, access tokens, health, and control use pinned
TLS. First-time interactive enrollment authenticates its TLS channel by the
human-confirmed symbols described below, then saves the certificate pin. Subsequent
connections send the access token only after verifying that saved pin.

Legacy data-plane connections may remain `ws://` during migration. New data
attachments use pinned WSS. Attachments carry only
opaque inner-TLS bytes and a 256-bit ticket that is delivered over control,
expires after 15 seconds, and is consumed exactly once. The long-lived Relay
access token never enters the plain channel. An active network attacker can
still drop or race an attachment, but gains only the same denial/ciphertext
injection powers already assigned to a compromised Relay; it cannot read data
or reach the Companion API. Exposing the Relay port still requires normal host
firewalling and process supervision.

## Pair one Companion

For macOS, run this on the Relay host:

```sh
codewide-relay
```

Choose **Connect a computer** in the menu. The Ratatui panel displays the public
IP and the running listener's port. In
CodeWide, open **Advanced → Add Relay**, enter that `IP:port`, then click
**Connect**. Check that the same four symbols appear in CodeWide and the Relay panel, then
press **Enter** in that terminal. There is no JSON or key to copy. CodeWide
supplies its computer name as the route label.

The bare command manages the running Relay; it does not bind another listener
or create another identity. `pair` remains a direct shortcut. For foreground
servers use `serve`; old noninteractive service units with explicit `--port`
continue to work. A noninteractive bare invocation reads status.

The window closes after sixty seconds, including the confirmation and
connection steps. The CLI reports success only after the Mac saves its new
configuration and establishes the pinned, authenticated control connection.
**Esc**, **Ctrl+C**, terminal disconnect, or expiration cancels enrollment and
revokes any uncommitted route. A failed attempt restores the Mac's previous
Relay configuration. The Relay does not open enrollment after a restart.

Automatic public IP discovery uses HTTPS to `api.ipify.org`; it cannot discover
an externally remapped port. Supply the reachable endpoint when needed:

```sh
codewide-relay pair --address 203.0.113.10:8780
```

All administration commands use the running daemon's private Unix socket.
On Linux they discover the active `codewide-relay.service` and read its explicit
`--state`. Run the service with `--group-admin` and add authorized operators to
the service's Unix group. They can then run `codewide-relay` directly; the CLI
never prompts for sudo. The state root is group-traversable, the socket is
`0660`, and credential files plus route directories remain `0600`/`0700`.
Membership changes apply after a new login.

A manually managed Relay can be selected with global `--state`. Missing,
outdated, or inaccessible control sockets produce an error instead of creating
a separate registry, certificate, or privilege escalation.

A systemd service with `RestrictAddressFamilies` must allow `AF_UNIX` as well as
`AF_INET` and `AF_INET6`: the private administration socket lives inside the
service's state directory. Preserve other hardening when upgrading an existing
unit. For a unit previously limited to the two IP families, use this drop-in:

```ini
[Service]
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
```

Reload systemd after changing the unit, then restart Relay with its existing
`--state` path. The service owner must retain write access to that directory;
do not expose its control socket or credentials to other users.

Interactive enrollment uses `/relay/enroll` over TLS 1.3 on the existing port.
Only the private local control socket can open the window. Both endpoints
use the TLS exporter `EXPORTER-Channel-Binding` defined by
[RFC 9266](https://www.rfc-editor.org/rfc/rfc9266.html). Before receiving the
server's random nonce, the client commits to its own random nonce and this
channel binding with SHA-256. The server reserves the single candidate before
issuing its challenge and verifies the commitment when the client reveals its
nonce. Each side hashes the binding and both nonces with a separate domain tag
to derive four six-bit symbols from a fixed 64-symbol alphabet. This uses the
commit-before-challenge pattern for short authentication strings discussed in
[RFC 6189 §7](https://www.rfc-editor.org/rfc/rfc6189.html#section-7); it is not an
implementation of the ZRTP protocol. English names accompany the emoji for
terminals without the matching font and for accessibility. Changing the alphabet
or derivation requires a new enrollment wire version.

The wire protocol never supplies the displayed symbols. Credentials are issued only
after the local terminal approves the exact candidate; the certificate from
that same channel becomes the saved pin. The bootstrap verifier is confined to
this enrollment client; existing pinned transports retain their verification.
One candidate, bounded messages, and an absolute deadline limit each attempt.

### Older Companion clients

Create a single-use five-minute invitation from the same running daemon:

```sh
codewide-relay invite
```

The invitation is independent of DNS, IP, NAT, and listen port. It contains no
Companion address and no Relay address. Copy its single JSON line to the
Companion host, then provide the externally reachable Relay address there:

```sh
codewide-companion relay pair 203.0.113.10:8780
# paste the invitation when prompted
```

The address is the Relay's reachable DNS name or `IP:port`, never a Companion
address or an SSH config alias. Include the port explicitly. The
one-line invitation contains the route ID, one-time token, and Relay TLS
certificate pin. Companion verifies the pin before sending the invitation.
The pairing API then consumes the invitation and issues the route-specific
access token. Companion writes the result atomically to
`${XDG_STATE_HOME:-$HOME/.local/state}/codewide/companion/relay.json` with mode
`0600` and immediately starts its outbound adapter through the already-running
process. No Companion restart is required.

Invitation versions 1 through 3 are intentionally rejected because those
experimental contracts coupled enrollment to obsolete transport layouts.
Re-run `invite` and `relay pair` once when upgrading an earlier local Relay
experiment.

Run the normal phone pairing command next:

```sh
codewide-companion pair
```

When Relay pairing exists, the generated link/QR automatically contains:

```text
codewide://pair?v=2&e=wss%3A%2F%2F203.0.113.10%3A8780%2Fv1%2Fsync&...&r=<route-id>&q=<relay-cert-pin>
```

No `CODEWIDE_PUBLIC_ENDPOINT` is required for this path. The link also carries
the Companion identity pin `p`; Android checks the Relay's exact certificate
`q` for the outer WSS and the Companion identity independently for the inner
TLS/mTLS. The carrier opens `/v1/e2ee-bootstrap-tunnel` during pairing and
`/v1/e2ee-tunnel` afterwards, passing `r` in the `x-codewide-relay-route`
header. The route is absent from the URL. Installed clients with version 1
links continue using the old `/c/<route-id>` path until they re-pair.

## Multiple Companions, rotation and revocation

Run `pair` once per Mac, or `invite` for older clients. Each pairing creates a different route and
token. Inspect public route IDs without printing credentials:

```sh
codewide-relay status
codewide-relay status --json
```

The interactive `codewide-relay` menu owns the full paired-computer lifecycle.
Open **Paired computers**, select a row with the arrow keys, press **E** to
rename it, or **D** to revoke it after confirmation. Revocation immediately
closes that computer's active Relay route. The same operations are available
without the terminal UI:

```sh
codewide-relay rename --route <route-id> --label "Office Mac"
codewide-relay revoke --route <route-id>
```

Rotate one Companion while keeping its phone URL stable:

```sh
target/release/codewide-relay invite --route <route-id>
codewide-companion relay pair 203.0.113.10:8780
```

As soon as the running Companion accepts the new pairing, its old adapter is
stopped and the old token and sockets for only that route stop working. No
Companion restart is required. Revoke one route without affecting others:

```sh
codewide-relay revoke --route <route-id>
```

## Rollout and rollback

Deploy the compatible Relay first, then Companion, then the Android APK. An
already-running older Relay must be restarted with the new binary before
`pair` can use its local control socket. Back up its state directory before
upgrading: older binaries may reject route records containing the new computer
label. Existing route IDs, token hashes, and TLS identity are retained during
upgrade. The
new Relay still accepts version 1 phone routes, while a new Companion adapter
needs the Relay's WSS attachment route. A phone must use an APK with native
Relay pin support before claiming a version 2 link.

Canary the new pairing path on one Companion and phone. Existing version 1
phone profiles keep using their route-qualified WS tunnels on the upgraded
Relay. To roll back the new adapter, restore the previous Companion build and
its retained Relay configuration; the Relay still accepts the old attachment
route. Keep the old phone profile until the new WSS profile is verified. Do not
revoke its route while collecting failure evidence.

Before canary:

```sh
cargo test -p codewide-relay --all-targets
cargo test -p codewide-companion relay::tests --lib
cargo clippy -p codewide-relay --all-targets -- -D warnings
cargo clippy -p codewide-companion --lib --bins -- -D warnings
cargo fmt --all -- --check
pnpm test:companion
pnpm validate:android:v1
```

Before making WSS the only accepted phone carrier, additionally verify a deployed phone and Companion across
Relay/Companion restart, process death, sleep/wake, Wi-Fi/mobile handoff,
blackholed networks, slow consumers, 64-stream saturation, route isolation and
connection storms. Record memory per idle stream, throughput, reconnect time
and p50/p95/p99 latency. Removing legacy WS routes is a separate change.
