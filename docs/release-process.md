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
`major`. A release is a dated inventory named `release-YYYY-MM-DD.N` (UTC);
`N` distinguishes multiple releases on one day and skips existing tags and
drafts. Each product has its own semantic version. Changed products increment
their last published version; unchanged products keep their exact files,
versions, signatures and original build provenance. The release date is not a
product version and does not trigger an application update by itself.

The previous published inventory's source revision is the comparison base.
The optional `base` changes only the affected-file comparison. If Nx finds no
affected product, nothing is published. Otherwise, affected Relay, Linux
Companion, macOS and Android builds run **in parallel**. A separate parallel
job downloads unchanged products from their original releases and checks
their sizes and SHA-256 hashes against the previous inventory. The final set
still contains all four products, including `appcast.xml`, so the latest
Sparkle feed remains available even when macOS did not change.
An orchestration-only change can publish a new inventory without rebuilding
unchanged binaries or incrementing their versions. A later standalone product
tag that conflicts with the inventory is rejected rather than silently
downgrading or replacing that product.

Legacy releases have no complete product inventory. The first dated release
therefore builds all four products once, using the latest stable `vX.Y.Z` as
the version baseline. The requested minor transition from `v0.4.0` produces
product versions `0.5.0`. Subsequent releases reuse unchanged products.

Each product workflow runs in validation mode and uploads its artifact to the
parent run. The final job checks the available files, source checksums, and
signed appcast URL, then generates a signed host-update manifest, `SHA256SUMS`, and Markdown
release notes from commit subjects between the common base and the release
commit. It uploads the complete set into a **draft** GitHub Release, downloads
it again to compare every byte, and only then publishes the dated release.
The manifest records each product's `version`, `sourceRevision`, `sourceTag`
and original asset hashes. Reuse across multiple inventories preserves the
original build rather than attributing it to the newest release commit.
Relay and Linux Companion keep individual `.sha256` files for their installers;
the installers retain historical product/combined tags through `0.4.x`.
The Homebrew tap's `releases/<product>/<version>` index resolves
each pinned product version to its original release. Tap generation refuses
to repoint an already indexed version to another origin.
A failed build, missing file, or failed upload leaves no public release. A
failed upload may leave a draft, which the same commit can safely retry.
`dry_run` stops after assembling the validated package and attaches it as a
workflow artifact. OTA remains a separate manual channel.

The signed `release-manifest.json` uses a dedicated P-256 key from the
`HOST_UPDATE_P256_PRIVATE_KEY` release-environment secret. The release job
proves it matches `HOST_UPDATE_P256_PUBLIC_KEY_SPKI`; platform guardians pin
that public SPKI and verify the ES256 signature before considering any
target. The signed payload has a monotonic semantic-version sequence,
issue/expiry timestamps, and exact Linux/macOS build, source revision, artifact
digest, bootstrap/journal requirement, state epoch, and rollback source digest.
The immediately preceding signed manifest is verified with the same key before
its target digests are admitted into `rollbackCompatibleFrom`.

The Linux baseline bundle and macOS application embed only the matching public
SPKI and `HOST_UPDATE_SIGNING_KEY_ID`. Manual baseline installation persists
that immutable trust outside replaceable Companion generations. The private
signing key is available only to release-manifest assembly and is never exposed
to either platform artifact build.

The Linux bundle also carries its release version, the exact full source
revision, and the same 12-character build id used by the signed release target.
The standalone installer accepts that provenance only after verifying the
archive checksum, requires the build id to match the source-revision prefix,
and writes those exact values into immutable generation metadata.

The first signed manifest is deliberately a manual baseline: it has no signed
predecessor digest, so no installed version can remotely apply it. Install that
release through the existing one-shot/manual paths. Remote apply remains
disabled until the Linux and macOS guardians independently satisfy the recovery
gates in [Companion remote update](companion-remote-update.md).

GitHub Release publication is the atomic boundary. Homebrew tap updates run
after publication in one commit for Linux CodeWide, Relay, and macOS; a tap
failure needs a retry and does not roll back the public release. The standalone per-product
commands remain available for exceptional deliveries but do not provide the
combined-release guarantee. Android derives a monotonic `versionCode` from
its own semantic version and leaves the checked-in source version unchanged.

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

macOS runs a cacheable, ARM64-only Core/FFI compilation task before packaging
the app. Its inputs include the transitive Rust graph, generated bindings,
embedded Core version, deployment target, Rust compiler and SDK version.
Linux Companion and Relay persist their Docker Cargo registry, git, and
target directories through GitHub Actions, including a fallback across lock
changes; Cargo remains responsible for invalidation.
The cache is a build accelerator, not a release artifact: Cargo still rebuilds
changed crates and version-embedded binaries, and every delivery still performs
packaging and validation. Completed native builds are saved before installer
or update validation so a later failed gate does not discard compilation work.
Android restores Gradle User Home; macOS restores Cargo, SwiftPM and Nx state.
Signed apps, DMGs, feeds and publication tasks are not compilation-cache outputs.

Core is shared source, not one portable compiled binary: Linux uses musl/x86_64,
macOS uses Darwin/ARM64. Separate platform compilations avoid introducing a
cross-platform prerequisite that would serialize the independent hosts.

Do not mark `release`, signing, update-feed, installation, or publication tasks
as cacheable. A cache hit is valid only when the declared task inputs and outputs
fully describe a deterministic computation.

The workflow uses the official Gradle setup action for Gradle User Home and
build-cache reuse. Nx invokes the existing Android validation and release
commands; it does not replace the Gradle build inside Expo/React Native.

Nx Cloud is not required. It can replace the GitHub-hosted Nx cache later if a
workspace and scoped access token are deliberately configured.

## macOS

Before committing or pushing workflow changes, run the local release
preflight from the current worktree (including uncommitted changes):

```sh
sh scripts/check-release-local
```

It validates workflow syntax, executes the actual macOS `Resolve version`
shell from YAML with representative inputs, and checks planning, fixture
artifact assembly, unchanged-product reuse and Homebrew/installer contracts.
It also parses the macOS Swift source/test tree and compiles/runs the unchanged
`UpdateCheckAdmission` and `RelayAddress` sources with their existing Swift
Testing tests. This includes real macro expansion, so compiler errors in that
portable subset fail locally before a push. Apple SDK owners receive syntax
checking only, not type checking.
The test-only condition waiter is also compiled and tested on Linux, and the
native menu evidence validator rejects missing, failed or malformed contracts.
It does not dispatch GitHub Actions, sign, publish or require a clean/pushed
branch. On first use it downloads and checks the pinned actionlint validator
unless an installed tool or `CODEWIDE_ACTIONLINT_BIN` is provided.

To run only the Swift check:

```sh
sh scripts/check-macos-swift-local
```

The command uses installed Swift (6.2 or newer) or Docker with the digest-pinned
official Swift 6.3.3 Linux image, matching the release runner observed on
2026-09-30. Docker downloads that image on first use; compilation itself runs
without network, with the checkout mounted read-only and ephemeral build output.

This is not evidence of a passed native macOS build or startup smoke.
Those require the macOS runner. In particular, the existing `release-macos
--dry-run` below is a **CI** validation run, not a local dry run.

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
builds the ARM64-only ad-hoc signed app and DMG, downloads and verifies the
previous published macOS app rather than recompiling a synthetic baseline,
then runs a short startup smoke: start that app and its Companion, stop both,
replace the bundle at the same path with the app extracted from the new DMG,
and verify that the new app and Companion report the expected version and are
running. Startup waits are bounded to 30 seconds per version, and shutdown to
10 seconds; the entire smoke step has a three-minute limit. This smoke retains
ordinary state but does not assert migrations, crash recovery or Sparkle
installation. The workflow then publishes the DMG and signed appcast. Existing
unit and runtime contracts remain mandatory. Native menu interactions run
only through the manually invoked fixture script; they are not release or CI
gates. The former 100 ms focus/disclosure checks are not run by Swift Testing.
This intentionally leaves native keyboard-focus behavior unproven; it does not
mark the failing interaction scenario as passed. The startup replacement smoke
and all unit/runtime contracts remain enabled.

Required GitHub `release` environment secrets:

- `SPARKLE_ED25519_PUBLIC_KEY`
- `SPARKLE_ED25519_PRIVATE_KEY`
- `HOST_UPDATE_P256_PRIVATE_KEY` (PKCS#8 PEM; shared release-set manifest signer)
- `HOST_UPDATE_P256_PUBLIC_KEY_SPKI` (base64 DER SPKI; pinned by both guardians)

The optional release-environment variable `HOST_UPDATE_SIGNING_KEY_ID` defaults
to `host-update-v1`. Key rotation changes the variable and both key secrets;
the first release under the new id intentionally ignores the old-key manifest
and becomes another manual baseline.

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
