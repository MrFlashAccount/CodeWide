# Native macOS Companion host

The macOS delivery is a native SwiftUI menu-bar application for macOS 26 and
newer. It does not bundle or launch the Linux CLI.

## Runtime boundary

- `companion-core` owns the shared Rust runtime and domain modules.
- `companion-core::runtime_host` owns the transport-neutral runtime health and
  update-checkpoint values used by platform hosts.
- `companion-swift-ffi` is the narrow UniFFI/static-library adapter used by the
  Swift runtime host.
- `CodeWide.app` registers a Swift LaunchAgent with `SMAppService.agent`.
- The LaunchAgent hosts `companion-core` in-process and exposes only a typed
  Mach/XPC management service to the menu app. There is no CLI, fixed local
  management HTTP listener, or Unix socket in the macOS bundle.
- The device data plane listens on `0.0.0.0:8767` for direct WSS connections.
  Its public router exposes only the bootstrap and device TLS tunnels, never
  app-management endpoints. The native port is separate from the Linux CLI's
  default port 8766, allowing a local SSH forward to that service to coexist.
- Two random loopback TLS listeners serve as private targets of the direct
  tunnels and optional outbound Relay adapter. Bootstrap requires the one-time
  pairing proof; normal traffic requires registered-device mTLS. They are never
  advertised as localhost APIs.
- The Linux executable imports `companion-core` directly. Its pre-existing
  CLI-to-running-daemon control socket remains a compatibility surface; it is
  not a host-to-core boundary and this slice adds no new Linux IPC.

The LaunchAgent uses `KeepAlive.SuccessfulExit = false`: a crash or signal is
restarted, while the clean exit requested before an update is not. The next
XPC connection demand-starts the runtime from the replaced application bundle.

## Ad-hoc trust model

The app and runtime are ad-hoc signed. Both directions use the macOS 26
`NSXPCConnection.setCodeSigningRequirement` check for the expected signing
identifier. The runtime additionally accepts only a same-UID client whose
validly signed executable is inside the same application bundle. The app
connects to the launchd-owned Mach service and validates the ad-hoc signed
runtime executable inside its own bundle.

This prevents accidental cross-process access and service-name squatting in the
registered launchd job, but it is not equivalent to Developer ID identity. A
same-user attacker who can modify and re-sign the application bundle can replace
both peers. Distribution is not notarized, so Gatekeeper may warn on first
launch.

## Updates and state

Sparkle 2.10.0 silently checks for update information when the menu opens, at
most once per hour. An available version adds a dot to More Actions and an
Install item; checking or installing manually opens the standard Sparkle UI.
The app does not automatically install local checks. No-update results and
cancellation do not appear as errors or reconnect a healthy runtime. Both the
appcast and archive are protected by Sparkle Ed25519 signatures.

Phone-confirmed updates use a separate guardian transaction. The first signed
app installs an immutable V1 executable and trust record outside the payload:

- `~/Library/Application Support/CodeWide/Updater/bootstrap-v1/` contains the
  guardian executable, pinned P-256 release key and canonical app location;
- `~/Library/Application Support/CodeWide/Updater/v1/` contains the private
  request spool, guardian-owned journal, terminal outcomes and runtime
  observations;
- `~/Library/LaunchAgents/dev.codewide.update-guardian.plist` keeps the
  guardian available after an app crash, logout or login.

The payload never replaces bootstrap code or trust. If bootstrap is missing,
partial, moved, not private/user-owned, or contract-incompatible, remote apply
stays disabled with `manual_bootstrap_required`. A capability receipt is
published only after the guardian verifies signed release metadata, downloads
the current release DMG, checks its SHA-256 and code signature, mounts it
read-only, and proves its deterministic bundle tree equals the installed app.
The tree digest includes normalized relative NFC paths, entry kind, symlink
target, POSIX mode and regular-file bytes. It excludes the bundle root name,
filesystem inode/timestamps/owner/group, extended attributes and quarantine.
Unreadable or unsupported entries fail closed.

Before acknowledging apply, the guardian checks target freshness, exact
rollback digest and state epoch, live runtime/upstream/Relay prerequisites, and
performs a real reversible sibling rename probe. It then fsyncs context,
journal and idempotency records. The guardian copies and fsyncs an exact
same-filesystem sibling `.app` snapshot before asking the canonical LSUIElement
app to run the exact-target Sparkle flow. Sparkle remains the only forward
installer. A custom `SPUUserDriver` chooses Install only when the selected
version/build and Sparkle signature status match the phone-confirmed target;
neither the menu app nor Sparkle owns the rollback snapshot.
The runtime exits through a guardian-specific XPC stop that does not write the
legacy `pending_update`/`last_update` checkpoint, so those fields remain local
manual-Sparkle diagnostics and never compete with the guardian journal.

After relaunch, the guardian verifies the installed code signature, exact
version/build/source revision/tree, running core and upstream, unchanged
identity and device registry, and Relay recovery when Relay was live before the
update. Commit requires a fresh reconnect receipt from the initiating device
for that operation. The registry proof canonicalizes device order and excludes
only `lastSeenAt` plus unclaimed pairing challenges, which legitimately change
during reconnect; device ids, names, credential hashes, public keys, creation
times and any future stable fields remain protected. The durable `committed`
journal transition precedes idempotent receipt publication, so a crash cannot
overwrite the rollback receipt while the operation is still rollback-eligible.
Install, launch, health, Relay or reconnect timeout enters
rollback. Rollback fences the app/runtime and waits for Sparkle/installer bundle
ownership to end, atomically restores the sibling snapshot, fsyncs its parent,
launches that exact URL, re-registers the runtime, and verifies old runtime,
upstream, identity and Relay health before recording `rolledBack`. Late
receipts cannot commit after rollback starts. Only the application bundle is
restored: Companion state, keys, devices, Relay configuration and Codex
selection are never rolled back. Terminal results survive app and guardian
restart and remain readable by the restored app.

The existing manual Sparkle button remains a local Sparkle operation. It still
uses the runtime checkpoint, but it is intentionally not represented as a
guardian-owned remote transaction and does not rely on undocumented Sparkle
backup retention.

The release workflow builds an ad-hoc universal bundle on macOS 26, generates a
signed appcast, then performs a real Sparkle update from a disposable baseline
bundle with automatic installation enabled only for that CI test. It
requires the new app, LaunchAgent, and core versions to come up with preserved
state. It then sends `SIGKILL` to the runtime and requires launchd to return a
new PID and higher launch count before publishing.

`CFBundleVersion` is derived from the stable semantic release version through a
fixed migration epoch. It never depends on a GitHub workflow run number, so a
release started by the product release-set workflow cannot sort below a release
started directly from the macOS workflow. The generated appcast must contain
that exact build version before publication.

## Menu workflows

On first launch, the app presents one temporary native setup window with two
steps: Codex App Server selection and direct client pairing. Client pairing can
be deferred; a reachable App Server is required because it is the Companion's upstream. The
flow can be reopened later from the menu bar. Its persisted completion marker
controls presentation only; every readiness state comes from the live runtime.

The setup window uses native Liquid Glass buttons for step navigation and
actions, grouped in `GlassEffectContainer`. Content uses the system window
background and a native group box; QR codes retain an opaque white background.
The window is resizable and its content scrolls independently of navigation.
System appearance and glass accessibility adaptations remain native, and the
step transition respects Reduce Motion.

Add Client opens a one-time QR link directly. The address picker lists currently
assigned IPv4 addresses, with LAN interfaces before VPN interfaces. Select an
address reachable from the client, such as the Mac's Wi-Fi address on the same
network. `0.0.0.0` is a listening address and never appears in the QR. Network
changes refresh the available addresses; a stale address cannot produce a new
link. The connection still requires routing/firewall reachability to the Mac;
binding all interfaces does not create a NAT port forward.

The QR contains the Companion's existing SPKI identity pin. Android accepts the
direct server's self-signed outer TLS certificate only when that pin matches.
CA-trusted ingress endpoints retain platform certificate and hostname checking.
The independent inner pinned TLS and registered-device mTLS checks still apply.
Android clients need the native direct-TLS change; updating JavaScript alone
does not update this trust behavior.

The LaunchAgent discovers the default `~/.codex` plus local `~/.codex-*`
profiles that own a live App Server control endpoint. Rust performs the bounded
initialize handshake and reports the actual App Server version through UniFFI;
Swift receives only typed candidates over signed XPC. Selecting another profile
atomically persists its validated Codex home, exits the helper unsuccessfully,
and lets launchd restart a fresh core against that upstream while retaining the
same Companion state directory.

The menu-bar panel exposes these workflows over signed XPC:

- Launch at Login is enabled by default on first launch and remains directly
  controllable from the actions menu; macOS Login Items remains the authority;
- selected App Server, its live connection and version, plus compact Companion
  state and recovery failures;
- direct device pairing as a native QR code containing the selected Mac WSS
  endpoint, one-time token, Companion TLS pin, and identity expiry;
- paired device inventory with active sync-connection count, durable last-seen
  time, and immediate revoke.

Existing Relay configuration and enable/disable controls remain under Advanced.
Relay is not part of setup or a prerequisite for Add Client. The shared core's
Relay adapter remains compatible with existing saved routes. New address-only
pairing requires a Relay build with `codewide-relay pair`: run it on the Relay
host, enter its displayed address in Add Relay, check the four symbols on both
screens, and press Enter in the Relay terminal. The sixty-second window includes
confirmation and connection. Closing the Mac dialog cancels the attempt; a
failed attempt preserves the previous Relay configuration. No invitation JSON
or credentials cross the macOS presentation/XPC status boundary.

Online is not inferred from a recent timestamp. It is owned by scoped leases on
actual sync WebSockets; the final disconnect updates durable last-seen
state. Revoke removes authorization, closes subscribed live transports, and
purges device-owned transient runtime state.

There is no implicit user-requested downgrade. A remote transaction may restore
only its exact guardian-certified predecessor bundle; unrelated downgrade and
state restoration remain forbidden.

## Build

Required release secrets:

- `SPARKLE_ED25519_PUBLIC_KEY`
- `SPARKLE_ED25519_PRIVATE_KEY`
- `HOST_UPDATE_P256_PUBLIC_KEY_SPKI`
- `HOST_UPDATE_KEY_ID`

Local macOS 26 build:

```sh
export CODEWIDE_SPARKLE_PUBLIC_KEY='...'
export CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI='...'
export CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID='...'
apps/companion-macos/scripts/generate-swift-bindings.sh
apps/companion-macos/scripts/build-app.sh
apps/companion-macos/scripts/build-dmg.sh 0.1.0
```

## Plugins are still two separate decisions

The existing VCS provider contract (Git/Arc executables using framed JSON-RPC)
is not a general Companion plugin API. This slice does not expose either one in
the menu app. Product work must first decide whether “plugin” means selecting a
VCS provider or introducing a new arbitrary Companion extension contract; the
two must not share a configuration surface by accident.
