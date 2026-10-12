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

`companion-core` owns the authenticated HTTP shapes, signed release admission,
phase names, fencing rules, and the additive V1 guardian/journal contract. It
does not download, activate, restart, or roll back a host.

The platform guardian is outside the replaceable Companion payload. It alone
owns the fsynced operation journal, immutable generations or application
backup, activation, health proof, rollback, and immutable terminal result.
Linux and macOS guardians consume the same core contract; they must not redefine
API, journal, phase, or result schemas. Core must not import systemd, Sparkle,
AppKit, ServiceManagement, or platform downloaders.

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

Linux status retains the most recent terminal operation in `activeOperation`;
only admission filters out terminal records when checking the single-active
lock. This lets a restarted phone recover the actual outcome. Replaying an
apply idempotency key finds its journal before requiring a fresh release check,
including when the original HTTP acknowledgement was lost.

An additive `progress` field reports download bytes/optional total, verification,
extraction, restart, readiness, reconnect confirmation, and rollback. Progress is
guardian-confirmed and fenced by the operation phase. Android polls the private
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
artifact download requests resolve host names through the host's NSS resolver
(`getent ahosts`), not the static musl resolver: musl keeps the first answer of
all nameservers at once, so on an IPv6-only host one nameserver without DNS64
can hide the only reachable NAT64 addresses of GitHub's IPv4-only release
assets. The stable bootstrap guardian must be
installed manually to receive guardian fixes; remote payload replacement does
not replace bootstrap.

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
- macOS: the Swift guardian and the `trust.json` copied from the signed app
  bundle. The release workflow passes the key to the Rust FFI build and to its
  Nx cache inputs, so a cached archive cannot lose it.

## Baseline and activation gate

The first signed host-update release has no signed predecessor digest and is a
manual baseline. Install it normally on each host. A later release can certify
that baseline digest and become remotely admissible.

The macOS guardian establishes its receipt from the signed manifest that lists
the installed app: the latest release when the app is current, otherwise the
release named by the bundle's `CodeWideReleaseTag` (`release-YYYY-MM-DD.N`,
embedded by `build-app.sh` from `RELEASE_TAG`), falling back to
`v<version>` for apps built before the tag was embedded. A latest release that
is the installed version, or one already accepted, is "up to date", not a
failure. A finished operation stays readable by id but is no longer reported
as the active one.

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
