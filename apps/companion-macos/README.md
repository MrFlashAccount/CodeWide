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

The application currently has no ordinary window. Its menu shows runtime
status, app/core versions, PID and launch count, applied-update information,
the latest lifecycle error, update actions, runtime refresh, and Quit. The
menu-bar icon dims while the runtime is unavailable.

This is a lifecycle and update vertical slice. The current FFI host proves
state migration, health, update checkpointing, and LaunchAgent recovery, but it
does not yet compose the production Companion services. Pairing, device
listing/revocation, online status, and VCS or general plugin management are not
yet exposed in the macOS UI or XPC contract.

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
