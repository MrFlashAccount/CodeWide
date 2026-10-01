# macOS end-to-end validation

Scope: the native menu app and its Swift LaunchAgent, in-process Companion core,
local Codex App Server and directly paired CodeWide client. Relay is optional. The native app
is a Companion host, not a second chat frontend.

## Completion criteria

A build alone is insufficient. Preserve separate evidence for each gate:

| Gate | Required proof |
| --- | --- |
| Build | Pinned Rust toolchain, generated UniFFI contract, Swift 6 compilation, architecture checks, signed application bundle |
| First launch | Registration and Login Items approval, retry without relaunch, actionable registration errors |
| App Server | Discovery and actual version handshake, unavailable installation recovery, profile selection with no stale replies |
| Direct client | All-interface listener, reachable Mac address in the QR, one-time pairing, authenticated connection, device inventory and revoke |
| Recovery | No unanswered XPC request hangs forever, concurrent refreshes coalesce, old refreshes cannot overwrite a selected server, service restart and reconnect |
| Update | Valid signed Sparkle feed, durable checkpoint, new app/helper/core versions, preserved pairing and state, helper crash recovery |
| UI | Real first-run and menu flows on macOS; offline/expired/error states remain actionable |

## Automated checks

`CodeWideTests` exercises the production client state owner through injected XPC
and service-registration boundaries. It does not register a LaunchAgent.
`XPCReplyGateTests` covers cancellation, missing/late replies and exactly-once
completion. `CompanionSwiftFFITests` links the real Rust core and exercises
private temporary state, lock ownership, unavailable upstream, update checkpoint
and reopen. An anonymous XPC listener also exercises the actual secure codecs,
Swift RuntimeService and Rust CoreHost together. These tests do not register a
service, write installed update-health markers or use the user's Companion state.
They are not a substitute for the installed app/client gate.

The regression checks cover:

- approval and registration recovery without restarting the menu app;
- failed discovery not being reported as an empty successful scan;
- Relay input rejecting missing or invalid ports before XPC, accepting explicit
  default ports and IPv6, and preserving safe error details through the core;
- real Relay TLS rejecting an invitation for another certificate without
  consuming it, and rejecting a reused invitation without disrupting an
  already-connected adapter;
- asynchronous unregistration before registering a changed helper, preserving
  user approval and avoiding service restarts for an unchanged healthy build;
- one bounded registration retry after an unconfirmed new build's XPC transport
  fails, without retrying ordinary management errors or bypassing peer validation;
- a fingerprint read from actual signed Mach-O files, changing when the bundle
  moves or the helper is rebuilt without a version bump, while idle copies on
  disk do not affect the active registration;
- cancelled, dropped and late XPC replies;
- actionable Swift and Rust error messages surviving XPC serialization;
- management errors clearing obsolete online state;
- stale refreshes after server selection, Relay changes, device revocation or
  an update checkpoint;
- Sparkle's no-update and cancelled/deferred-install outcomes staying out of
  the error banner, actual update failures remaining visible, clearing stale
  failures after a successful check, and avoiding runtime recovery unless an
  installation actually paused it;
- external rollout changes through symlinked paths, including archived sessions
  on macOS, where FSEvents reports resolved paths;
- real macOS TCP listener discovery, process ownership and working-directory
  lookup through the system `lsof`, instead of Linux-only `ss` and `/proc`;
- a single 32 MiB App Server frame and a subsequent request over that connection.

The large-frame fixture writes a serialized WebSocket frame directly. This avoids
the test sender's repeated `Vec::drain` copying with macOS's small Unix socket
buffer. The receiver, frame size and 10-second deadline remain unchanged.

Setup regenerates the pairing link when the selected network address changes,
rejects stale asynchronous replies, offers a new-link action, and distinguishes
a registered client from an active connection. These
views still require the installed UI gate below.

`crates/companion-core/tests/direct_access.rs` starts the production managed
runtime on a wildcard address in an isolated profile. It checks the public
router's lack of management APIs, real TLS/WebSocket bootstrap, a signed
one-time enrollment, device mTLS, authenticated sync, token replay rejection and
revocation. No Relay participates in that flow.

`DirectCompanionTlsTest` runs the production Android pin verifier against a
self-signed TLS server: the QR's matching SPKI succeeds, a different identity
and absence of a pin fail. This is a JVM transport test, not an Android device
or APK test.

From a configured macOS developer environment:

```sh
apps/companion-macos/scripts/validate-boundaries.sh
ffi_archive=$(apps/companion-macos/scripts/build-rust-ffi.sh)
CODEWIDE_FFI_ARCHIVE="$ffi_archive" swift test --package-path apps/companion-macos
```

Native menu interaction fixtures are **manual-only**, not CI, Nx test or release
gates. The keyboard-navigation-on focus scenario still fails on the macOS
runner; its focus setup is unresolved. Disabling the automatic gate is not proof
that keyboard focus works correctly. Swift Testing retains synchronous geometry
contracts, not the former focus/disclosure tests with fixed 100 ms waits.

To investigate disclosure, native menu tracking, focus or close/resize ordering:

```sh
python3 apps/companion-macos/scripts/test-menu-bar.py
```

This fixture runs `NSApplication.run()`, waits for observable results and reports
the failed stage, window height, key ownership and responder type. It does not
write system preferences or use the installed app's services/state.

The developer must first accept the Xcode license. Cargo and rustc must both use
the version pinned in `rust-toolchain.toml`; a directly installed older rustc
earlier in PATH can defeat selection of Cargo alone.

The release dry-run is separate: `./scripts/release-macos patch --dry-run`
dispatches a GitHub Actions workflow and requires a clean, already-pushed branch.
It is not a local build command; run it only after authorization for the remote
workflow.

## Installed app and release smoke

Use a disposable macOS account or the existing macOS release runner for
`sh apps/companion-macos/scripts/update-smoke.sh <previous-app> <new-dmg> <new-version>`.
It requires `CODEWIDE_ALLOW_ISOLATED_MACOS_SMOKE=1`, uses the account's
production-named LaunchAgent, and refuses an existing Companion state directory
or running LaunchAgent. It starts the previous app, stops app and helper, replaces
the disposable bundle from the new DMG, and checks new app/helper/core versions
and running processes. It does not test Sparkle installation, state migration or
recovery after a crash. It must not run against an account with a real installation.

In that isolated account, collect proof in this order:

1. Start the packaged application, complete background-service approval, and
   select the test App Server.
2. Pair a disposable direct client; create/read a test task and observe the
   response on the client. Verify client online state then revoke access.
3. Interrupt the test connections and restart the test helper. Confirm the UI
   recovers and a request succeeds without restarting the menu app.
4. In a separate fresh disposable account, run the release smoke and verify
   that the previous and replacement app/helper/core start with matching versions.
5. Retain sanitized results only. Do not publish device identities, pairing
   invitations, private keys or user conversation data.

## Current local verification

Starting revision: `d8a86f22bfe698c0b154ff0606a7c493ce0cfeb3`.

- Architecture/plist/build-version checks pass.
- `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo fmt --all -- --check` pass.
- `pnpm test:companion`: 505 passed, zero failed, two opt-in tests ignored.
- The opt-in isolated enrollment test also passed with Codex CLI 0.157.0. It
  starts a real stdio App Server in a private temporary profile and checks that
  the synthetic main profile's credentials remain unchanged. The live-account
  test that creates real tasks and runs model turns was not executed.
- All 29 Swift tests pass against the final universal Rust archive on ARM64,
  including actual XPC serialization, service/core integration and durable
  checkpoint/reopen. The generated UniFFI bindings match the checked-in contract.
- Both release executables (`CodeWide` and `CodeWideRuntime`) build for ARM64 and
  Intel. `lipo` confirms both architectures; `vtool` confirms a macOS 26.0 minimum
  for every slice. Xcode 27 emits an Intel/macOS 27 deprecation warning during
  the build, but the emitted executables target 26.0. Execution on an Intel Mac
  remains unverified.
- The repository's local `build-app.sh` subsequently produced an ad-hoc signed
  universal application bundle: version 0.4.0, local build 100005.6, with the
  Rust core rebuilt as 0.4.0. `codesign --verify --deep --strict` passes, including
  the embedded runtime and Sparkle components. Both packaged executables contain
  ARM64 and Intel slices targeting macOS 26.0. The artifact is at
  `apps/companion-macos/.build/install/CodeWide.app`; this does not establish an
  installed launch or a notarized release.
- Local build 100005.6 is installed in `/Applications/CodeWide.app`. Its signature
  is valid, and the runtime checkpoint and identity files were preserved. The
  previous application and a full private state backup are retained locally.
- The first manual launch used a build-folder app while the previously registered
  helper belonged to a different bundle. Peer validation correctly rejects that
  pair. An app must register its own helper; other copies merely existing on disk
  must not prevent startup. The old discovery UI also incorrectly claimed that
  no App Server was found when helper communication failed.
- The first installation attempt exposed a separate update defect: launchd kept
  the old registration and rejected the changed executable with `Launch Constraint
  Violation`, then `EX_CONFIG`. The attempt rolled back. The fixed app now tracks
  bundle location, version, code signatures and agent plist; it awaits asynchronous
  unregistration before re-registering a changed build and records success only
  after authenticated XPC health succeeds. After the user's launch of build
  100005.4, launchd reports the helper running with one start and no exits. The
  persisted healthy-registration fingerprint exactly matches this installed
  bundle's path, build number, app/helper code hashes and agent plist. This
  verifies that the app received and accepted its helper's XPC health response.
- Replacing the running 100005.4 helper with 100005.5 reproduced a remaining
  first-registration failure: AMFI rejected the spawn constraint even after
  asynchronous unregistration. Registering the same unchanged executable again
  succeeded. Build 100005.6 now permits one automatic re-registration after an
  unconfirmed build's XPC transport fails. A real update from running 100005.5
  to 100005.6 recovered without a manual menu-app relaunch. The final app's
  authenticated health fingerprint matches the installed bundle, launchd reports
  its helper running, and the core launch count is 6. No signing requirement was
  relaxed. The OS-internal source of the stale spawn constraint is not proved;
  see Apple's [description of the same constraint failure](https://developer.apple.com/forums/thread/795022).
- The installed helper listens on `0.0.0.0:8767`. Port 8766 is occupied by an
  existing SSH forward and was left intact. Real loopback TLS validates the
  preserved Companion certificate; the bootstrap tunnel upgrades with HTTP 101,
  while public health/device/pairing/sync management paths return HTTP 404.
- LAN access is blocked at the host's network filter: TLS to the Mac's Wi-Fi
  address ends with EOF and the kernel records `CFM_OP_DROP`. macOS reports
  "blocking all non-essential incoming connections". Firewall changes await
  explicit user approval; the firewall has not been changed. Binding all
  interfaces is verified, but reachability from a phone is not.
- `pnpm validate:android:v1` passes, as does the Android/Hermes bundle export.
  Five pairs of TS/TSX module names previously differed only by case, causing
  wrong imports on macOS. Presentation files and their references were renamed
  without moving ownership or changing behavior. Existing lint-debt keys moved
  with those files; no baseline counts or allowances increased.
- The Android self-signed TLS test passes on JDK 17 with the unchanged production
  `PinnedTls.kt`, the exact extracted Relay value type, OkHttp 4.12.0 and the
  bundled Kotlin JVM compiler. The ordinary Gradle attempt was cancelled during
  a slow plugin download. Android SDK command-line tools and JDK 17 are installed,
  but SDK platform installation awaits license acceptance. No native APK was
  built or installed; existing Android binaries need the native trust change.
- Actual phone pairing, a user-visible model response, Intel execution and the
  signed Sparkle update gate remain unverified.
- Local build 100005.7 aligns update discovery with Doma: a silent menu-open
  probe, an available-version badge, and explicit installation. The
  `SUNoUpdateError` completion no longer creates a red "You're up to date!"
  banner or resumes a runtime that was not paused. All 34 Swift tests pass,
  including five new update tests covering ten cases. The universal
  bundle passes strict signature verification and is installed. Authenticated
  XPC health confirms the new helper, with core launch count 7 and the direct
  listener preserved. Visual interaction with the new menu is not verified;
  the native Computer Use limitation below still applies.
- Local build 100005.8 replaces the setup's large glass content cards with
  native glass step/action buttons, system content surfaces and a resizable,
  scrollable window. Relay address and invitation errors now explain invalid
  input, certificate mismatch and rejected invitations without echoing tokens.
  All 506 Rust tests and 36 Swift tests pass; two opt-in Rust tests remain
  ignored. Clippy, format checks, boundary validation, universal compilation
  and strict bundle signature verification pass. The installed helper has
  authenticated health, core launch count 8 and the direct listener intact.
  The live remote Relay returns HTTPS health 204. The supplied invitation's
  certificate belongs to the login user's state directory, while the service
  uses a separate directory and a different certificate. Pairing to that
  remote Relay awaits a fresh invitation from the service's state; creating it
  requires interactive sudo. No remote configuration was changed, and neither
  native UI interaction nor remote pairing is recorded as a passed E2E gate.
  Concurrent menu redesign continued after this build and test run; those later
  uncommitted edits are not covered by the build 100005.8 validation record.
- Local build 100005.9 installs the compact menu redesign. The empty menu is
  360 × 312 points, with one QR action, contextual device actions, and expandable
  connection details. Permission, helper, Codex and network failures have distinct
  guidance; stale device activity is not presented as a live connection. All
  44 Swift tests pass. Twenty native SwiftUI fixture renders cover ten states in
  light and dark appearances, including long device names, a scrolling list,
  pending actions and expanded details. Both app executables are universal and
  strict bundle signature verification passes. The installed helper has
  authenticated XPC health, core launch count 9, and the direct listener remains
  at `0.0.0.0:8767`. Loopback TLS and the bootstrap WebSocket upgrade pass. The
  existing host firewall still blocks LAN TLS. Identity and runtime state were
  preserved during installation. Offscreen renders are not native interaction
  tests; popover clicks and phone pairing remain unverified.
- Local build 100005.10 adopts native Liquid Glass controls throughout the menu
  and setup/dialog navigation, and replaces Setup with two focused steps. The
  root agent instructions now preserve this macOS design rule. Six new tests
  cover setup recovery decisions and stale/expired pairing; all 50 Swift tests
  pass in an isolated copy of the validated 100005.9 runtime plus the UI changes.
  This avoids incorporating concurrent, unfinished Relay enrollment changes.
  Both executables are universal and strict bundle signature verification passes.
  The locally installed update preserved identity and runtime state.
  Post-install authenticated XPC health matches this bundle; its helper has core
  launch count 10 and the direct listener and loopback TLS remain healthy. Thirty
  layout-only exports cover fifteen states in both appearances; Vision decodes
  the test QR in each theme. Export adapters substitute unsupported native glass,
  menu and scrolling surfaces, so these images do not verify actual glass
  composition, native interaction or window behavior.
- Local build 100005.11 corrects opaque backgrounds and primary-color glass
  tinting, disables animated menu disclosure resizing and anchors it at the top.
  Setup now exposes Relay configuration and explicit Direct/Relay pairing.
  Transport changes invalidate the previous QR. All 55 Swift tests pass,
  including the actual XPC transport argument and Relay-only pairing decisions.
  Thirty-eight layout-only exports cover nineteen states; native material and
  second-click dismissal remain unverified. Both executables are universal and
  strict signature validation passes. The installed helper has authenticated
  health matching this build, core launch count 11, and listens on
  `0.0.0.0:8767`. Loopback TLS and bootstrap upgrade pass. The existing firewall
  still blocks LAN TLS; no external-device or Relay E2E pass is claimed.
  Installation preserved identities and runtime state. The validated runtime
  baseline is retained; concurrent enrollment protocol work was not overwritten.
- Local build 100005.13 replaces the transparent custom Setup shell with a
  standard titled window and native navigation sidebar. Its three steps are
  This Mac, Relay and Your phone, with an explicit direct-connection option on
  the Relay step. Native `NSPopover` now owns menu framing and dismissal. The
  full 63-test Swift suite passes, including AppKit window geometry and menu
  sizing tests. Both executables are universal and signature verification passes.
  The installed helper is byte-identical to 100005.12, preserves the new Relay
  enrollment implementation, and reports authenticated health matching the new
  bundle (launch count 13). Identities and runtime state were preserved.
  Loopback TLS and bootstrap upgrade pass; unchanged firewall policy still
  blocks LAN TLS. Native interaction and glass appearance remain unverified.
- Local build 100005.14 fixes a reproduced menu-anchor regression: when a status
  item is parked offscreen, resizing an `NSPopover` can move it to the screen
  edge. The menu now uses a nonactivating `NSPanel` with native
  `NSGlassEffectView`, retaining the last visible screen anchor as content grows
  downward. Mouse opening clears incidental control focus; keyboard opening
  retains normal focus navigation. Native action-menu tracking, Escape and
  outside-click dismissal are handled explicitly.
  Setup retains This Mac → Relay → Your phone, reduces its default window to
  680×480 points, uses native radio selection for profiles, removes oversized
  content cards and puts the phone instructions beside the QR code.
  All 68 Swift tests pass. The separate AppKit event-loop harness
  (`python3 apps/companion-macos/scripts/test-menu-bar.py`) also passes its ten
  checks, including native menu tracking, key ownership, Cmd-N, outside clicks
  and disclosure after the anchor disappears. This harness uses fixture views;
  it is not Computer Use of the installed app or proof of glass appearance.
  Both installed executables are universal; strict signature verification passes.
  The helper is byte-identical to 100005.13 and reports authenticated health
  matching the installed build, launch count 14, listening on `0.0.0.0:8767`.
  Loopback TLS and bootstrap upgrade pass. Identity and runtime state are
  preserved; the existing firewall still blocks LAN TLS.
- Local build 100005.15 makes the first Setup step explicitly about Codex:
  Codex → Relay → Your phone. After discovery succeeds, an already connected
  single profile advances to Relay without an extra confirmation. Returning to
  Codex disables this automatic advance for the current Setup session. Multiple
  profiles retain a native picker; one available but unselected profile has an
  explicit Connect Codex action. A selected single profile shows Codex readiness,
  its version, and optional connection details instead of a Default/Connected
  radio row. Discovery, errors, permission recovery and profile changes block
  automatic navigation; the transport choice remains explicit.
  All 72 Swift tests and boundary checks pass. Both installed executables are
  universal and strict bundle signature verification passes. The helper is
  byte-identical to 100005.14; authenticated health matches 100005.15, launch
  count 15, with the listener on `0.0.0.0:8767`. Loopback TLS and bootstrap
  upgrade pass, and identity/runtime state are preserved. LAN TLS remains
  blocked by the existing firewall policy. Native view bitmap exports were
  attempted for six Codex states in both appearances, but omitted the SwiftUI
  content; those exports are unusable and do not count as visual validation.
  Installed Computer Use and native glass appearance remain unverified.
- Local build 100005.16 removes the square chrome visible around the rounded
  menu glass. The cause was the borderless transparent `NSPanel` still asking
  AppKit for a rectangular window shadow while `NSGlassEffectView` drew its own
  22-point rounded surface. The panel now has no separate window shadow or
  focus ring; native glass remains the sole outer surface. The connection row
  is now `Codex` / `Connected` instead of `This Mac` / `Codex connected`.
  The AppKit event-loop harness passes eleven checks, including the explicit
  transparent-window, rounded-glass and no-square-chrome invariant. The combined
  build also includes Relay-first pairing and direct-interface filtering from
  the concurrent macOS work. All 74 Swift tests pass; the core's 371 tests and
  direct TLS/WebSocket pairing gate pass. The installed UI and helper are
  byte-identical to the validated universal bundle and its strict signature is
  valid. Authenticated helper health matches 100005.16, the helper is still on
  its first run with no recorded exit, and loopback TLS plus the bootstrap
  WebSocket upgrade pass. Installed visual appearance remains unverified because
  native Computer Use is unavailable in this session.
- The requested Computer Use pass is blocked before the first native UI action:
  the current automation session exposes only the in-app browser, and selecting
  CodeWide returns `cua.getApp is not a function`. This is not a successful UI
  test. Enable native Computer Use before recording automated first-launch, menu
  or recovery results. The user's Companion database and paired devices have
  not been reset.

- No remote release workflow was dispatched during this local pass. The release
  dry-run requires a clean, pushed branch and separate authorization.
