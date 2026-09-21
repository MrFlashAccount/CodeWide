# Android V1 source ownership

## Purpose, owner and language

This context owns V1 source placement and composition boundaries under `apps/android/src`. TypeScript/TSX implements the application; comments and ownership documentation use English. V1 calls a saved runtime identity `connectionId`; do not replace it with V2 `savedServerId` terminology. Expo Router owns application destinations; conversation activation remains a mounted-owner token, not just a connection/thread key.

The [approved feature architecture](../../../docs/android-v1-feature-architecture.md) and [feature migration ledger](../../../docs/android-v1-feature-migration.md) record the M0–M8 capability extraction. The current application-navigation contract and source closure are in [route architecture](../../../docs/android-v1-route-architecture.md) and the [route migration ledger](../../../docs/android-v1-route-migration.md). Feature owners remain for connections, accounts, settings, threadList, projects, search, requests, goal, queue, turnActions, attachments, changes, review, drawing, ports, terminal, agents, composer and conversation. `features/navigation/**` was removed after Router assumed destination ownership. Device-only scenarios remain explicitly unverified in the ledgers.

## Current and target placement

Interaction policy lives in cohesive owners under `features/`: workspace, threadList, projects, connections, settings, accounts, search, globalSupervisor, conversation, composer, queue, requests, goal, turnActions, attachments, changes, review, drawing, agents, terminal, ports, browser and diagnostics. Route composition and application navigation live under `app/v1/**`; cross-route identity and private resource sessions live under `services/**`.

A feature owns its policy, narrow public contracts, read/action binding, local state, pending/errors, retained callbacks, cleanup and styles. Conversation has separate detail, timeline, turns, protocol and content owners; composer separates draft, submission, settings, attachments, queue editing, voice binding, input and skills. No generic `useConversation` or `WorkspaceController` may replace the current monolith.

`app/v1/_layout.tsx` is the stable V1 route entry. Its route-local composition, model, thread-list adapter and shell are split by responsibility. `features/workspace` retains stable feature/runtime bindings without owning destinations. `CodeWideScreen`, `WorkspaceScreen`, `WorkspaceOverlays` and the navigation feature are deleted. Existing deep [data/runtime owners](data/CONTEXT.md), native/platform mechanisms and shared render primitives retain their authority.

The approved Global Voice Mode extension adds `features/globalSupervisor/**` without adding an application route. The feature owns its render resource, activation state, action settlement and typed recovery. Route composition receives the already-created feature contract and passes one app-level start/stop control into the persistent thread-list header; the control owns no persistence, App Server RPC, connection discovery, native module access or transport subscription. The nearest [global-supervisor context](features/globalSupervisor/CONTEXT.md) is binding for its public surface and internal source placement. The source implementation is present; physical-device background WebRTC proof remains pending until its recorded gates pass.

## What belongs and does not belong

- Feature-specific UI/interaction policy belongs with its owner; merely placing a view in a new folder is insufficient. Project order/management and composer mode choice are feature policy, even when currently under data/UI.
- Runtime startup, session authority, persistence, command publication, source-qualified read lanes and shared caches belong below features. Never duplicate a model, cache, DTO schema or transport state machine for a feature.
- Global-supervisor binding/reconciliation, exact hidden-thread admission, realtime/tool/event adapters and request classification belong to their lower data/native/Companion owners. The feature consumes narrow capabilities and may not become a second transcript, pending-request, delivery or connection authority.
- Generic UI/rendering primitives remain at their proven owners. Shared review hosts/formats and voice-input scope synchronization are retained; not all existing UI modules are protocol-neutral Views.
- `presentation/` retains live V1 view consumers; `boot/runtimeSlot.ts` serializes the V1 native lifetime. The Android V2 frontend and generation chooser were removed; see the [retirement audit](../../../docs/android-v2-retirement.md). Companion and sync-client V2 remain independent.

## Allowed relationships and forbidden dependencies

Composition imports feature public surfaces; features expose narrow scoped intents/results and model-owned reads. Feature adapters may import lower data/native/platform contracts. Feature consumers do not receive arbitrary RPC, all database handles or the broad `RemoteWorkspace` object. Cross-feature workflows use public capabilities: queue edit to composer, review/drawing result to attachment admission, agents to the public conversation detail surface.

Binding target rules, including type imports:

- V1 must not import `v2/**`, `@codewide/sync-client/v2` or V2 storage. The versioned upstream `@codewide/codex-protocol/v0.147.0/v2` DTO path is not the V2 sync runtime.
- Data/native must not import features or `app/**`. Generic UI/rendering must not depend on feature internals; move actual feature policy or inject a narrow capability instead.
- Feature internals must not import root composition, another feature's private model/adapter/style, or the legacy facade after their unit closes. Public entry modules must be explicit; broad barrels and type cycles are forbidden.
- `features/globalSupervisor/**` must not import raw native modules, SQLite implementations, transport implementations, Expo Router, another feature's private implementation or V2. It accepts only validated qualified V1 references and injected binding, visibility, session, tool, event, media and delivery capabilities. Existing catalog/history/delivery/request owners must not import it.
- Conversation detail/timeline/turns/protocol/content cannot import full ConversationWorkspace, composer, agents or tool implementations. Agents may consume only public detail/read/navigation capabilities. Composer emits intents rather than navigating or importing queue/review/drawing/tool internals.
- `presentation/**` accepts display props and typed capabilities only; no V1/V2 model, store, route, transport, persistence or native imports.

## Preserved lifetime and interaction contracts

Main-chat selection publishes immediately, revealing cached content or a local skeleton with progressive transcript hydration; header/composer do not wait for complete history. Restore composer state before editing. Subagent selection preserves its existing Transition. These are the V1-specific interpretation of navigation loading; do not convert main-chat selection to an atomic full-transcript transition.

Keep the native conversation shell mounted across chat switches. Existing activation guards reset local state before commit and reject stale completions, including unmount/remount of the same scope. `useEvent` serves escaping latest-value callbacks; captured activation capabilities retain their distinct semantics. Queue-edit upload scope remains distinct from the ordinary draft. Feature hide/unmount is not automatic native controller/terminal/tunnel disposal.

Stable Legend resources own render data and Promise identity; no effect-triggered fetch, per-render cache construction, broad snapshot mirror or graph clone. The [runtime context](data/CONTEXT.md) preserves module-started JS startup separately from the native boot handle.

Global Voice Mode adds one process-lifetime `GlobalVoiceActivation`, not another runtime. It may own transient realtime transcript/activity state only while active and remains live across navigation and ordinary app backgrounding until explicit Stop or terminal failure. When biometric app lock is enabled, closing the privacy boundary suspends its live transport without ending the logical activation; successful foreground authentication resumes it. It shares one neutral, generation-fenced V1 microphone lease with existing dictation and holds Android microphone foreground authority while interactive WebRTC capture is active. Realtime control notifications, live event signals and activation state are never persisted or replayed; WebRTC media never enters the application transport. Separately, the lower data owner persists content-free supervisor/worker relations and bounded attention/ack rows projected from the existing Companion journal. It stores no transcript or tool output and exposes only a count plus speech-idle delivery to the feature.

The native Voice Aura is one non-interactive window attached to the current CodeWide activity. It stays above CodeWide screens, sheets and dialogs without system-overlay permission, never follows the app into another application, and must not reintroduce per-window target registration.

## Migration and validation

Use the M0–M8 owner units, platform siblings and lifetime checks in the [feature ledger](../../../docs/android-v1-feature-migration.md), followed by the implemented route disposition in the [route ledger](../../../docs/android-v1-route-migration.md). Feature-local CONTEXT files describe their current public capabilities and dependency boundaries.

Every application unit runs `pnpm validate:android:v1`. Check actual native/web/type/dynamic/test consumers atomically with each move. `app/v1/**` belongs exclusively to the V1 formatter, TypeScript, render, lint, Knip and dependency gates; V2 tooling scopes only V2 route groups and shared boot/presentation owners. Run the V2 gate if a V2-owned or generation-neutral gate surface changes. Docs must distinguish planned paths from implemented code until each unit closes.
