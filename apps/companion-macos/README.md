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
native client-first panel. Its compact header shows the selected Codex App
Server and reported version; the body is either a centered `No clients` action
or the live client list with revoke. Companion, Relay, and client counts stay in
a narrow overview strip. Relay setup, updates, setup replay, and quit live in
the footer menu instead of permanent diagnostic cards.

On first launch, a native animated setup assistant opens as the application's
only temporary ordinary window. It discovers reachable local Codex App Servers,
shows the version returned by their initialize handshake, and asks the user to
choose when multiple instances exist. Relay has one `Add Relay` path plus
`How to install` and `Skip`; there is no fake local-pairing mode. The final step
shows a QR code and selectable link when Relay is online, or lets the user add a
client later. `Run Setup Again` reopens the flow. Liquid Glass is reserved for
primary actions; layout, fields, selection rows, and backgrounds use native
SwiftUI controls. The palette shares Android's nebula blue (`#1A73F2`),
graphite, and warm-white values.

App Server discovery is deliberately split by layer. Rust probes the private
control endpoint and returns typed candidate/version state through UniFFI; Swift
never opens the endpoint directly. The host inspects the default `~/.codex` and
active `~/.codex-*` profiles, keeps the selected profile visible while offline,
persists a validated selection under Companion state, and restarts the
LaunchAgent before the core binds to a different Codex home.

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
./scripts/release-macos minor --dry-run
./scripts/release-macos minor
```

The command accepts `patch`, `minor`, or `major`. The same choice is available
in GitHub Actions under **macOS Release → Run workflow**. Merging into `main`
does not publish automatically; a release is always an explicit action. The
version is derived from the latest stable `vMAJOR.MINOR.PATCH` tag. Before the
first tag, both the standalone workflow and the combined release-set workflow
use the baseline from `apps/companion-macos/project.json`.

Published DMGs update the `codewide` cask in
`MrFlashAccount/homebrew-codewide`. The cask does not change the ad-hoc signing
boundary: Gatekeeper can still require manual approval on first launch.
