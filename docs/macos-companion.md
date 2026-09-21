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
  Mach/XPC service to the menu app. There is no CLI, local HTTP listener, or
  Unix socket in the macOS bundle.
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

Sparkle 2.10.0 checks and downloads updates automatically. Both the appcast and
archive are protected by Sparkle Ed25519 signatures. Before installation, the
app asks the runtime over XPC to atomically persist an update checkpoint and
exit successfully. On the first launch of the new helper, `companion-core`
migrates state, preserves a schema-versioned backup, and reports app, host, core,
schema, PID, launch count, and update result.

The release workflow builds an ad-hoc universal bundle on macOS 26, generates a
signed appcast, then performs a real Sparkle update from a baseline bundle. It
requires the new app, LaunchAgent, and core versions to come up with preserved
state. It then sends `SIGKILL` to the runtime and requires launchd to return a
new PID and higher launch count before publishing.

There is no implicit binary downgrade. A failed feed signature or download
leaves the old app running. A failed pre-install checkpoint stalls installation.
A bad published build is recovered with a newer signed build number.

## Build

Required release secrets:

- `SPARKLE_ED25519_PUBLIC_KEY`
- `SPARKLE_ED25519_PRIVATE_KEY`

Local macOS 26 build:

```sh
export CODEWIDE_SPARKLE_PUBLIC_KEY='...'
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
