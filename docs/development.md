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
adapter plus its Node child, the Claude agent host in `host/`, over the
user's own `claude` CLI) are equal providers, and every thread is bound to
one provider for its life. Claude history is read from Claude's own session
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

Serve every locally available Android APK from a compact build shelf with a
stable latest-build marker and resumable byte-range downloads:

```sh
python3 scripts/build-shelf-server.py --host 127.0.0.1 --port 4190
```

The shelf scans Gradle APK outputs and archived test builds on every request.
While it is running, each new `release/app-release.apk` is also copied once into
`builds/android/`, with its version metadata and SHA-256, so rebuilding does not
erase the recent download history. The archive keeps the eight newest APKs and
their metadata. `/latest.apk` always resolves to the highest release version
code; `/api/builds` exposes the current catalog; `/healthz` is the lightweight
tunnel probe.

Run the logical multi-server recovery soak (24 hours by default):

```sh
pnpm soak:sync
```

It writes a private mode-`0600` progress/result artifact under
`test-results/soak/`. This exercises replay, network drops and JS runtime
recreation; it does not replace the physical Android Doze/device gate.

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
signs its development manifest with the same local OTA key. On Linux it also needs a sufficiently large
inotify budget (`fs.inotify.max_user_watches=524288` and
`fs.inotify.max_user_instances=1024`).

The `dev.codexremote.app` package identity and related legacy storage, service,
and deep-link aliases are retained intentionally. They let existing installs
upgrade to CodeWide without losing local state or breaking saved links.

For the signed release app, publish JS/TS, message-renderer, and asset changes
without rebuilding or reinstalling the APK:

```sh
./scripts/release-ota
```

The one-shot command discovers the private OTA key and public update endpoint,
runs the Android release checks, publishes atomically, verifies the public
manifest and bundle hash, and prints the update ID as JSON. Use `--dry-run` to
validate release configuration without publishing.

The build shelf serves the signed Expo Updates protocol at `/api/updates`.
A release app checks once when its UI opens and at most once every 30 minutes
while it remains active, downloads a new compatible bundle, and immediately
recreates its JS runtime with that bundle. The Android process does not need to
be force-stopped; transient UI state may be reset. The signing key defaults to
the user data directory under `codewide/ota/private-key.pem` and can be
overridden with `CODEWIDE_OTA_PRIVATE_KEY`. Only the public certificate is
checked in.

Changes to Kotlin, the Android manifest, native libraries, or native dependency
versions still require a new APK and a new `runtimeVersion`; the updater rejects
bundles built for a different native runtime.

## Update and Metro endpoints

Set the Android build's update endpoint explicitly:

```sh
export CODEWIDE_UPDATE_URL=https://updates.example.com/api/updates
```

Wireless development similarly requires an operator-owned HTTPS Metro endpoint
through `CODEWIDE_METRO_URL`; the repository has no default public tunnel.

## Releases

Release builds never fall back to the debug signing key. The normal release path
is one command:

```sh
./scripts/release-apk
```

It discovers the private signing material, increments the patch version,
version code and native runtime together, runs the release checks, builds and
verifies the signed arm64 APK, publishes it to the build shelf, downloads it
through the public endpoint, verifies its SHA-256, and prints the release data
as JSON. Source versions roll back if the build fails before publication. Use
`--dry-run` to inspect the next version and validate credentials without
changing files or publishing. `--version X.Y.Z` overrides the automatic patch
version while the version code still increments by one.

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
