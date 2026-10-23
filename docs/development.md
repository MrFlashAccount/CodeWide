# Developing CodeWide

Repository layout, validation commands, local development loops and the
release path. User-facing setup lives in [self-hosting.md](self-hosting.md).

## Architecture

The Android client talks to the companion over the `/v1` sync protocol. The
companion talks to coding agents only through its agent provider layer: the
neutral core (`crates/agent-core`: provider trait, model mirror, usage
accounting), the versioned `codewide-agent` protocol
(`packages/agent-protocol`), declared capabilities and one crate per
provider. Codex (`crates/agent-provider-codex`, the in-process App Server
adapter with its storage) and Claude (`crates/agent-provider-claude`: a Rust
adapter that drives the user's own `claude` CLI over its stream-json
protocol) are equal providers, and every thread is bound to one provider for
its life. Claude history is read from Claude's own session
store, so sessions started with `claude` in a terminal appear next to
CodeWide's threads. In phase 1 the client keeps its Codex-shaped wire; the
companion projects neutral events to it in one place and the client hides
features a thread's provider does not declare. See [docs/agent-providers.md](agent-providers.md).

## Commands

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm bench:fixtures
pnpm test:e2e
pnpm security:scan-artifacts
pnpm security:scan-secrets
pnpm --filter @codewide/android build
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p codewide-companion -- --help
```

`pnpm security:scan-secrets` runs pinned Gitleaks against both reachable Git
history and the tracked/untracked non-ignored working tree. The verified binary
is cached outside the repository; set `CODEWIDE_GITLEAKS_BIN` to use an existing
installation instead.

Run the UI in a browser during renderer development:

```sh
pnpm --filter @codewide/android web
```

For Android JS/TS Fast Refresh, install the debug APK once. Keep Metro on the
workstation loopback and provide an operator-owned HTTPS endpoint through
`CODEWIDE_METRO_URL`; the phone then needs neither USB nor ADB and may use any
network:

```sh
pnpm dev:android
```

The debug application id is `dev.codexremote.app.dev`, so it can remain
installed beside the signed release app. Open the `codewide://` URL printed
by the helper once; subsequent JS/TS edits arrive through Fast Refresh. Metro
signs its development manifest with the local OTA key
(`CODEWIDE_OTA_PRIVATE_KEY`, default `codewide/ota/private-key.pem` in the user
data directory; only the public certificate is checked in). On Linux it also needs a sufficiently large
inotify budget (`fs.inotify.max_user_watches=524288` and
`fs.inotify.max_user_instances=1024`).

The `dev.codexremote.app` package identity and related legacy storage, service,
and deep-link aliases are retained intentionally. They let existing installs
upgrade to CodeWide without losing local state or breaking saved links.

Production Android releases are native APKs only: there is no production OTA
publishing. Any production change reaches phones through a new APK published by CI.
The separate Preview package is the sole exception: its local release-candidate
one-shot publishes a signed OTA baseline beside its APK on the candidate origin.

## Update and Metro endpoints

The in-app Expo Updates client is retained but inert: an APK built without
`CODEWIDE_UPDATE_URL` has no update endpoint, and CI does not set one. A build
may still opt in explicitly:

```sh
export CODEWIDE_UPDATE_URL=https://updates.example.com/api/updates
```

Wireless development similarly requires an operator-owned HTTPS Metro endpoint
through `CODEWIDE_METRO_URL`; the repository has no default public tunnel.

## Releases

Release builds never fall back to the debug signing key. Signed APKs are
published only by CI: the `Release Affected Products` workflow, or the
`Android APK Release` workflow on its own, builds the APK and uploads it to a
GitHub Release. Both call the same build command, which can also run locally:

```sh
./scripts/build-android-apk --version X.Y.Z --version-code N
```

It discovers the private signing material, applies the requested version,
version code and native runtime to the native sources for the duration of the
build, runs the release checks, builds, verifies and scans the signed arm64
APK, restores the checked-in versions, and prints the result as JSON. Without
`--version` it uses the next patch version; without `--version-code` it
increments the checked-in version code. It never publishes the APK.

For a standalone test build that can be installed beside production and the
Metro-backed debug app, build the Preview variant:

```sh
./scripts/build-android-apk --preview [--version-code N]
```

Preview uses the package `dev.codexremote.app.preview`, the label
`CodeWide Preview`, and a fixed visible version `0.0.0.0`. Android orders its
upgrades only by `versionCode`; by default the command derives a monotonic code
from seconds since 2026-01-01, while `--version-code` allows an explicit higher
value. Preview is a bundled, optimized, offline-capable build. Direct Preview
builds have updates disabled unless `CODEWIDE_UPDATE_URL` is explicitly supplied;
the release-candidate one-shot always supplies its zrok-backed `/api/updates`
endpoint and publishes a signed baseline for the same native runtime. Preview
intentionally uses its own stable development key because it is a separate
non-production application. The one-shot command creates that key
once under the user's CodeWide data directory and reuses it so later APKs
upgrade the installed Preview. Production signing material is not read or
passed to its Gradle build.

The local release-candidate environment has exactly three operator-facing
one-shots. Run the first two in this order for a complete local test release:

```sh
./scripts/release-candidate-companion
./scripts/release-candidate-android
```

The first command validates, builds, atomically replaces and verifies the
running Companion. The second runs the complete Preview APK gate, publishes a
signed Expo update for that exact native runtime, and then publishes the APK,
checksum, manifest and static page to the same zrok-backed origin. It verifies
the public update manifest, launch asset, settled no-update directive, APK
manifest and APK hash before succeeding. Do not reconstruct either sequence
from its lower-level commands.

After that baseline exists, a JavaScript-, TypeScript- or bundled-asset-only
change can be published to its existing native runtime with:

```sh
./scripts/release-candidate-android-ota
```

The OTA one-shot runs the Android release gates, reads the runtime from the
published Preview manifest, signs and publishes the bundle, updates the public
candidate manifest and verifies the public endpoint. Native Android, native
dependency, update-certificate or native application-configuration changes
must use `release-candidate-android` with a new version code instead. Do not
reconstruct the OTA sequence from its lower-level commands.

The low-level Gradle/signing variables below remain available for debugging or
nonstandard builds:

```sh
set -lx CODEWIDE_RELEASE_STORE_FILE /absolute/path/to/release.keystore
set -lx CODEWIDE_RELEASE_STORE_PASSWORD '...'
set -lx CODEWIDE_RELEASE_KEY_ALIAS codex-remote-v1
set -lx CODEWIDE_RELEASE_KEY_PASSWORD '...'
```

The Android project also contains a `:baselineprofile` Macrobenchmark module.
It generates a real startup/ART profile from an API 33+ connected device and
compares cold startup with no compilation against the required profile. Normal
release builds do not silently launch instrumentation; generate and then build
explicitly:

```sh
pnpm android:gradle -- :app:generateReleaseBaselineProfile
pnpm android:gradle -- :baselineprofile:connectedBenchmarkReleaseAndroidTest
pnpm android:gradle -- :app:assembleRelease
```

The wrapper uses explicit `JAVA_HOME` / `ANDROID_HOME` when provided and falls
back to the repository's known Gradle-managed JDK and Android SDK locations.
This keeps CLI builds deterministic even when `java` is not exported in the
interactive shell.

Generation on an emulator is useful for correctness. Treat benchmark numbers as
release evidence only when captured on physical mid-range hardware.

Run the release/device evidence gate against one explicitly selected ADB target:

```sh
pnpm test:android-device -- \
  --serial emulator-5554 \
  --apk apps/android/android/app/build/outputs/apk/release/app-release.apk \
  --suite smoke,lifecycle,layout \
  --expected-server-count 4 \
  --capture-screenshot
```

An AVD can be paired without a camera or a token in shell history. Write the
five-minute one-time payload to a private file, then pass only its path:

```sh
mkdir -p test-results/private-runtime/android
chmod 700 test-results/private-runtime/android
set -lx CODEWIDE_PUBLIC_ENDPOINT wss://10.0.2.2:8766/v1/sync
set -lx CODEWIDE_SERVER_NAME 'AVD test server'
codewide-companion pair --json \
  > test-results/private-runtime/android/pairing.json
chmod 600 test-results/private-runtime/android/pairing.json
pnpm test:android-device -- \
  --serial emulator-5554 \
  --apk apps/android/android/app/build/outputs/apk/release/app-release.apk \
  --pairing-file test-results/private-runtime/android/pairing.json
```

The runner accepts only a mode-`0600`, unexpired pairing payload with shell-safe
automation fields. It never writes the one-time token or resulting capability
into evidence.

The runner installs with `adb install -r`, exercises sleep/wake, forced Doze,
App Standby and process recreation, checks the real accessibility geometry for
`server rail -> threads -> thread` and `Menu -> wide input -> voice -> send`,
and writes a mode-`0600` evidence bundle under ignored `test-results/`. An
upgrade run additionally requires `--suite upgrade --previous-apk <old.apk>` and
fails if the package UID or first-install identity changes.

CodeWide uses one Android application and the Companion `/v1` API. The former V2
frontend, protocol, native modules, and generation-parity runner are removed; see
[the retirement and UI reuse audit](android-v2-retirement.md).

Use `pnpm validate:android:v1` and `pnpm --filter @codewide/android compile:android`
for source validation. `pnpm test:android-device -- --dry-run` shows the retained
smoke, lifecycle and layout plan. Select a device with `--serial` and an APK with
`--apk`; upgrade coverage additionally uses `--suite upgrade --previous-apk`. Source checks are
not device evidence. The retired two-generation Appium runner no longer certifies
releases; no replacement live-conversation E2E coverage is claimed.
