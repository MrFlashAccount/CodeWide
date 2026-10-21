# CodeWide agent instructions

## React callbacks

- Use `apps/android/src/react/useEvent.ts` for UI event handlers such as `onPress`, `onChange`, `onChangeText`, and `onDismiss`, and whenever a callback identity otherwise escapes render: a custom hook returns it, a context or imperative handle exposes it, or an effect, subscription, timer, native API, or retained controller invokes it later. It provides stable identity while always calling the latest implementation.
- Keep render callbacks and render-local helpers as ordinary functions; React Compiler owns their memoization. Do not use `useEvent` for `renderItem`, render props, functional `style`, Reanimated/worklet callbacks, or any callback whose changing identity is an intentional signal.
- Do not use `useCallback` or `useMemo` in V1. React Compiler owns render memoization. Retained callbacks use `useEvent`; stateful identities belong to an explicit state, ref, resource or model owner. Do not use `useEffectEvent` directly as a general stabilization mechanism.

## React data loading

- Never start data fetching or hydration from `useEffect` or `useLayoutEffect`. This prohibition includes network requests, SQLite reads, filesystem reads, native-bridge reads, query hydration, and promise creation whose purpose is to load render data. An effect-triggered fetch necessarily starts after commit and creates an avoidable empty or stale commit followed by another render.
- Components obtain asynchronous render data from a stable model-owned Legend resource during render. Navigation-critical resources expose their cached Promise through `useSelector(resource$, { suspense: true })`, which delegates to `React.use`; progressive or streaming surfaces may instead read the resource's Legend-owned `{ status, value, error }` snapshot so already-published data stays visible. Never create a fresh Promise on every render or mirror the resource into component-local loading/data state.
- The Promise cache may live in a dedicated global Legend State store or in an equivalent model-owned resource cache. Legend State owns the live resolved state; the resource layer owns Promise identity, request deduplication, invalidation, cancellation, and error state. Do not add component-local `useQuery` or parallel loading state merely to coordinate the same resource.
- Choose the loading boundary according to the interaction:
  - Navigation should preload the complete atomic destination resource and reveal the new screen in a Transition. Keep the previous screen visible until the destination snapshot is ready; do not commit a blank intermediate destination.
  - Lazy or incremental loading should use a stable range/resource key and the smallest local Suspense boundary, or explicit intent/viewport preloading. Preserve the currently visible data and anchor while the adjacent range loads.
  - Background refreshes and WebSocket/native events update the global model outside React effects and publish resolved changes to Legend State atomically. When React-owned navigation, range, or Promise-selection state changes, schedule that state change in a Transition; do not assume that merely wrapping an external-store mutation makes it deferred.
- Effects remain valid only for synchronizing with external systems after commit: subscriptions, timers, native listeners, imperative handles, and cleanup/retention. They must not be used as a data-loading scheduler. If retention is required, prefer hiding it behind the store subscription lifecycle rather than coupling it to a component fetch effect.

## Frequently changing interaction state

- Keep frequently changing interaction state that React needs in a stable owner-held Legend State observable, whether one or several components consume it. Pass the observable owner through a narrow context or typed props when needed, and subscribe with `useSelector` only where a value is rendered. Do not mirror the same state into component-local React state or force a parent to rerender on every update.
- Keep raw gesture coordinates and animation progress that change each frame in Reanimated shared values on the UI thread. Publish semantic transitions such as armed, opened, cancelled, and settled to Legend State when React UI needs them; do not bridge every animation frame through JavaScript or Legend State.
- Keep the gesture and its Legend State projection under the feature that owns the interaction. The context or props carry the stable owner, not a copied snapshot.

## Asynchronous progress UI

- Do not replace stable or optimistically updated user-facing text with progress words such as `Updating…`, `Refreshing…`, or `Saving…`. Keep the actual value and render that same text with the existing shimmer treatment while confirmation is pending, so its geometry does not change.
- Text shimmer is the default progress treatment wherever meaningful text is available. Use a spinner only when shimmer cannot represent the pending state, and only after the user has explicitly approved that exception.
- On failure, stop the shimmer, restore or reconcile the authoritative value, and expose the real error through the owning interaction instead of leaving a progress label behind.

## macOS interface

- Liquid Glass is the default design language across the menu, Setup and dialogs. Use native SwiftUI `glass`, `glassProminent`, `glassEffect` and `GlassEffectContainer` APIs for controls and navigation; do not approximate glass with hand-drawn gradients, blur or borders.
- Do not place an opaque `windowBackgroundColor` over a glass window or use `tint(.primary)` to make secondary glass controls neutral: in dark appearance it produces a bright opaque tint. Let regular glass use its untinted appearance and keep semantic color on the label.
- Keep one prominent action per screen. Use regular glass for secondary controls, and group neighboring glass controls in a `GlassEffectContainer`.
- Let native windows, popovers and navigation sidebars own their chrome and glass. Do not wrap a titled window's entire content in another rounded `glassEffect`, make its titlebar transparent by hand, or draw a duplicate app header over system window controls. Use a native sidebar for Setup steps.
- Keep content readable and QR codes on an opaque white surface with a quiet zone. Glass must not distort a QR code, invitation text or error details.
- Respect Reduce Transparency, Increase Contrast and Reduce Motion. Preserve native keyboard focus, accessibility labels and meaningful pending labels.
- Menu-bar managers can move a status-item window offscreen while its menu is open. Keep the last visible screen anchor when content resizes; never follow an offscreen anchor. Test repeated disclosure, native action-menu tracking and mouse-versus-keyboard focus using a running AppKit event loop, not only static view measurements.
- Verify changed screens in both appearances, including unavailable, pending, empty and populated states. Fixture rendering is visual evidence, not a passed native interaction test.

## Android V1 feature boundary

- The selected V1 ownership contract and implemented source tree are in [docs/android-v1-feature-architecture.md](docs/android-v1-feature-architecture.md); exact owner moves, lifetimes and migration gates are in [docs/android-v1-feature-migration.md](docs/android-v1-feature-migration.md). Read [apps/android/src/CONTEXT.md](apps/android/src/CONTEXT.md) and the nearest local ownership contract before a V1 source move. M0–M8 source migration is implemented; the migration ledger records completed automated checks and unverified device scenarios.
- Run `pnpm validate:android:v1` before handing off any change under `app/legacy.tsx` or the V1-owned `apps/android/src/**` surface. It applies the shared hygiene preset to the complete V1 graph, rejects hygiene regressions above the checked-in debt baseline, checks formatting, public API JSDoc, import and `StyleSheet` layout, dead exports, unresolved platform seams, cycles, and V1 dependency boundaries. Do not update the hygiene baseline to admit a new violation; reduce it as touched code becomes compliant.
- V1 main-chat selection preserves immediate destination publication, cached content/local skeleton and progressive transcript hydration; header/composer must not wait for complete history, and composer restoration precedes editing. V1 subagent selection retains its existing Transition. This specific V1 contract qualifies the generic atomic-navigation guidance above; do not change navigation behavior during ownership extraction.
- Preserve existing V1 JS module-evaluation startup separately from the boot-controlled native resource handle. Feature extraction must not add JS disposal to native stop or feature unmount. Existing source/schema/platform authorities remain unchanged.

## Android router and retired V2 frontend

- Android exposes only V1. `app/_layout.tsx` owns framework/security providers, a `Slot`, and the V1 diagnostics HUD; it must not wrap the workspace in another native stack. `app/+not-found.tsx` displays recovery while replacing unknown URLs with `/`. `app/(workspace)/index.tsx` owns `/`; `/legacy`, `/pair`, and `/thread` redirect there; the V1 process deep-link owner handles the original pairing and notification URLs.
- `AppFullscreenOverlayHost` is the single application owner of fullscreen presentation, but every logical overlay entry owns a separate `AppFullscreenModal` native window. Keep earlier entries mounted beneath later windows. Never render a newer fullscreen entry as a React `zIndex`/`elevation` layer inside an older modal, and never dismiss or suspend an owning sheet merely to reveal it: native sheets, dialogs, and fullscreen surfaces must be ordered by Android's window stack.
- Fullscreen Back is top-window-first. Closing an overlay entry removes that entry and its descendants; it must not remount the surviving parent workspace. Keep the source-contract and render regression coverage in `fullscreen-sheet-contract.test.ts` and `v1-fullscreen-back.render.test.tsx` when changing modal ownership.
- Main and subagent conversations consume `useThreadChatWindow` through the same `projectThreadChatWindow` sealed/live projection. Do not add a second row-materialization path for read-only or nested conversations: the mutable active head and immutable history must keep one merge contract.
- `app/(workspace)/_layout.tsx` owns the serialized native runtime handle in `src/boot/runtimeSlot.ts`. The workspace route group does not contribute a URL segment. `src/routeComposition/**` owns navigation helpers outside Expo route discovery; `app/**` contains only screens and layouts. There is no generation preference, generation switch, V2 runtime, or V2 route group.
- `src/presentation/**` retains components with live V1 consumers. Do not restore a second UI tree or add all presentation files as Knip entrypoints to suppress dead code.
- CodeWide has one Companion API at `/v1`, one sync-client entrypoint, and one Android runtime. The former V2 protocol, client, native modules, and parity harness are removed. Keep the unrelated external Codex App Server generated V2 protocol and persisted compatibility identifiers.
- Run `pnpm validate:android:v1` for Android changes and `pnpm --filter @codewide/android compile:android` when validating the application bundle. Run `pnpm test:companion`, Cargo Clippy, and Cargo format checks for backend changes.
- The retirement scope and UI reuse audit are recorded in [docs/android-v2-retirement.md](docs/android-v2-retirement.md). Earlier V2 client architecture and parity documents are historical.

## Agent provider layer

- The provider layer contract is in [docs/agent-providers.md](docs/agent-providers.md). Read the nearest `CONTEXT.md` before changing `crates/agent-core/**`, `crates/agent-index/**`, `crates/agent-transport/**`, `crates/agent-search/**`, `crates/agent-resources/**`, `crates/companion-host/**`, `crates/agent-provider-codex/**`, `crates/agent-provider-claude/**`, `crates/companion-core/src/agent/**` or `packages/agent-protocol/**`; their dependency and `must_not_import` rules are checked in review.
- `apps/` holds only standalone shippable apps. The Claude provider is Rust only (`crates/agent-provider-claude`); it drives the user's `claude` CLI directly, with no host process or SDK package.
- Run `pnpm --filter @codewide/agent-protocol test` and `pnpm test:companion` for changes under `packages/agent-protocol/**`; protocol fixtures must round-trip in both TypeScript and Rust (`crates/agent-core/src/model/`).
- Run `pnpm validate:agents` (format check, type-aware hygiene lint, tests) before handing off any change under `packages/agent-protocol/**`. The package uses the shared `@sergeigarin/hygene` preset with no baseline: fix every finding; a narrow exception names one rule on one line with an adjacent `WHY` comment.
- Run `pnpm test:companion` (`cargo test --workspace`), `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check` for changes under `crates/agent-core/**`, `crates/agent-index/**`, `crates/agent-transport/**`, `crates/agent-search/**`, `crates/agent-resources/**`, `crates/companion-host/**`, `crates/agent-provider-codex/**`, `crates/agent-provider-claude/**` or `crates/companion-core/src/agent/**`.

## Releases

Use only the repository-owned one-shot release commands:

- Build and publish an Android APK: only from CI, through `Release Affected Products` or the `Android APK Release` workflow (`.github/workflows/android-release.yml`), which uploads the signed APK to a GitHub Release
- Build, sign, and validate the release APK locally without publishing it: `./scripts/build-android-apk [--version X.Y.Z] [--version-code N]`
- Build, validate, and publish Companion: `./scripts/release-companion`
- Build, validate, and publish the Linux Companion bundle: `./scripts/release-companion-linux <version>`
- Build, validate, and publish Relay: `./scripts/release-relay-linux <version>`
- Build, validate, and publish the macOS app: `./scripts/release-macos <patch|minor|major>`
- Calculate affected release targets: `pnpm release:plan -- --base <ref> --head <ref>`
- Calculate the affected products and each product's next version: `pnpm release:set-plan -- --bump <patch|minor|major>`
- Build all four products and publish one GitHub Release from CI: dispatch `Release Affected Products`
- Validate a release path without publishing: append `--dry-run`

Rules:

- Publishing is an external action. Run a non-dry release only after the user explicitly asks to publish or release it.
- Do not manually export signing variables, locate keys, bump Android versions, copy artifacts, or reconstruct the release sequence when the one-shot command is available.
- There is no local Android publishing path and no OTA publishing. Do not call Gradle `assembleRelease` directly as the normal build path; it is a low-level implementation detail reserved for diagnosing the APK build itself.
- The APK build command owns `versionName`, `versionCode`, and `runtimeVersion` for the build and restores the checked-in values afterwards. Do not update them separately before invoking it.
- Never bypass a failed release gate. Report the exact failed stage and fix the cause, then rerun the same one-shot command.
- Treat the final JSON printed by the command as the release result. Include its version, runtime, hash, and public download URL when reporting completion.
- A successful local build is not a completed release. Completion requires the command's public manifest or artifact verification to pass.
