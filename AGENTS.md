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

## Android V1 feature boundary

- The selected V1 ownership contract and implemented source tree are in [docs/android-v1-feature-architecture.md](docs/android-v1-feature-architecture.md); exact owner moves, lifetimes and migration gates are in [docs/android-v1-feature-migration.md](docs/android-v1-feature-migration.md). Read [apps/android/src/CONTEXT.md](apps/android/src/CONTEXT.md) and the nearest local ownership contract before a V1 source move. M0–M8 source migration is implemented; the migration ledger records completed automated checks and unverified device scenarios.
- Run `pnpm validate:android:v1` before handing off any change under `app/legacy.tsx` or the V1-owned `apps/android/src/**` surface. It applies the shared hygiene preset to the complete V1 graph, rejects hygiene regressions above the checked-in debt baseline, checks formatting, public API JSDoc, import and `StyleSheet` layout, dead exports, unresolved platform seams, cycles, and V1 dependency boundaries. Do not update the hygiene baseline to admit a new violation; reduce it as touched code becomes compliant.
- V1 main-chat selection preserves immediate destination publication, cached content/local skeleton and progressive transcript hydration; header/composer must not wait for complete history, and composer restoration precedes editing. V1 subagent selection retains its existing Transition. This specific V1 contract qualifies the generic atomic-navigation guidance above; do not change navigation behavior during ownership extraction.
- Preserve existing V1 JS module-evaluation startup separately from the boot-controlled native resource handle. Feature extraction must not add JS disposal to native stop or feature unmount. Existing source/schema/platform authorities remain unchanged.

## Android router and retired V2 frontend

- Android exposes only V1. `app/_layout.tsx` owns framework/security providers, a `Slot`, and the V1 diagnostics HUD; it must not wrap the workspace in another native stack. `app/+not-found.tsx` displays recovery while replacing unknown URLs with `/`. `app/(workspace)/index.tsx` owns `/`; `/legacy`, `/pair`, and `/thread` redirect there; the V1 process deep-link owner handles the original pairing and notification URLs.
- `app/(workspace)/_layout.tsx` owns the serialized native runtime handle in `src/boot/runtimeSlot.ts`. The workspace route group does not contribute a URL segment. `src/routeComposition/**` owns navigation helpers outside Expo route discovery; `app/**` contains only screens and layouts. There is no generation preference, generation switch, V2 runtime, or V2 route group.
- `src/presentation/**` retains components with live V1 consumers. Do not restore a second UI tree or add all presentation files as Knip entrypoints to suppress dead code.
- CodeWide has one Companion API at `/v1`, one sync-client entrypoint, and one Android runtime. The former V2 protocol, client, native modules, and parity harness are removed. Keep the unrelated external Codex App Server generated V2 protocol and persisted compatibility identifiers.
- Run `pnpm validate:android:v1` for Android changes and `pnpm --filter @codewide/android compile:android` when validating the application bundle. Run `pnpm test:companion`, Cargo Clippy, and Cargo format checks for backend changes.
- The retirement scope and UI reuse audit are recorded in [docs/android-v2-retirement.md](docs/android-v2-retirement.md). Earlier V2 client architecture and parity documents are historical.

## Releases

Use only the repository-owned one-shot release commands:

- Publish an OTA update: `./scripts/release-ota`
- Build and publish a new APK: `./scripts/release-apk`
- Build, validate, and publish Companion: `./scripts/release-companion`
- Build, validate, and publish the Linux Companion bundle: `./scripts/release-companion-linux <version>`
- Build, validate, and publish Relay: `./scripts/release-relay-linux <version>`
- Build, validate, and publish the macOS app: `./scripts/release-macos <patch|minor|major>`
- Calculate affected release targets: `pnpm release:plan -- --base <ref> --head <ref>`
- Calculate independent product versions: `pnpm release:set-plan -- --bump <patch|minor|major>`
- Release every affected product from CI: dispatch `Release Affected Products`
- Validate a release path without publishing: append `--dry-run`

Rules:

- Publishing is an external action. Run a non-dry release only after the user explicitly asks to publish or release it.
- Do not manually export signing variables, locate keys, bump Android versions, copy artifacts, or reconstruct the release sequence when the one-shot command is available.
- Do not call `ota:publish:raw`, `scripts/publish-android-ota.ts`, or Gradle `assembleRelease` as the normal release path. They are low-level implementation details reserved for diagnosing the release runner itself.
- The APK command owns `versionName`, `versionCode`, and `runtimeVersion`. Do not update them separately before invoking it.
- Never bypass a failed release gate. Report the exact failed stage and fix the cause, then rerun the same one-shot command.
- Treat the final JSON printed by the command as the release result. Include its update ID or APK version, runtime, hash, and public download URL when reporting completion.
- A successful local build is not a completed release. Completion requires the command's public manifest or artifact verification to pass.
