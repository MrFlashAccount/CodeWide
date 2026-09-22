# Release process

Nx owns CodeWide's project and task graph. Cargo, SwiftPM, Expo, and Gradle
remain the native build owners; Nx decides which projects are affected, orders
their tasks, and caches deterministic results.

The workspace itself uses TypeScript 7 native. Nx 23 still loads the legacy
TypeScript compiler API for dependency analysis, so the `nx` package receives a
private TypeScript 6 dependency through `pnpm.packageExtensions`; application
and script typechecking continue to use the root TypeScript 7 toolchain.

## Plan affected deliveries

Compare a branch with `origin/main`:

```sh
pnpm release:plan -- --base origin/main --head HEAD
```

Include local tracked and untracked changes:

```sh
pnpm release:plan -- --base origin/main --head HEAD --include-working-tree
```

`scripts/release-plan.ts` asks Nx for affected projects that expose a
non-cacheable `release` target. Product-specific release metadata lives beside
that target in the owning `project.json`; there is no second hand-maintained
dependency graph.

Current target policy:

- shared `companion-core` changes affect both the Linux Companion and macOS;
- Swift/XPC/menu-app-only changes affect macOS only;
- sync contract changes affect both Companion hosts and Android;
- Android JavaScript, native, configuration, and shared-package changes select
  a new APK;
- OTA remains available through `./scripts/release-ota`, but is not selected or
  published by CI;
- documentation-only changes do not publish a product.

The current Relay crate contains both the server and the client/runtime support
used by Companion. Nx therefore conservatively treats Relay source changes as
affecting Companion until those Rust owners are structurally separated.

Pull requests run `.github/workflows/release-plan.yml` and attach the JSON plan.
The planner never publishes by itself.

## Release affected products with one dispatch

Run the `Release Affected Products` workflow and choose `patch`, `minor`, or
`major`. Each product compares the selected revision with its own latest release
tag, so a product skipped by an earlier release remains eligible later. The bump
is applied independently to each selected product; it does not force Relay,
Companion, macOS, and Android to share one version number.

The workflow publishes in dependency order: Relay, Linux Companion, macOS, then
the Android APK. A failed delivery stops later selected deliveries. `dry_run`
executes the same builds and release proofs without tags, GitHub Releases,
Homebrew updates, or appcast publication. OTA is deliberately absent from this
workflow.

When no product tag exists yet, release metadata uses these checked-in
baselines: Relay and Linux Companion `0.1.0`, macOS `0.2.0`, and Android
`0.2.176`.
Afterward, the product tag is authoritative. The Android workflow derives a
monotonic `versionCode` from the semantic version and leaves the checked-in
source version unchanged; the signed APK contains the requested release
version.

The Android release environment requires:

- secrets `ANDROID_RELEASE_KEYSTORE_BASE64`,
  `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, and
  `ANDROID_RELEASE_KEY_PASSWORD`;
- repository variable `CODEWIDE_UPDATE_URL`, pointing to the existing HTTPS
  `/api/updates` endpoint.

The APK is published as a GitHub Release asset. The existing local
`./scripts/release-apk` path still publishes to Build Shelf; the two channels do
not silently impersonate one another.

## Compatibility contract

`release/compatibility.json` is the machine-readable product/interface matrix.
It records protocol versions, not application semantic-version ranges. Current
links cover device sync v1 between either Companion host and Android, plus Relay
pairing v4 between Relay and either Companion host. VCS provider plugins remain
a separate contract and are intentionally not folded into this matrix.

`pnpm release:compatibility` checks that every provider/consumer link has an
intersection and that contract-backed protocol versions match their source JSON.
Every release plan and CI run executes this check. A compatibility-manifest
change affects all linked release products through the Nx graph.

Application versions are therefore operational identifiers; compatibility is
decided by explicit protocol versions and capabilities. A future incompatible
protocol must add a new protocol version and overlap window, not encode a hidden
minimum app version.

## CI and caching

`.github/workflows/ci.yml` uses `nrwl/nx-set-shas` to select only projects
affected since the last successful CI base. Nx caches deterministic task output
and terminal results. GitHub Actions persists separate Linux and macOS Nx caches;
pnpm, Cargo, and Gradle keep their own tool-native caches.

Do not mark `release`, signing, update-feed, installation, or publication tasks
as cacheable. A cache hit is valid only when the declared task inputs and outputs
fully describe a deterministic computation.

The workflow uses the official Gradle setup action for Gradle User Home and
build-cache reuse. Nx invokes the existing Android validation and release
commands; it does not replace the Gradle build inside Expo/React Native.

Nx Cloud is not required. It can replace the GitHub-hosted Nx cache later if a
workspace and scoped access token are deliberately configured.

## macOS

Run a validation-only release from a clean, pushed branch:

```sh
./scripts/release-macos minor --dry-run
```

Publish after the validation succeeds:

```sh
./scripts/release-macos minor
```

The command accepts `patch`, `minor`, or `major`, dispatches the macOS 26 GitHub
runner, and waits for the complete workflow. The workflow refuses to release
when Nx does not select macOS; `--force` is an explicit operator override. It
builds the ad-hoc signed app and DMG, proves a signed Sparkle update from the
baseline app, verifies state migration and LaunchAgent recovery, then publishes
the DMG and signed appcast.

Required GitHub `release` environment secrets:

- `SPARKLE_ED25519_PUBLIC_KEY`
- `SPARKLE_ED25519_PRIVATE_KEY`

There is no Developer ID or notarization step. Sparkle authenticates update
artifacts, while macOS may still warn on the first launch of an ad-hoc-signed
application.

## Other targets

The one-shot delivery owners remain:

- `./scripts/release-relay-linux <version>`
- `./scripts/release-companion-linux <version>`
- `./scripts/release-apk`
- `./scripts/release-ota` for an explicit manual OTA only

`pnpm nx run <project>:release -- <arguments>` delegates to these scripts. Nx
does not reimplement signing, version mutation, publication, or rollback.

## Android OTA activation

The application downloads signed updates in the background and leaves activation to the next
application launch. Foreground polling and returning from the background must never call
`Updates.reloadAsync()`: the live runtime can own an unsaved editor snapshot, a recording, or
the interval between creating a thread and durably admitting its first message. Merely checking
whether a Send promise is pending would leave those other operations unprotected.

This policy starts with the bundle containing it; publishing it does not change the activation
policy of an older runtime that is already running. Download, retry, offline launch and signing
behavior remain unchanged. Durable recovery from an operating-system process kill is a separate
contract; removing automatic reload does not claim to make thread creation and first-message
admission atomic.
