# CodeWide agent instructions

## React callbacks

- Use `apps/android/src/react/useEvent.ts` when a callback identity escapes render: a custom hook returns it, a context or imperative handle exposes it, or an effect, subscription, timer, native API, or retained controller invokes it later. It provides stable identity while always calling the latest implementation.
- Keep ordinary JSX handlers and render-local helpers as ordinary functions; React Compiler owns their memoization. Do not use `useEvent` for render callbacks (`renderItem`, render props, functional `style`), Reanimated/worklet callbacks, or any callback whose changing identity is an intentional signal.
- Do not use `useCallback` or `useEffectEvent` directly as a general stabilization mechanism. A direct `useCallback` is allowed only when another API intentionally observes its identity change; document that contract at the call site.

## React data loading

- Never start data fetching or hydration from `useEffect` or `useLayoutEffect`. This prohibition includes network requests, SQLite reads, filesystem reads, native-bridge reads, query hydration, and promise creation whose purpose is to load render data. An effect-triggered fetch necessarily starts after commit and creates an avoidable empty or stale commit followed by another render.
- Components obtain asynchronous render data from a stable model-owned Legend resource during render. Navigation-critical resources expose their cached Promise through `useSelector(resource$, { suspense: true })`, which delegates to `React.use`; progressive or streaming surfaces may instead read the resource's Legend-owned `{ status, value, error }` snapshot so already-published data stays visible. Never create a fresh Promise on every render or mirror the resource into component-local loading/data state.
- The Promise cache may live in a dedicated global Legend State store or in an equivalent model-owned resource cache. Legend State owns the live resolved state; the resource layer owns Promise identity, request deduplication, invalidation, cancellation, and error state. Do not add component-local `useQuery` or parallel loading state merely to coordinate the same resource.
- Choose the loading boundary according to the interaction:
  - Navigation should preload the complete atomic destination resource and reveal the new screen in a Transition. Keep the previous screen visible until the destination snapshot is ready; do not commit a blank intermediate destination.
  - Lazy or incremental loading should use a stable range/resource key and the smallest local Suspense boundary, or explicit intent/viewport preloading. Preserve the currently visible data and anchor while the adjacent range loads.
  - Background refreshes and WebSocket/native events update the global model outside React effects and publish resolved changes to Legend State atomically. When React-owned navigation, range, or Promise-selection state changes, schedule that state change in a Transition; do not assume that merely wrapping an external-store mutation makes it deferred.
- Effects remain valid only for synchronizing with external systems after commit: subscriptions, timers, native listeners, imperative handles, and cleanup/retention. They must not be used as a data-loading scheduler. If retention is required, prefer hiding it behind the store subscription lifecycle rather than coupling it to a component fetch effect.

## Releases

Use only the repository-owned one-shot release commands:

- Publish an OTA update: `./scripts/release-ota`
- Build and publish a new APK: `./scripts/release-apk`
- Validate either release path without publishing: append `--dry-run`

Rules:

- Publishing is an external action. Run a non-dry release only after the user explicitly asks to publish or release it.
- Do not manually export signing variables, locate keys, bump Android versions, copy artifacts, or reconstruct the release sequence when the one-shot command is available.
- Do not call `ota:publish:raw`, `scripts/publish-android-ota.ts`, or Gradle `assembleRelease` as the normal release path. They are low-level implementation details reserved for diagnosing the release runner itself.
- The APK command owns `versionName`, `versionCode`, and `runtimeVersion`. Do not update them separately before invoking it.
- Never bypass a failed release gate. Report the exact failed stage and fix the cause, then rerun the same one-shot command.
- Treat the final JSON printed by the command as the release result. Include its update ID or APK version, runtime, hash, and public download URL when reporting completion.
- A successful local build is not a completed release. Completion requires the command's public manifest or artifact verification to pass.
