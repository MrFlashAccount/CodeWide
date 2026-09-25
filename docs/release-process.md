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
`major`. The latest stable `vX.Y.Z` tag is the common comparison base and
version authority. If Nx finds no affected product, the workflow publishes
nothing. Otherwise, it builds **all four products at the same version** from
the same commit: Relay, Linux Companion, macOS, then Android. Building all four
keeps the `releases/latest/download/appcast.xml` feed present on every release.
The optional `base` changes the comparison range, but never the version base.
The parent workflow overrides each product's affected-only guard so all four
ship together; build, signing, installer, and update checks still run in full.

Each product workflow runs in validation mode and uploads its artifact to the
parent run. The final job checks the available files, source checksums, and
signed appcast URL, then generates a manifest, `SHA256SUMS`, and Markdown
release notes from commit subjects between the common base and the release
commit. It uploads the complete set into a **draft** GitHub Release, downloads
it again to compare every byte, and only then publishes one `vX.Y.Z` release.
Relay and Linux Companion keep individual `.sha256` files for their installers;
the installers use the combined tag from `0.4.1` onward and keep older product
tags for pinned historical versions.
A failed build, missing file, or failed upload leaves no public release. A
failed upload may leave a draft, which the same commit can safely retry.
`dry_run` stops after assembling the validated package and attaches it as a
workflow artifact. OTA remains a separate manual channel.

GitHub Release publication is the atomic boundary. Homebrew tap updates run
after publication in one commit for Linux CodeWide, Relay, and macOS; a tap
failure needs a retry and does not roll back the public release. The standalone per-product
commands remain available for exceptional deliveries but do not provide the
combined-release guarantee. For the first combined release, the existing
`v0.4.0` tag is the common version base; the initial fallback is the checked-in
macOS baseline. Android derives a monotonic `versionCode` from the shared
semantic version and leaves the checked-in source version unchanged.

Before publication, each release workflow runs `sh scripts/update-homebrew-tap.test.sh`
to check tap generation, the Linux formula rename, and Relay's versioned URL.

The Android release environment requires:

- secrets `ANDROID_RELEASE_KEYSTORE_BASE64`,
  `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, and
  `ANDROID_RELEASE_KEY_PASSWORD`;
- optional repository variable `CODEWIDE_UPDATE_URL`, pointing to an HTTPS
  `/api/updates` endpoint. When it is absent, the APK is built with Expo Updates
  disabled and does not perform update checks.

The APK is published as an asset of the combined GitHub Release. The existing local
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

Release workflows do not run cacheable Nx build tasks, so they do not restore
an Nx task cache. The Linux Companion and Relay workflows instead persist their
Docker Cargo registry, git, and target directories through GitHub Actions.
The cache is a build accelerator, not a release artifact: Cargo still rebuilds
changed crates and version-embedded binaries, and every delivery still performs
packaging and validation. Android restores Gradle User Home; macOS restores
Cargo and SwiftPM state.

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
