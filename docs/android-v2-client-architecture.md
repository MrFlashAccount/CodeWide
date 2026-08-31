# Android V2: independent Expo Router runtime over Sync API V2

> Status: approved target architecture and active implementation scope. Backend, sync-client, Android V2, native modules, routes, and E2E are one sequential workstream; there is no deferred implementation phase.
>
> This document is the durable architecture contract. It records ownership, allowed dependency direction, public routes and APIs, compatibility decisions, verification gates, and rollback. It is not an implementation proposal or a promise that target files already exist.

## Architecture decision

Android V2 is an independent application/UI runtime beside legacy, built as structural ports and adapters around a small functional core. Expo Router owns navigation identity; backend-owned Sync API V2 and the validated sync-client projection own canonical server state. Android owns composition, saved-server application policy, route-qualified resources, concrete persistence/transport adapters, and display mapping, but never a second epoch, projection, operation, or session state machine.

This is not a DDD-heavy rewrite. The boundaries exist to keep authority and imports explicit:

- Boot selects exactly one runtime.
- Legacy remains V1-owned and is not refactored into V2.
- Android V2 owns application policy and adapter implementations.
- `packages/sync-client/src/v2/**` is the sole client authority for Sync V2 session, epoch, projection, and operation semantics.
- `apps/companion/contract/v2.json` is the sole machine-readable V2 wire authority.
- `apps/android/src/presentation/**` contains protocol-neutral Views shared through display props and capabilities.

The incremental alternative—attaching V2 to `use-remote-workspace.ts`—is rejected because it preserves V1 lifecycle, storage, and import ownership. A separate APK/process remains conditional: it is justified only if the single-runtime invariant cannot be proven inside one Expo bundle.

## Scope and non-goals

The target contract requires:

- one boot gate for `legacy | v2`, with `stop current -> controlled restart -> cold start selected` and no navigation, session, projection, or persistence handoff;
- `/servers` as the aggregate All route and `savedServerId` in every single-server or nested destination;
- timeline content only from runtime-validated snapshot/change projection;
- `CommandOperation` status and local `InteractiveAction.pending` outside timeline;
- retained authoritative projection readable during `unavailable | connecting`, while mutations, Terminal input, and Voice upload require a live generation;
- V2 conversation Voice controls that use the existing native capture module and `/v2/voice` through the authenticated lease, surface pending/error/cancel states accessibly, and insert only a server-authoritative transcript into the current draft;
- confirmed saved-server deletion that first writes a durable delete intent, stops that server's V2 session, removes its native credentials/capabilities, and purges only its projection, operation, and correlation partitions before the catalog is republished;
- closed `/v2` contracts for pairing/session auth, files/media, ports/tunnels, Terminal, and Voice;
- a public `@codewide/sync-client/v2` subpath as the only V2 client entrypoint; the package root remains V1-only;
- generated TypeScript/Kotlin bindings derived only from the backend schema, plus runtime validation and exhaustive Rust-Serde/schema drift proof;
- protocol-neutral presentation reuse without V1 data, protocol, runtime, or storage compatibility.

Out of scope for this architecture slice:

- decomposition of `CodeWideScreen.tsx` or migration of its optimistic/read-model logic;
- V1 state migration, mirroring, dual writes, or fallback from V2 to V1 protocol/state;
- hot switching, making V2 default, deleting V1, release, OTA, APK, Companion deployment, or publication;
- UI redesign. V1 is the black-box visual/interaction oracle; the only approved difference is immediate pending behavior for async actions;
- release, deployment, or publication without separate approval;
- physical-device proof for Voice capture/cancel, Terminal interruption, and destructive deletion across restart. These are the only post-implementation evidence exclusions.

## Ubiquitous language and authority

- `UiGeneration`: boot value, `legacy | v2`.
- `RuntimeSlot`: boot lifecycle owner for the single mounted application runtime.
- `SavedServerId`: client-owned durable identity; never an endpoint, display name, or authenticated principal.
- `ServerSelection`: `all | selected`; a value, not an entity.
- `QualifiedThread`: `{ savedServerId, threadId }`; every thread/subsurface mutation preserves this owner.
- `ConnectionEpoch`, `ProjectionGeneration`, `CommandOperation`, `V2ProjectionStore`, `V2OperationStore`, `SyncV2Session`: owned only by `@codewide/sync-client/v2`.
- `TerminalSession`: generation-bound, authenticated V2 terminal lifecycle.
- `VoiceInputScope`: input-surface identity (`chat | review | generic`); thread context is optional.
- `DictationSession`: audience-bound Voice lifecycle owned by a saved-server session.
- `ReusableView`: protocol-neutral presentation boundary, not a server entity.
- `InteractiveAction`: ephemeral UI execution state, not a server operation.
- `V2ContractArtifact`: backend-owned schema artifact; generated bindings are compatibility surfaces, not wire authorities.

Snapshots and projections are read-model records, not entities or caches. Operations are not messages. UI pending is not server state.

## Ownership boundaries

1. **Boot:** `apps/android/src/boot/**` owns generation preference, runtime slot, and controlled restart. It calls only public legacy/V2 lifecycle entrypoints and platform restart/storage primitives.
2. **Legacy application:** `CodeWideScreen.tsx`, existing `src/ui`, `src/rendering`, unrelated `src/data` files, and unrelated `src/native` modules remain V1-owned and do not start or import V2.
3. **Android V2:** `apps/android/src/v2/**` owns saved-server/application policy, route-qualified selection, display mapping, capability gating, composition, and concrete adapters. It does not own sync-client epoch, projection, operation, or session semantics.
4. **Shared presentation:** `apps/android/src/presentation/**` owns protocol-neutral Views only. It imports no V1/V2 models, stores, routes, I/O, or native modules.
5. **Sync client V2:** `packages/sync-client/src/v2/**` is the sole client owner of generated wire validation, epoch/barrier/reconnect, authoritative projection reduction and active/retained store contract, command admission/receipts and operation store contract, and session lifecycle.
6. **Companion and native V2 boundary:** `apps/companion/contract/v2.json` and `apps/companion/src/sync_v2/**` own executable wire authority, semantics, authorization, and bounded streaming. The generated Kotlin contract, V2 Terminal/Voice native modules, and their entries in `CodeWidePackage.kt` are part of the same V2 boundary; `MainApplication.kt` remains unchanged because it already registers `CodeWidePackage`. V2 handlers may reuse internal semantic services below the wire boundary but never V1 handlers or DTOs.

## Public routes and integration surfaces

- `/legacy` mounts `CodeWideScreen` only.
- `/servers` means aggregate All. No magic ID represents All.
- `/servers/[savedServerId]` means one saved server.
- Thread, agent, attachment, review, Terminal, port, and account destinations preserve the owning `savedServerId` in the URL.
- `/pair` and `/thread` are temporary legacy-only aliases and never select V2. Their removal condition is explicit V1-deletion approval.
- `connectionId` is not a V2 route or domain term.
- New V2 code imports Sync V2 only from `@codewide/sync-client/v2`. `packages/sync-client/src/index.ts` must not re-export V2 symbols.
- `/v2/sync` is the authoritative snapshot/change/query/command/action/operation channel.
- Pairing/session auth, files/media, and port/tunnel contracts use versioned `/v2` endpoints.
- Terminal uses `/v2/terminals`; Voice uses `/v2/voice`. Neither uses V1 URLs, generic RPC, or `companion/dictation/*`.
- `apps/companion/contract/v2.json` is the sole schema source for generated TypeScript/Kotlin artifacts and runtime validators.

## Three independent state paths

```text
validated /v2 server frame
  -> SyncV2Session
  -> sync-client projection reducer / V2ProjectionStore
  -> Android projectionResource read adapter
  -> timelineDisplayModel
  -> TimelineView

command intent
  -> owning SyncV2Session
  -> sync-client operation state machine / V2OperationStore
  -> Android operationResource read adapter
  -> operationDisplayModel
  -> OperationStatusView

user activation
  -> ActionRunner
  -> local pending until the returned Promise settles
  -> actionable control
```

No arrow connects `operationResource` or `ActionRunner` to `V2ProjectionStore`. Retained projection stays on the first path, is paired with server-level `unavailable | connecting`, and never becomes optimistic/outbox state. Android subscribes to both authoritative stores but mutates neither state machine directly.

## Runtime and persistence invariants

- At most one V1 or V2 application runtime exists. `app/_layout.tsx` and boot modules never eagerly import or start both.
- V2 uses the physical database `codewide-v2.db` (or an equally explicit isolated physical boundary) and partitions every durable record by `savedServerId`.
- V2 never opens, migrates, adapts, mirrors, or dual-writes V1 caches or credentials.
- Saved-server deletion writes a durable intent before stopping the saved-server session. Native credential/key/capability removal and V2 projection, operation, and correlation purge are partitioned by the same `savedServerId`; startup resumes any interrupted purge before reopening sessions.
- `ProjectionGeneration` contains only server-originated records. Retained visibility does not grant mutation authority.
- `sourceGeneration` is the sole server-restart witness for generation-bound resources. `epochId` and `revision` never substitute for it.
- Reconnect revokes live capabilities, preserves retained projection, performs bounded reinitialization, and atomically publishes a new authoritative generation inside sync-client.
- Watermarks order only within an epoch; they are not reconnect or history cursors.
- Unknown, duplicate, regressing, foreign-epoch, ambiguous-owner, invalid-audience, or schema-invalid input follows the fail-closed V2 policy.
- Generated types never replace inbound and outbound runtime validation.

### Durable command lifecycle

- The successful atomic commit of `V2OperationStore.create` is the only retry boundary. `notCreated` is emitted only after validation/live-authority failure before create, or after a rejected create followed by a successful same-ID read proving absence. Conflict, an unreadable store, commit-acknowledgement loss, and pruned durable evidence are non-retryable.
- `SyncV2Session` captures a live socket/epoch for an attempt, installs one same-ID waiter after commit, and rechecks that authority immediately before every operation transition and every send. A stale authority never sends; it defers the committed operation to the next verified live generation.
- The caller's Promise and operation ID survive reconnect and reinitialize. `created` and `sent` recover by resending the same ID. `accepted` recovers only through `operation.get`, because command admission may already have happened.
- `completed`, `failed`, `indeterminate`, `rejected`, and `expired` are terminal same-ID settlements. Explicit disposal or a durable state whose authoritative result cannot currently be read is `durableUnsettled`; neither state authorizes a new ID.
- Android persists a separate content-free per-activation correlation containing only identity, scope, lifecycle state, and timestamps. It never stores prompt text or a text/hash fingerprint. A remount or process restart reconciles every allocating/durable correlation against same-ID local operation status and, for accepted work, `operation.get`; terminal rows clear pending UI, while missing aged/durable evidence becomes non-retryable `indeterminate`. Two identical explicit activations still receive distinct IDs.
- Exported activation errors are fixed, bounded, and content-free: `SyncV2CommandNotCreatedError` is the proven pre-commit outcome and `SyncV2CommandDurableUnsettledError` is the non-retryable post-commit/ambiguous outcome. Validation, SQLite, transport, cause, and stack details remain internal.
- Local control pending is owned by the actionable component nearest the activation and lasts until the returned Promise settles. It is not server state, timeline content, or an optimistic projection.

## Terminal, Voice, actions, and telemetry

- Terminal uses a separate `/v2/terminals` WebSocket data plane. Session ownership, authenticated audience, live generation, offsets, replay, resize/input/close, and bounded queues/bytes are explicit. Replay loss and overflow are public outcomes; truncation is never silent.
- Voice uses a separate `/v2/voice` WebSocket data plane. The V2 conversation binds the existing native microphone capture to one live `sourceGeneration`, exposes start/finish/cancel/error states through a shared presentation control, and accepts a transcript only from the authoritative Voice result. Batches are bounded and acknowledged; retry is limited to an unacknowledged batch in the same live generation and audience. `VoiceInputScope` identifies the input surface; thread context remains optional.
- Terminal/Voice audience is derived from the owning saved-server session and never accepted from arbitrary UI payload.
- Kotlin typed bindings exist only for an actual native boundary. The native microphone module emits capture chunks but does not own V2 wire DTOs.
- Every actionable V2 control accepts `() => void | Promise<void>`. The actionable component nearest the activation owns callback pending, duplicate suppression, and rejection display. Pending must be visible immediately without changing dimensions, hit target, focus, accessible name, or role.
- Thread-creation navigation and send/submit settle only on the matching authoritative command terminal result. Admission alone preserves the same pending activation and operation ID; save and cancel settle on their matching capability acknowledgements.
- Telemetry uses bounded, low-cardinality, content-free fields. Message, prompt, audio, Terminal, file, credential, token, secret URL, raw body, raw error, cause, and stack content is forbidden.

## Shared presentation extraction ownership

Extraction is a two-sided source edit: create the shared target and edit every listed legacy source into a V1 container/platform adapter that imports the target. Do not leave half-migrated mixed ownership.

| Current legacy source(s)                                                                           | Protocol-neutral target                                                                     | Required legacy edit / compatibility                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/CodeWideScreen.tsx` composer/input sections and `src/ui/Typography.tsx::AppTextInput`         | `src/presentation/input/AppTextInputView.tsx`, `InputSurfaceView.tsx`, `VoiceInputView.tsx` | V1 keeps store, paste, and Voice controller wiring; `keep_temporarily` until V1 deletion.                     |
| `src/rendering/RichMarkdown.tsx`                                                                   | `src/presentation/markdown/RichMarkdownView.tsx`                                            | Existing file becomes the V1 review/streaming capability container; `keep_temporarily`.                       |
| `src/rendering/MermaidDiagram.native.tsx`, `MermaidDiagram.web.tsx`                                | `src/presentation/markdown/DiagramView.tsx`                                                 | Existing files remain V1 platform/capability adapters; `keep_temporarily`.                                    |
| `src/rendering/CodeReviewWorkspace.tsx`, `CodeReviewEditor.native.tsx`, `CodeReviewEditor.web.tsx` | `src/presentation/review/CodeReviewView.tsx`                                                | Workspace becomes a V1 state/capability container; editor files remain platform adapters; `keep_temporarily`. |
| `src/rendering/ContentReviewHost.tsx`                                                              | `src/presentation/review/ContentReviewView.tsx`                                             | Host retains V1 anchors/comments/input persistence; `keep_temporarily`.                                       |
| `src/rendering/DocumentPreviewHost.tsx`                                                            | `src/presentation/preview/DocumentPreviewView.tsx`                                          | Host retains V1 bytes/download lifecycle; `keep_temporarily`.                                                 |
| `src/ui/TerminalWorkspace.native.tsx`, `TerminalWorkspace.web.tsx`                                 | `src/presentation/terminal/TerminalWorkspaceView.tsx`                                       | Existing files remain V1 transport/store containers; no V1 Terminal wrapper enters V2; `keep_temporarily`.    |
| `src/ui/AppFullscreenModal.native.tsx`, `AppFullscreenModal.tsx`                                   | `src/presentation/overlays/AppFullscreenModalView.tsx`                                      | Existing files retain native modal and Voice registration; `keep_temporarily`.                                |
| `src/ui/VoiceAura.native.tsx`, `VoiceAura.web.tsx`                                                 | `src/presentation/voice/VoiceAuraView.tsx`                                                  | Existing files retain native level/target adaptation; `keep_temporarily`.                                     |
| `src/ui/WaveText.tsx`                                                                              | `src/presentation/voice/WaveTextView.tsx`                                                   | Existing file retains V1/platform configuration; `keep_temporarily`.                                          |

`DrawingWorkspace.tsx`, `ProjectPickerSheet.tsx`, `InternalBrowser.*`, and `MessageActionMenu.*` remain legacy-owned. Moving them requires fresh file-level evidence and a new architecture revision.

## Domain/source proof map

| Concept                                | Classification and owner                           | Allowed runtime path                                                         | Forbidden ownership/path                                                            | Durable/schema owner                                          | Compatibility and negative gate                                                                |
| -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `UiGeneration`                         | Boot value; `src/boot`                             | `app/index`, settings control, runtime slot                                  | V1/V2 application stores                                                            | Boot-only preference                                          | New shared boot contract; runtime-isolation test proves no state handoff.                      |
| `SavedServer`                          | Entity; Android V2 domain/application              | V2 root, repository, qualified routes                                        | Endpoint/name as identity; V1 profile import                                        | `codewide-v2.db`, V2 credentials                              | No V1 migration; cold-start storage audit.                                                     |
| `ProjectionGeneration`                 | Read-model record; sync-client sole authority      | Validated frame -> `SyncV2Session` -> reducer/store -> Android read resource | Android reducer/repository/controller; operation/action/optimistic timeline paths   | V2 schema, sync-client store contract, Android SQLite adapter | Delete current canary duplication; import/duplicate-owner and projection-authority gates.      |
| `CommandOperation`                     | Entity; sync-client sole authority                 | Admission/receipt/store -> Android read resource -> status View              | Android operation entity/repository/state machine; timeline/message materialization | V2 schema, sync-client store contract, Android SQLite adapter | Import through `@codewide/sync-client/v2`; root-export/import negative gate remains mandatory. |
| `TerminalSession`                      | Entity; Companion V2 + Android application         | `/v2/terminals`, native adapter, controller                                  | V1 Terminal URL, generic RPC, projection-channel bytes                              | V2 schema and bounded server registry                         | No V1 wrapper; replay/loss/security gates.                                                     |
| `DictationSession` / `VoiceInputScope` | Entity + qualified input identity                  | `/v2/voice`, controller, chat/review/generic Views                           | V1 dictation path, required-thread owner, content logs                              | V2 schema and bounded server session storage                  | No V1 wrapper; audience/cancel/privacy gates.                                                  |
| `InteractiveAction`                    | Ephemeral UI execution record; `src/v2/ui/actions` | Shared actionable primitives and capability Promises                         | Feature-local busy/saving; `CommandOperation` mirroring                             | No persistence                                                | Approved V2 parity exception; action/a11y/geometry gates.                                      |
| `ReusableView`                         | Presentation boundary; `src/presentation`          | Display props/capabilities from V1 or V2 containers                          | DTOs, stores, I/O, native access                                                    | No persistence                                                | Source reuse only; import and fixture-parity gates.                                            |
| `V2ContractArtifact`                   | Backend-owned schema artifact                      | Generator, Rust validator, TS/Kotlin validators                              | Client-owned schema/type copies                                                     | `apps/companion/contract/v2.json`                             | Generated paths stable; full schema/Rust/generated drift gate.                                 |

## Module deletion proof

- `src/boot` owns one-runtime lifecycle and generation choice; deleting it reintroduces eager dual startup.
- `src/presentation` has two real callers and owns protocol-neutral visual contracts; deleting it duplicates UI or forces forbidden cross-imports.
- `src/v2/domain` owns Android identity/lifecycle invariants without React or I/O; deleting it smears raw wire/UI values through controllers.
- `src/v2/application` owns saved-server selection, route-qualified resources, and capability policy; deleting it smears policy across routes and adapters. It explicitly does not own Sync V2 state machines.
- `src/v2/infrastructure` owns concrete persistence/transport/platform implementations and app session leases; deleting it couples policy to SQLite, Expo, and WebSocket. Its registry may not interpret epochs, reduce frames, or transition operations.
- `src/v2/platform` exists only where native/web variation is real; one-adapter placeholder zones are forbidden.
- `packages/sync-client/src/v2` owns executable wire/session/epoch/projection/operation semantics; bypassing it necessarily recreates forbidden authority in Android.
- `apps/companion/src/sync_v2` owns V2 authentication, semantics, and stream bounds; deleting it would force forbidden V1-handler reuse.

## Final annotated repository tree

Legend: `[B]` boot/shared shell; `[L]` legacy-only; `[D]` Android V2 domain/policy; `[A]` Android V2 application; `[F]` feature/presenter; `[U]` protocol-neutral UI; `[I]` infrastructure/I/O; `[P]` platform/native adapter; `[C]` backend/wire contract; `[T]` test support.

```text
repository/
├── AGENTS.md                                                     [B] V2 ownership/import/runtime/review rules
├── package.json                                                  [B] validate:sync:v2 and release:gate wiring
├── docs/
│   └── android-v2-client-architecture.md                         [B] this durable contract
├── apps/
│   ├── android/
│   │   ├── index.js                                              [B] CSS/polyfills/global error + expo-router entry only
│   │   ├── app/
│   │   │   ├── _layout.tsx                                      [B] framework/security providers only
│   │   │   ├── index.tsx                                        [B] UiGeneration redirect to /legacy or /servers
│   │   │   ├── legacy.tsx                                       [L] mounts CodeWideScreen only
│   │   │   ├── pair.tsx                                         [L] temporary alias to /legacy
│   │   │   ├── thread.tsx                                       [L] temporary alias to /legacy
│   │   │   ├── (workspace)/
│   │   │   │   ├── _layout.tsx                                  [F] V2 responsive workspace Slot
│   │   │   │   └── servers/
│   │   │   │       ├── index.tsx                                [F] /servers = All
│   │   │   │       └── [savedServerId]/
│   │   │   │           ├── _layout.tsx                          [F] validates SavedServerId
│   │   │   │           ├── index.tsx                            [F] single-server thread list
│   │   │   │           ├── new.tsx                              [F] new thread for one saved server
│   │   │   │           ├── ports/
│   │   │   │           │   ├── index.tsx                        [F] saved-server port profiles
│   │   │   │           │   └── [profileId].tsx                  [F] one qualified port profile
│   │   │   │           └── threads/
│   │   │   │               └── [threadId]/
│   │   │   │                   ├── _layout.tsx                  [F] QualifiedThread subnavigation
│   │   │   │                   ├── index.tsx                    [F] conversation
│   │   │   │                   ├── attachments.tsx              [F] qualified attachments
│   │   │   │                   ├── changes.tsx                  [F] qualified review/changes
│   │   │   │                   ├── terminal.tsx                 [F] qualified Terminal
│   │   │   │                   └── agents/
│   │   │   │                       ├── _layout.tsx              [F] agent subnavigation
│   │   │   │                       ├── index.tsx                [F] qualified agent list
│   │   │   │                       └── [agentThreadId].tsx       [F] qualified agent thread
│   │   │   └── (modal)/
│   │   │       ├── _layout.tsx                                  [F] V2 modal Stack
│   │   │       ├── servers/[savedServerId]/threads/[threadId]/
│   │   │       │   └── attachments/[attachmentId].tsx           [F] qualified attachment preview
│   │   │       └── settings/
│   │   │           ├── index.tsx                                [F] V2 settings + generation control
│   │   │           ├── accounts/
│   │   │           │   └── [savedServerId].tsx                  [F] one-server accounts
│   │   │           └── servers/
│   │   │               ├── new.tsx                              [F] V2 pairing/create saved server
│   │   │               └── [savedServerId].tsx                  [F] one-server settings
│   │   ├── src/
│   │   │   ├── CodeWideScreen.tsx                               [L] unchanged legacy composition root
│   │   │   ├── data/use-remote-workspace.ts                     [L] legacy-only workspace runtime
│   │   │   ├── native/
│   │   │   │   ├── ...                                         [L] unrelated legacy native modules
│   │   │   ├── boot/
│   │   │   │   ├── uiGeneration.ts                              [B] generation value/public contract
│   │   │   │   ├── uiGenerationResource.ts                      [B] stable render-time resource
│   │   │   │   ├── uiGenerationStore.native.ts                  [I] boot-only durable preference
│   │   │   │   ├── uiGenerationStore.web.ts                     [I] development preference
│   │   │   │   ├── runtimeSlot.ts                               [B] one active lifecycle handle
│   │   │   │   ├── RootGenerationGate.tsx                       [B] selects one runtime without handoff
│   │   │   │   ├── UiGenerationControl.tsx                      [U] development selector
│   │   │   │   ├── applicationRestart.native.ts                [P] controlled restart
│   │   │   │   └── applicationRestart.web.ts                   [P] development reload
│   │   │   ├── presentation/
│   │   │   │   ├── input/AppTextInputView.tsx                   [U]
│   │   │   │   ├── input/InputSurfaceView.tsx                   [U]
│   │   │   │   ├── input/VoiceInputView.tsx                     [U]
│   │   │   │   ├── markdown/RichMarkdownView.tsx                [U]
│   │   │   │   ├── markdown/DiagramView.tsx                     [U]
│   │   │   │   ├── review/CodeReviewView.tsx                    [U]
│   │   │   │   ├── review/ContentReviewView.tsx                 [U]
│   │   │   │   ├── preview/DocumentPreviewView.tsx              [U]
│   │   │   │   ├── preview/VideoPreviewView.tsx                 [U] protocol-neutral video frame
│   │   │   │   ├── terminal/TerminalWorkspaceView.tsx           [U]
│   │   │   │   ├── overlays/AppFullscreenModalView.tsx          [U]
│   │   │   │   ├── voice/VoiceAuraView.tsx                      [U]
│   │   │   │   └── voice/WaveTextView.tsx                       [U]
│   │   │   └── v2/
│   │   │       ├── V2Application.tsx                            [B] V2 composition root
│   │   │       ├── V2VideoPreview.tsx                           [B] video capability composition
│   │   │       ├── createV2Runtime.ts                           [B] constructs one runtime/lifecycle handle
│   │   │       ├── domain/
│   │   │       │   ├── ids.ts                                  [D]
│   │   │       │   ├── savedServer.ts                          [D]
│   │   │       │   ├── serverSelection.ts                      [D]
│   │   │       │   ├── qualifiedThread.ts                      [D]
│   │   │       │   ├── terminalSession.ts                      [D]
│   │   │       │   ├── voiceInputScope.ts                      [D]
│   │   │       │   ├── dictationSession.ts                     [D]
│   │   │       │   └── failure.ts                              [D]
│   │   │       ├── application/
│   │   │       │   ├── ports/savedServerRepository.ts          [A]
│   │   │       │   ├── ports/terminalTransport.ts              [A]
│   │   │       │   ├── ports/voiceTransport.ts                 [A]
│   │   │       │   ├── ports/telemetry.ts                      [A]
│   │   │       │   ├── resources/savedServersResource.ts       [A]
│   │   │       │   ├── resources/serverSelectionResource.ts    [A]
│   │   │       │   ├── resources/projectionResource.ts         [A] read adapter over SyncV2Session
│   │   │       │   ├── resources/threadResource.ts             [A]
│   │   │       │   ├── resources/operationResource.ts          [A] read adapter over operation snapshots
│   │   │       │   ├── resources/terminalResource.ts           [A]
│   │   │       │   ├── resources/voiceResource.ts              [A]
│   │   │       │   ├── commandCapabilities.ts                  [A]
│   │   │       │   ├── terminalController.ts                   [A]
│   │   │       │   ├── voiceInputController.ts                 [A]
│   │   │       │   └── v2Runtime.ts                            [A]
│   │   │       ├── features/
│   │   │       │   ├── navigation/routeParams.ts               [F]
│   │   │       │   ├── navigation/routeDestinations.ts         [F]
│   │   │       │   ├── serverList/ServerListScreen.tsx         [F]
│   │   │       │   ├── threadList/ThreadListScreen.tsx         [F]
│   │   │       │   ├── conversation/ConversationScreen.tsx     [F]
│   │   │       │   ├── conversation/timelineDisplayModel.ts    [F]
│   │   │       │   ├── conversation/operationDisplayModel.ts   [F]
│   │   │       │   ├── composer/ChatComposer.tsx               [F]
│   │   │       │   ├── terminal/TerminalScreen.tsx             [F]
│   │   │       │   ├── changes/ChangesScreen.tsx               [F]
│   │   │       │   ├── attachments/AttachmentsScreen.tsx       [F]
│   │   │       │   ├── attachments/VideoPreviewScreen.tsx      [F]
│   │   │       │   ├── attachments/videoPreview.ts             [F]
│   │   │       │   ├── agents/AgentsScreen.tsx                 [F]
│   │   │       │   ├── agents/AgentThreadScreen.tsx            [F]
│   │   │       │   ├── ports/PortsScreen.tsx                   [F]
│   │   │       │   ├── ports/PortProfileScreen.tsx             [F]
│   │   │       │   ├── settings/SettingsScreen.tsx             [F]
│   │   │       │   ├── settings/NewSavedServerScreen.tsx       [F]
│   │   │       │   ├── settings/SavedServerSettingsScreen.tsx  [F]
│   │   │       │   └── settings/AccountSettingsScreen.tsx      [F]
│   │   │       ├── ui/
│   │   │       │   ├── actions/action.ts                       [U]
│   │   │       │   ├── actions/ActionRunner.tsx                [U]
│   │   │       │   ├── actions/ActionPressable.tsx             [U]
│   │   │       │   ├── actions/ActionMenuItem.tsx              [U]
│   │   │       │   ├── actions/ActionSwipeItem.tsx             [U]
│   │   │       │   ├── layouts/WorkspaceView.tsx               [U]
│   │   │       │   ├── layouts/ResponsiveWorkspaceLayout.tsx   [U]
│   │   │       │   ├── navigation/ServerRailView.tsx           [U]
│   │   │       │   ├── navigation/ThreadListView.tsx           [U]
│   │   │       │   ├── conversation/ConversationView.tsx       [U]
│   │   │       │   ├── conversation/TimelineView.tsx           [U]
│   │   │       │   ├── conversation/OperationStatusView.tsx    [U]
│   │   │       │   └── settings/SettingsView.tsx               [U]
│   │   │       ├── infrastructure/
│   │   │       │   ├── config/readEnvironment.ts              [I]
│   │   │       │   ├── sync/syncClientAdapter.ts              [I]
│   │   │       │   ├── sync/createSyncSession.ts              [I]
│   │   │       │   ├── sync/syncSessionRegistry.ts            [I] app leases only
│   │   │       │   ├── persistence/v2Database.native.ts       [I]
│   │   │       │   ├── persistence/v2Database.web.ts          [I]
│   │   │       │   ├── persistence/sqliteSavedServerRepository.native.ts [I]
│   │   │       │   ├── persistence/sqliteProjectionStore.native.ts [I]
│   │   │       │   ├── persistence/sqliteOperationStore.native.ts [I]
│   │   │       │   ├── persistence/secureCredentialsRepository.native.ts [I]
│   │   │       │   ├── terminal/nativeTerminalTransport.native.ts [I]
│   │   │       │   ├── terminal/terminalTransport.web.ts      [I]
│   │   │       │   ├── voice/v2VoiceTransport.native.ts       [I]
│   │   │       │   ├── voice/v2VoiceTransport.web.ts          [I]
│   │   │       │   ├── files/v2FileCapabilities.ts            [I]
│   │   │       │   ├── ports/v2PortCapabilities.ts            [I]
│   │   │       │   ├── telemetry/sanitizedTelemetry.ts        [I]
│   │   │       │   ├── react/useV2RuntimeSubscription.ts      [I]
│   │   │       │   └── react/useV2Resource.ts                 [I]
│   │   │       ├── platform/
│   │   │       │   ├── clipboard/copyCapability.native.ts     [P]
│   │   │       │   ├── clipboard/copyCapability.web.ts        [P]
│   │   │       │   ├── links/openLinkCapability.native.ts     [P]
│   │   │       │   ├── links/openLinkCapability.web.ts        [P]
│   │   │       │   ├── rendering/CodeReviewEditorAdapter.native.tsx [P]
│   │   │       │   ├── rendering/CodeReviewEditorAdapter.web.tsx [P]
│   │   │       │   ├── rendering/QuickDrawAdapter.native.tsx  [P]
│   │   │       │   ├── rendering/QuickDrawAdapter.web.tsx     [P]
│   │   │       │   ├── rendering/DiagramRenderer.native.tsx   [P]
│   │   │       │   ├── rendering/DiagramRenderer.web.tsx      [P]
│   │   │       │   ├── rendering/VoiceAuraAdapter.native.tsx  [P]
│   │   │       │   ├── rendering/VoiceAuraAdapter.web.tsx     [P]
│   │   │       │   ├── rendering/ExpoVideoPlayer.tsx           [P]
│   │   │       │   ├── voice/voiceCapture.native.ts           [P]
│   │   │       │   └── voice/voiceCapture.web.ts              [P]
│   │   │       └── testing/
│   │   │           ├── createTestRuntime.ts                    [T]
│   │   │           ├── fixtures/projectionFixtures.ts         [T]
│   │   │           ├── fixtures/operationFixtures.ts          [T]
│   │   │           ├── fixtures/viewFixtures.ts               [T]
│   │   │           ├── adapters/inMemoryProjectionStore.ts    [T]
│   │   │           ├── adapters/inMemoryOperationStore.ts     [T]
│   │   │           ├── adapters/scriptedTerminalTransport.ts  [T]
│   │   │           └── adapters/scriptedVoiceTransport.ts     [T]
│   │   ├── test/v2/
│   │   │   ├── import-boundaries.test.ts                       [T]
│   │   │   ├── runtime-isolation.test.ts                       [T]
│   │   │   ├── router-deep-links.test.ts                       [T]
│   │   │   ├── projection-authority.test.ts                    [T]
│   │   │   ├── action-contract.test.tsx                        [T]
│   │   │   ├── component-parity.test.tsx                       [T]
│   │   │   ├── terminal-contract.test.ts                       [T]
│   │   │   └── voice-contract.test.ts                          [T]
│   │   ├── android/app/src/main/java/dev/codewide/app/remote/
│   │   │   ├── CodeWidePackage.kt                               [P] existing RN package and V2 module registration seam
│   │   │   ├── SyncV2ContractGenerated.kt                      [C]
│   │   │   ├── V2TerminalModule.kt                             [P]
│   │   │   ├── V2TerminalSessionManager.kt                     [P]
│   │   │   ├── V2TerminalFrameCodec.kt                         [P]
│   │   │   └── V2VoiceCaptureModule.kt                         [P]
│   │   ├── dependency-cruiser.v2.config.mjs                    [B]
│   │   ├── knip.v2.json                                        [B]
│   │   ├── oxfmt.v2.json                                       [B]
│   │   ├── oxlint.v2.config.mjs                                [B]
│   │   ├── tsconfig.v2.json                                    [B]
│   │   ├── scripts/validate-v2-dependencies.mjs                [B]
│   │   └── package.json                                        [B]
│   └── companion/
│       ├── contract/v2.json                                    [C] sole Draft 2020-12 V2 wire authority
│       ├── src/server.rs                                       [C] registers /v2 routes
│       ├── src/sync_v2/mod.rs                                  [C]
│       ├── src/sync_v2/contract.rs                             [C]
│       ├── src/sync_v2/conformance.rs                          [C]
│       ├── src/sync_v2/protocol.rs                             [C]
│       ├── src/sync_v2/protocol/error.rs                       [C]
│       ├── src/sync_v2/protocol/kinds.rs                       [C]
│       ├── src/sync_v2/protocol/terminal.rs                    [C]
│       ├── src/sync_v2/protocol/voice.rs                       [C]
│       ├── src/sync_v2/protocol/tests.rs                       [T]
│       ├── src/sync_v2/wire.rs                                 [C]
│       ├── src/sync_v2/runtime.rs                              [C]
│       ├── src/sync_v2/runtime/command.rs                      [C]
│       ├── src/sync_v2/runtime/query.rs                        [C]
│       ├── src/sync_v2/pairing.rs                              [C]
│       ├── src/sync_v2/files.rs                                [C]
│       ├── src/sync_v2/ports.rs                                [C]
│       ├── src/sync_v2/terminal.rs                             [C]
│       ├── src/sync_v2/voice.rs                                [C]
│       ├── src/sync_v2/source.rs                               [C]
│       ├── src/sync_v2/production.rs                           [I]
│       ├── tests/v2_contract.rs                                [T]
│       ├── tests/v2_sync_transport.rs                          [T]
│       ├── tests/v2_terminal_transport.rs                      [T]
│       ├── tests/v2_voice_transport.rs                         [T]
│       └── tests/live_v2_backend_contract.rs                   [T]
└── packages/sync-client/
    ├── package.json                                            [C] exports ./v2
    ├── scripts/generate-v2-contract.mjs                        [C]
    ├── src/index.ts                                            [C] V1-only package root
    ├── src/v2/index.ts                                         [C]
    ├── src/v2/contract.generated.ts                            [C]
    ├── src/v2/frames.ts                                        [C]
    ├── src/v2/validate.ts                                      [C]
    ├── src/v2/validate-client.ts                               [C]
    ├── src/v2/validate-shared.ts                               [C]
    ├── src/v2/model.ts                                         [C]
    ├── src/v2/canonical.ts                                     [C]
    ├── src/v2/projection.ts                                    [C]
    ├── src/v2/aggregate.ts                                     [C]
    ├── src/v2/operations.ts                                    [C]
    ├── src/v2/operation-store.ts                               [C]
    ├── src/v2/deletion-store.ts                                [C]
    ├── src/v2/session.ts                                       [C]
    ├── src/v2/transport.ts                                     [C]
    ├── src/v2/terminal.ts                                      [C]
    ├── src/v2/voice.ts                                         [C]
    ├── test/v2-contract.test.ts                                [T]
    ├── test/v2-projection.test.ts                              [T]
    ├── test/v2-operations.test.ts                              [T]
    ├── test/v2-aggregate.test.ts                               [T]
    ├── test/v2-terminal.test.ts                                [T]
    └── test/v2-voice.test.ts                                   [T]
```

## Dependency rules

1. `app/** -> src/v2/features/** -> src/v2/application/** -> src/v2/domain/**` is allowed. Routes may also import `src/boot/**`; no other inward shortcut is allowed.
2. `src/v2/infrastructure/**` implements Android application ports and sync-client `V2ProjectionStore`/`V2OperationStore` ports. Application and domain never import infrastructure.
3. `src/v2/ui/**` and `src/presentation/**` accept only props, display models, and capabilities. They never import routes, resources, transport, SQLite, SecureStore, native modules, raw frames, or V1 types.
4. `src/v2/features/**` may import application, domain, UI, and presentation. It never imports infrastructure, Expo I/O, native modules, or wire DTOs.
5. `packages/sync-client/src/v2/**` must not import V1 sync-client, Android, or Companion implementation. The package root must not re-export V2 symbols.
6. V1 must not import `src/v2`, `@codewide/sync-client/v2`, or V2 storage. V2 must not import `CodeWideScreen`, `src/data`, legacy native/containers, or package-root sync-client.
7. Shared presentation imports only React/React Native, theme/design primitives, and explicit props.
8. Companion V2 may call internal semantic services but never V1 route handlers or V1 DTO deserializers.

Binding negative checks include:

- `src/v2/domain -> react | react-native | expo | infrastructure | features | ui | sync-client epoch/projection/operation`;
- `src/v2/application -> expo | react-native | sqlite | secure-store | native modules | contract.generated`;
- `src/v2/features|ui -> infrastructure | raw contract.generated | legacy`;
- `V1 -> src/v2 | sync-client/v2`;
- `sync-client/v2 -> sync-client V1`;
- `presentation -> V1 | V2 application | I/O`.

Android declarations named `ConnectionEpoch`, `ProjectionGeneration`, `V2ProjectionStore`, `CommandOperation`, `V2OperationStore`, or `SyncV2Session` outside test fixtures are rejected as duplicate authority.

## Compatibility decisions

- `/pair` and `/thread` remain legacy-only aliases until V1-deletion approval.
- Legacy presentation sources that are reused by V2 are converted atomically into V1 containers/platform adapters plus protocol-neutral shared Views.
- No package-root V2 export, V1 wire adapter, state migration, dual write, or fallback path is allowed.

## Implementation ownership

One sequential implementation owner carries the approved scope across Companion, sync-client, Android application/UI, native modules, tests, and this architecture memory. This prevents two branches from implementing incompatible retry or correlation boundaries.

The scope is complete only when the repository exposes the `@codewide/sync-client/v2` subpath, generated TS/Kotlin bindings, single-owner session/projection/operation APIs, closed V2 endpoint contracts, executable contract drift gates, durable content-free Android command correlation, reachable V2 Terminal/Voice native modules, Expo Router routes, and the required emulator evidence.

## Verification and review gates

Contract verification must prove:

- schema-to-generated regeneration matches exact TypeScript/Kotlin outputs and fingerprint;
- an exhaustive Rust variant registry serializes every concrete HTTP/WS/Sync DTO variant and validates it against the schema;
- schema-derived required-field/negative cases agree with Rust deserialization;
- runtime inbound/outbound validation remains enabled;
- the package subpath exists; `packages/sync-client/src/index.ts` exports no V2 symbols and Android imports V2 only through `@codewide/sync-client/v2`;
- Android persistence adapters implement the current public observation/store/session contracts without defining a second authority;
- `CodeWidePackage.createNativeModules` registers the approved V2 Terminal and Voice modules, those modules are reachable through the already-registered `CodeWidePackage`, and `MainApplication.kt` remains unchanged;
- V2 public endpoints use only V2 validated shapes and enforce authentication, audience, generation, cancellation, bounds, and public failure outcomes.

Architecture verification must prove:

- this document and `AGENTS.md` agree on sole authority, route identity, compatibility removals, durable command lifecycle, the three state paths, and rollback;
- no stale connection-based V2 route contract or language that treats V1 as a V2 state/protocol downgrade remains;
- `git diff --check` passes.

The active scope also requires import/runtime isolation, qualified route/deep-link/back behavior, projection authority, action/a11y/geometry, parity, Terminal replay/loss, Voice audience/cancel/retry, deterministic SourceGap recovery, and emulator evidence. `validate:android:v2` must fail when the package root re-exports any V2 symbol or Android imports a V2 symbol through the package root. V1 and V2 are compared as black boxes; V1 DTO/state never becomes V2 fixture input.

Review covers architecture ownership, sync-client conformance, Android correlation and UI settlement, native-module reachability, transport security, Voice privacy, exact import closure, deterministic fault isolation, and emulator behavior.

### Deterministic emulator fault boundary

- The Companion test binary is built explicitly with the non-default Cargo feature `e2e-command-fault`. Normal Companion builds do not compile the controller or private routes.
- The controller is reachable only through the existing mode-`0600` private Unix control socket. It intercepts exactly the next real command, emits an authentic SourceGap/reinitialize, holds the next live boundary, and releases or times out after a bounded interval.
- Android production code has no fault flag, route, deep link, native method, or test trigger. The Appium runner controls the Companion out of process and records monotonic milestones plus the eventual operation ID.
- The race is accepted only when evidence observes this order from independent boundaries: fault armed; one UI activation; Android logs `clientDurableCreate` only after the SQLite operation-store transaction commits; Companion intercepts that same operation ID; Companion sends reinitialize; Companion holds the next live boundary; release; exactly one Companion admission for the same operation ID; authoritative App Server projection. Labels generated after the fact are not lifecycle evidence.

## Rollback

The smallest safe rollback is:

1. disable V2 selection;
2. stop the V2 runtime;
3. perform a controlled restart;
4. cold-start a fresh V1 runtime;
5. leave physically separate V2 stores untouched for diagnosis.

Rollback never translates V2 state into V1, silently downgrades protocol, mounts both runtimes, or treats V1 as a V2 compatibility fallback. Cross-client disclosure, duplicate authority, dual runtime, unbounded streaming, contract drift, or parity regression blocks rollout and triggers this rollback path.

No commit, push, PR, release, OTA, APK, Companion deployment, or other publication follows from this document without separate explicit permission.
