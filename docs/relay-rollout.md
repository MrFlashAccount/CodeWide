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
codewide-relay --port 8780
```

The installer downloads from `relay-v<version>`, verifies the release SHA-256,
checks the binary-reported version, and atomically installs it to
`${CODEWIDE_RELAY_INSTALL_DIR:-$HOME/.local/bin}`. It accepts `--version` for a
pinned older release. Publishing the GitHub Release remains a separate approved
operation.

The binary binds `0.0.0.0:<port>`; the default port is `8780`. Durable state
lives under `${XDG_STATE_HOME:-$HOME/.local/state}/codewide/relay/`:

```text
registry.lock
transport-cert.der
transport-key.der
routes/<route-id>
invitations/<invitation-hash>
```

Directories use mode `0700`; files use `0600`; route updates are atomic and
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
early data. Invitations, access tokens, health, and control messages exist only
inside pinned TLS. The access token is sent only after the certificate pin is
verified.

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

Create a single-use five-minute invitation on the Relay host:

```sh
target/release/codewide-relay invite
```

The invitation is independent of DNS, IP, NAT, and listen port. It contains no
Companion address and no Relay address. Copy its single JSON line to the
Companion host, then provide the externally reachable Relay address there:

```sh
codewide-companion relay pair 203.0.113.10:8780
# paste the invitation when prompted
```

The address is the Relay's public `IP:port`, never a Companion address. The
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

Run `invite` once per Companion. Each invocation creates a different route and
token. Inspect public route IDs without printing credentials:

```sh
target/release/codewide-relay status
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
target/release/codewide-relay revoke --route <route-id>
```

## Rollout and rollback

Deploy the compatible Relay first, then Companion, then the Android APK. The
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
