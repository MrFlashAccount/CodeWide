# CodeWide Companion for macOS

`companion-macos` is the native macOS 26+ delivery of the CodeWide Companion.
It is a menu-bar application with a separately managed Swift LaunchAgent.

## Runtime boundary

```text
CodeWide menu app -> authenticated XPC -> Swift LaunchAgent
                                      -> UniFFI/static library
                                      -> companion-core
```

The LaunchAgent imports the Rust core in-process. The application bundle does
not contain the Linux CLI and does not expose a local HTTP listener or Unix
control socket.

## Owns

- the SwiftUI `MenuBarExtra` application;
- LaunchAgent registration and lifecycle through `SMAppService`;
- the signed XPC protocol and peer validation between the app and helper;
- the Swift side of the narrow UniFFI adapter;
- Sparkle update orchestration and the update-recovery proof;
- application bundle and DMG construction.

Shared Companion behavior and durable domain state belong in
`crates/companion-core`. FFI conversion belongs in
`crates/companion-swift-ffi`.

## Layout

- `Sources/CodeWide`: menu application;
- `Sources/CodeWideRuntime`: LaunchAgent executable;
- `Sources/CodeWideShared`: XPC values and protocols shared by both processes;
- `Sources/CompanionSwiftFFI`: generated Swift bindings;
- `Resources`: application and LaunchAgent property lists;
- `scripts`: binding generation, bundle construction, DMG creation, boundary
  validation, and update E2E.

## Current menu and capability boundary

The application has no ordinary window. Clicking the menu-bar icon opens a
native panel with Companion health, live Relay reachability, Relay invitation
setup and enable/disable control, QR device pairing, paired devices, exact live
connection presence, durable last-seen time, and revoke. Update and quit actions
live in the panel footer.

On first launch, a native animated setup assistant opens as the application's
only temporary ordinary window. It verifies the local LaunchAgent, offers an
optional Relay connection, waits for the first device pairing, and can be
skipped completely. Its completion marker controls presentation only: live
step status always comes from the runtime. `Run Setup Again` in the menu-bar
panel reopens the flow. The assistant uses the native macOS 26 Liquid Glass
APIs and the canonical CodeWide accent (`#5878FF`), graphite, warm-white, and
C/W mark assets; reduced-motion and system appearance remain authoritative.

The Swift LaunchAgent composes the production Companion services in-process
through `companion-core`. Menu management uses only authenticated typed XPC.
The Rust data plane owns two random loopback TLS listeners used exclusively by
the outbound Relay adapter: bootstrap is token-and-signature protected and the
normal device path requires registered-device mTLS. There is no fixed local
management HTTP port, CLI, or Unix control socket in the application bundle.

VCS-provider selection and a general arbitrary plugin system remain explicitly
out of scope; they are separate contracts and are not represented by one
placeholder UI.

## Build and validation

The deployment target and build runner are macOS 26. Generate bindings and
validate architectural boundaries with:

```sh
apps/companion-macos/scripts/generate-swift-bindings.sh
apps/companion-macos/scripts/validate-boundaries.sh
```

Builds are ad-hoc signed and not notarized. Sparkle authenticates update
artifacts with the repository-managed Ed25519 key; it does not replace
Gatekeeper or Developer ID notarization.

The repository-owned release entrypoint is:

```sh
./scripts/release-macos <version> --dry-run
```

Published DMGs update the `codewide` cask in
`MrFlashAccount/homebrew-codewide`. The cask does not change the ad-hoc signing
boundary: Gatekeeper can still require manual approval on first launch.
