# Companion remote update

Status: shared V1 control and release-trust contracts implemented; remote apply
remains disabled until each platform guardian passes its recovery gates.

## Safety invariant

An update leaves the host running either the previously committed Companion or
the newly verified Companion. A download, install, restart, reconnect, or target
health failure must not leave a partial installation or require pairing the
device again. A short connection interruption is expected. Physical storage or
operating-system failure is outside this guarantee.

Companion application state is never restored from an old snapshot. A release
is remotely admissible only when it declares the same state epoch and exact
installed artifact digest in `rollbackCompatibleFrom`. Otherwise the API
returns `manual_update_required` before accepting an operation.

## Ownership

`codewide-host-update` owns the authenticated shapes, signed release admission,
phase names, fencing rules, and the additive V1 guardian/journal contract. It
also owns one Linux preparation/activation protocol reused by Companion and
Relay.

On Linux the replaceable, unprivileged product owns the whole delivery path. It
admits the signed manifest, downloads and digest-checks the artifact, validates
and extracts the archive, removes installer-only files, verifies the payload,
writes generation metadata, fsyncs the complete generation under
`preparations/<operationId>`, and only then publishes one fixed activation
marker. A stable bootstrap guardian is started by a systemd `.path` unit. It is
network-dark and package-format-blind: it accepts no URL, signature, archive,
caller-selected command, unit, or destination. Its narrow input is the expected
local generation identity plus the previously active identity. It atomically
moves that prepared directory into `generations/`, switches `current`, restarts
the one compiled-in service, proves exact health, and rolls back when needed.
Companion and Relay supply their preparation layout and health proof without
redefining the transaction.

## Device API

The routes exist only on the authenticated private V1 TLS surface:

- `GET /v1/host-update` reads current version, available target, capability,
  and active operation;
- `POST /v1/host-update/check` refreshes the canonical signed release;
- `POST /v1/host-update/apply` accepts `targetFingerprint` and a non-enumerable
  `idempotencyKey`;
- `GET /v1/host-update/operations/{operationId}` reads a durable result;
- `POST /v1/host-update/operations/{operationId}/reconnect` submits the fresh
  post-restart receipt from the initiating device.

Browser `Origin` requests remain rejected. A short-lived authenticated device
session supplies `initiatingDeviceId`; a caller cannot choose the actor. Apply
returns `202`, `operationId`, and `Location` only after the guardian has
persisted and fsynced the full journal record. One operation may be active.
Retries with the same idempotency key return that operation; conflicting reuse
is `409`. Missing operations are `404`, failed preconditions are `412`, and an
active update lock is `423`. An older Companion has no routes and therefore
returns the normal authenticated `404`; clients treat that as unsupported.

## Journal V1

Before HTTP `202`, the guardian durably records:

- random `operationId` and fence `nonce`;
- initiating device id;
- current and target artifact digests and target fingerprint;
- pre-update Relay configured/enabled/live state;
- install, target-ready, reconnect, and rollback deadlines;
- phase and timestamps.

Journal timestamps and deadlines are Unix milliseconds. Signed release
`issuedAt` and `expiresAt` values are Unix seconds.

Phases use compare-and-swap plus the nonce:

```text
accepted -> installing -> targetReady -> awaitingReconnect -> committed
     \           \             \                 \
      +-----------+-------------+-----------------> rollingBack -> rolledBack
                                                        |
                                                        +----------> failed

accepted/installing -> failed (only before activating a replacement)
```

Linux status always reports an in-flight operation in `activeOperation`. It
also retains the most recent terminal operation so a phone that reconnects
after the restart learns the actual outcome, but only while that outcome is
current:

- it is at most one hour old by its journal `updatedAt` (several times the
  12-minute rollback deadline);
- it still describes the installed generation: `committed` while the target
  digest is installed, `rolledBack` while the pre-update digest is installed,
  and `failed` while either of the operation's two digests is installed (a
  failed rollback may leave the target linked).

An expired or superseded outcome, for example after a manual reinstall, and a
pointer whose operation record is missing or undecodable are hidden at once.
Status then removes `active.json` under a non-blocking attempt on the guardian
lock, after confirming the pointer still names the same operation, so it never
deletes a pointer written by a newer apply; a contended lock defers removal to
the next status read. The operation stays readable by id. Admission ignores
terminal records when checking the single-active lock. Replaying an apply
idempotency key finds its journal before requiring a fresh release check,
including when the original HTTP acknowledgement was lost.

On macOS a terminal outcome stays in status for one hour, then is read by
operation id.

An additive `progress` field reports download bytes/optional total, verification,
extraction, restart, readiness, reconnect confirmation, and rollback. Progress is
fenced by the operation phase. Android polls the private
HTTP operation independently of WebSocket/App Server health, bounds the entire
request (native origin, credentials, HTTP and body), and retains the terminal
failure across older status responses that omit it. While Companion restarts,
the phone explicitly shows the last confirmed stage and waits for a fresh
response; it does not claim that cached progress is live.

Failures before activation do not restart the previous Companion or begin a
rollback. A recovery failure retains the original install error and a separate
recovery code. Linux process health uses the authenticated control-only
`GET /v1/host-update/health`: the serving process attests its own immutable
generation, PID, readiness and Relay state. The guardian compares the PID with
systemd and every release identity field with the expected generation; it does
not depend on access to another process's `/proc` entry. Legacy payloads retain
the previous exact executable check. Release manifest, artifact size and
artifact download requests are made only by the unprivileged product and
resolve host names through the host's NSS resolver
(`getent ahosts`), not the static musl resolver: musl keeps the first answer of
all nameservers at once, so on an IPv6-only host one nameserver without DNS64
can hide the only reachable NAT64 addresses of GitHub's IPv4-only release
assets. `codewide-host-resolver` (`crates/host-resolver`) owns this lookup. On
Linux it runs `getent ahosts`, keeps NSS order, and falls back to the built-in
resolver only when `getent` is missing; IP literals skip the lookup, and other
platforms use the system resolver without spawning a process. The Companion's
Relay connections use the same resolver: the control channel, Relay update
requests, invitation pairing and terminal-confirmed enrollment try the
resolved addresses in order within their connect budget. Archive validation, extraction and payload-layout validation also stay
in that replaceable product. The stable bootstrap guardian knows only the fixed
prepared-generation path, generation metadata, fixed service, health contract,
and rollback pointer. It must be installed manually to receive guardian fixes;
remote payload replacement does not replace bootstrap. It is activated only by
`activation-request.json`; the product never invokes `systemctl`.

Once rollback begins, late target-ready and reconnect receipts cannot commit.
Reconnect commits only for the recorded device, operation id and nonce, after
the recorded restart start and before the reconnect deadline. Terminal results
are immutable and remain readable after a guardian or Companion crash. A
rollback that cannot restore and prove the previous Companion records
`rollingBack -> failed` through the same fenced compare-and-swap path.

The frozen machine-readable contract is
`crates/host-update/contract/host-update-v1.json`. Contract negotiation is
additive: a runtime that does not exactly support guardian, bootstrap, and
journal V1 must return `manual_update_required` before `202`.

## Release trust

`release-manifest.json` is an ES256 envelope. Its payload is authenticated by a
dedicated P-256 release key pinned by platform guardians, not by a public key in
the downloaded envelope. The signed stable descriptor carries a monotonic
sequence, issue/expiry time, and exact platform, semantic version, build,
source revision, HTTPS artifact URL, SHA-256 digest, bootstrap/journal version,
state epoch, and rollback-compatible source digests.

The release builder rejects unsigned or invalid predecessor manifests. It uses
only the immediately preceding signed target digest for rollback certification.
Guardians retain the highest admitted sequence and reject stale, replayed,
downgrade, wrong-platform, wrong-digest, arbitrary-URL, unsupported-contract,
state-epoch, and rollback-incompatible targets.
Descriptors are valid for at most 180 days. Guardians pin both the P-256 public
key and its stable key id. Rotating that key requires shipping a new trust
anchor through a manual baseline first; a downloaded descriptor cannot rotate
its own trust anchor.

## Embedded release trust

Every Companion platform and the Relay embed the release signing key id and
P-256 public key at build time: `crates/host-update/build.rs` reads
`CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID` and
`CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI` and exposes them as
`ReleaseTrust::embedded()`. No
installer-written file supplies trust, so an install path cannot silently
disable updates by omitting it.

A build made without the key reports `unofficial_build` and never admits a
remote update; Android shows it as an unofficial build without installer advice.
An official build still needs its installed guardian, otherwise it reports
`manual_bootstrap_required`:

- Linux: the bootstrap guardian and a signed generation layout under the install
  root. `bootstrap/config.json` is no longer read for trust.
- macOS: no external guardian; the runtime verifies the manifest with the key
  the release workflow passes to the Rust FFI build and its Nx cache inputs,
  so a cached archive cannot lose it, and the menu app installs with Sparkle.

## Baseline and activation gate

The first signed host-update release has no signed predecessor digest and is a
manual baseline. Install it normally on each host. A later release can certify
that baseline digest and become remotely admissible.

macOS deliberately departs from the safety invariant above: Sparkle installs
the bundle atomically but cannot roll back a release that installs and then
fails to serve devices. The runtime therefore neither tracks the installed
artifact digest nor requires `rollbackCompatibleFrom`; it admits the single
newer `macos-universal` target with the same state epoch, journal version and
a bootstrap version of at most 2. See
[macos-companion.md](macos-companion.md#updates-and-state).

Shipping these core routes does not enable apply. Each platform must first ship
an external guardian and prove power/process interruption recovery, exact target
version/build/revision/digest, Companion readiness, preserved pairing identity,
restored Relay connectivity, bounded rollback, and durable error reporting.
Until then `applySupported` is false and apply returns
`manual_update_required`.

Android self-update and a global compatibility dashboard are outside this
contract. The Relay runs the same Linux guardian from `codewide-host-update`
with its own payload and health proof; the Companion proxies it at
`/v1/relay-update` with the
same authorization: a device session or the admin token, never a browser
`Origin`.
