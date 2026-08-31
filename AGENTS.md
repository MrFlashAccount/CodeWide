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

## Android V2 boundary

### Architecture and ownership

- V2 is one implementation scope spanning the Companion contract/runtime, `@codewide/sync-client/v2`, the Android V2 runtime, Expo Router routes, native V2 modules, tests, and architecture memory. Do not split ownership into deferred phases or copy/synthesize a second contract. The package-root `@codewide/sync-client` entrypoint is V1-only; every V2 consumer imports the `/v2` subpath.
- Run `pnpm validate:android:v2` before handing off any change under the V2-owned Expo Router surface or `apps/android/src/v2/**`. This is the authoritative V2 quality gate; do not replace it with the legacy ESLint command.
- Boot code under `apps/android/src/boot/**` owns the `legacy | v2` generation choice and the single runtime slot. `app/_layout.tsx` is a framework/security shell only. Switching generations must stop the current runtime, perform a controlled restart, and cold-start the selected runtime without navigation, session, projection, or persistence handoff.
- `/servers` is the only aggregate All URL. Every single-server and nested V2 route uses `savedServerId`; thread and subsurface routes must preserve the owning `savedServerId`. `connectionId` is not a V2 route or domain term.
- V1 modules must not import `apps/android/src/v2/**`, `@codewide/sync-client/v2`, or V2 storage. V2 modules must not import `CodeWideScreen`, `apps/android/src/data/**`, legacy native or container modules, V1 stores, or the package-root `@codewide/sync-client` export.
- `packages/sync-client/src/v2/**` is the sole client owner of epoch/barrier/reconnect, projection reduction and active/retained `V2ProjectionStore`, command admission/receipts and `V2OperationStore`, and `SyncV2Session` lifecycle. Android may implement persistence adapters and route-qualified read resources but must not duplicate those state machines or contracts.
- `apps/companion/contract/v2.json` is the sole machine-readable V2 wire authority. Generated TypeScript/Kotlin artifacts are compatibility surfaces, not schema owners, and runtime validation remains mandatory. V2 code must not call V1 routes, handlers, DTOs, generic RPC, V1 Terminal URLs, or `companion/dictation/*`.
- `SyncV2ContractGenerated.kt`, `V2TerminalModule.kt`, `V2TerminalSessionManager.kt`, `V2TerminalFrameCodec.kt`, `V2VoiceCaptureModule.kt`, and their `CodeWidePackage.kt` entries are the V2 native boundary. `MainApplication.kt` already registers `CodeWidePackage`; keep registration reachable through that seam.
- Protocol-neutral shared Views live under `apps/android/src/presentation/**`, accept only display props and typed capabilities, and must not import V1/V2 models, stores, routes, transport, persistence, or native modules. Extraction edits the shared target and its legacy source atomically.
- `apps/android/src/v2/domain/**` is runtime-neutral. It must not import React, React Native, Expo, routes, features, UI, application services, or infrastructure.
- Routes contain only Expo Router and feature composition. Routes, features, application code, and UI must not perform transport, SQLite, SecureStore, FileSystem, Linking, native-module, wall-clock, or random access directly; inject typed capabilities owned by `apps/android/src/v2/infrastructure/**`.
- Direct React effects are allowed only in named synchronization hooks under `apps/android/src/v2/infrastructure/react/**`. Use the repository `useEvent` contract for callbacks that escape render.
- Server projections must not be mirrored into component state, and V2 must not create optimistic server entities. Retained projection may remain readable while disconnected, but mutation, Terminal input, and Voice upload require a live authoritative generation. `CommandOperation` and local action pending are separate state paths and never materialize timeline items.
- The atomic `V2OperationStore.create` commit is the sole retry boundary. A committed command keeps one operation ID and one caller Promise through reconnect and reinitialize. Recheck the captured live epoch immediately before every transition and send; stale authority defers recovery of the same ID to the next verified live generation. `accepted` operations recover through `operation.get`, never by resending the command. Only failure before commit is retryable as `notCreated`; explicit disposal or unrecoverable durable settlement is `durableUnsettled` and must remain visible.
- Android command correlation is content-free, durable, per explicit activation, and partitioned by saved server. It may persist IDs, scope, lifecycle state, and timestamps, but never prompt text, fingerprints, or payload hashes. Remount/restart reconciles by operation ID. Two identical explicit activations receive different IDs.
- Every actionable V2 leaf uses the shared `() => void | Promise<void>` Action contract. The component nearest the activation owns callback pending and duplicate suppression until that Promise settles; it must surface rejection. Feature-local mirrors of server operation state and floating Promises are forbidden.
- Production Android code contains no E2E fault hook. Deterministic SourceGap injection exists only in the Companion behind the non-default Cargo feature `e2e-command-fault` and a mode-`0600` private Unix control socket. Normal Companion builds and Android artifacts must not contain the control route or trigger.
- Do not add broad lint, formatter, type, Knip, or dependency-cruiser suppressions. Any exception must name one exact file or dependency and explain the invariant that makes it safe.
- The four legacy bridge files at `app/_layout.tsx`, `app/index.tsx`, `app/pair.tsx`, and `app/thread.tsx` are deliberately outside the initial V2 gate. Remove that exemption as each file becomes V2-owned; do not add another ignored route.
- Each module, class, and function owns one cohesive set of invariants and has one cohesive reason to change. Composition may connect owners, but it must not absorb their transport, state, serialization, observability, or lifecycle policies. If a review cannot name the owner and its invariant, split the responsibility behind a narrow contract.

### Types, immutability, and runtime shapes

- Every type assertion except `as const` requires an adjacent WHY comment that explains both why the assertion is necessary and why a safe typed alternative is unavailable. An unsafe assertion also requires the narrow lint exception immediately after that comment. Assertions never replace external-input validation.
- Types must make impossible states unrepresentable. Use discriminated unions for related states instead of independent booleans and nullable fields. Infer from one source of truth only when the inferred type remains a project contract; external DTOs, schemas, and library types must cross an explicit adapter into the domain.
- Use branded types for semantically different values with the same runtime representation when confusion is realistic, including server, thread, epoch, revision, sequence, cursor, and operation identifiers. Create the brand after boundary validation; do not brand incidental local strings or numbers. An unchecked brand escape hatch follows the same WHY rule as a type assertion.
- Do not use `never` to silence an unresolved type mismatch. Switches over closed unions must be exhaustive and route the impossible branch through the repository unreachable-state helper.
- Do not make immutability a default design goal. Prefer explicit ownership, stable object identity, and owner-controlled mutation. An owner may update private state in place when no untrusted alias can mutate it and the framework contract does not require a new identity. Use `readonly`, `Readonly<T>`, and `as const` at public boundaries only when they express a real consumer contract; do not let those types force runtime copying inside the owner.
- Returning a function-owned result transfers that result directly. If a function creates and fills a local array, object, map, set, buffer, or builder result and retains no mutable alias, return the same value. `return [...result]`, `return { ...result }`, `return result.slice()`, `return Array.from(result)`, and equivalent copies are forbidden when `return result` has the same observable contract. The same rule applies to pass-through helpers that clone a value only before forwarding it.
- General-purpose cloning is forbidden, including `structuredClone`, JSON stringify/parse round trips, `cloneDeep`, and equivalent clone libraries or helpers. Do not spread an object or array merely to appear immutable or to manufacture a new identity. Copy only the smallest changed structure when an explicit ownership boundary, retained historical snapshot, transactional rollback, serialization contract, or reactive framework requires it; preserve all unchanged identities. A non-obvious full copy requires an adjacent WHY comment naming that contract, and cloning a projection or message graph on a hot path is a review failure.
- Functions keep stable runtime types and object shapes for their arguments and return values. Union or overload dispatch is allowed at an external boundary only; after validation, each branch immediately delegates to a monomorphic implementation. Construct objects of the same shape with properties in the same order. A deviation is a review failure unless an external contract prevents removing it and an adjacent WHY comment documents that contract.

### Environment, telemetry, and logs

- Only `apps/android/src/v2/infrastructure/config/readEnvironment.ts` may read `process.env`, `EXPO_PUBLIC_*`, or Expo runtime configuration. It reads once, converts the result immediately into an independent typed project config, and injects that contract. Aliasing, destructuring, `globalThis` indirection, repeated reads, and passing the environment object beyond this composition boundary are forbidden.
- Telemetry must use stable names, bounded low-cardinality attributes, and must not add material work to rendering, projection, or transport hot paths. Batching, export, and flush work stays outside those paths.
- Opaque server-generated identifiers may be logged as correlation fields. Message content, prompts, account identifiers, credentials, secret-bearing URLs, request or response bodies, and other user data must not be logged. External `Error`, `cause`, and `stack` values require sanitization into bounded fields such as operation, code, status, and failure kind.

### Local exceptions, modules, and tests

- A lint exception must be `oxlint-disable-next-line <exact-rule>` for one following line and have an adjacent WHY comment. File-wide, global, unused, or convenience-only disables are forbidden.
- TypeScript modules and directories under `apps/android/src/v2/**` use `camelCase`. Purpose and platform suffixes such as `.test.ts`, `.native.tsx`, and `.web.tsx` are excluded from the module name. Expo Router conventions including `_layout.tsx`, `[param].tsx`, route groups, and special route files keep their required names.
- Module mocks are forbidden by default, including `vi.mock`, `vi.doMock`, `vi.importMock`, `vi.unmock`, `vi.doUnmock`, Jest equivalents, `__mocks__`, and aliases or destructuring that hide them. Test the real module or pass an existing narrow dependency explicitly; do not add dependency injection only for a test. `vi.fn`, `vi.spyOn`, fake timers, and environment stubs remain allowed.
- The only module-mock exception is an infrastructure adapter test named `*.native.test.ts[x]` or `*.expo.test.ts[x]` when the external React Native or Expo module cannot execute in the Node test runtime. The test may replace only that external platform module, must exercise the real project adapter, and requires a WHY comment naming the unavailable runtime contract.
- Tests verify observable contracts and meaningful invariants, not incidental representation. Do not pin exact snapshot byte size, object-field order, generated identifiers, timestamps, chunk boundaries, or serialized JSON unless that representation is an explicit protocol, compatibility, or performance contract owned by the tested module.
- New comments and JSDoc are written in English and explain contracts or WHY, not names or syntax. Document exported domain contracts, capabilities, and public application APIs; leaf UI exports do not require ceremonial JSDoc. `TODO` and `FIXME` comments must reference a tracked issue.

## Releases

Use only the repository-owned one-shot release commands:

- Publish an OTA update: `./scripts/release-ota`
- Build and publish a new APK: `./scripts/release-apk`
- Build, validate, and publish Companion: `./scripts/release-companion`
- Validate either release path without publishing: append `--dry-run`

Rules:

- Publishing is an external action. Run a non-dry release only after the user explicitly asks to publish or release it.
- Do not manually export signing variables, locate keys, bump Android versions, copy artifacts, or reconstruct the release sequence when the one-shot command is available.
- Do not call `ota:publish:raw`, `scripts/publish-android-ota.ts`, or Gradle `assembleRelease` as the normal release path. They are low-level implementation details reserved for diagnosing the release runner itself.
- The APK command owns `versionName`, `versionCode`, and `runtimeVersion`. Do not update them separately before invoking it.
- Never bypass a failed release gate. Report the exact failed stage and fix the cause, then rerun the same one-shot command.
- Treat the final JSON printed by the command as the release result. Include its update ID or APK version, runtime, hash, and public download URL when reporting completion.
- A successful local build is not a completed release. Completion requires the command's public manifest or artifact verification to pass.
