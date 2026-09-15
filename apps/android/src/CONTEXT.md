# Android V1 source ownership

## Purpose, owner and language

This context owns V1 source placement and composition boundaries under `apps/android/src`. TypeScript/TSX implements the application; comments and ownership documentation use English. V1 calls a saved runtime identity `connectionId`; do not replace it with V2 `savedServerId` terminology. Navigation destinations are local discriminated state, and conversation activation is a mounted-owner token, not just a connection/thread key.

The [approved feature architecture](../../../docs/android-v1-feature-architecture.md) is the selected target; the [migration ledger](../../../docs/android-v1-feature-migration.md) is the full planned source/test map. **M0–M8 source ownership and available automated/platform validation are complete. Device-only scenarios remain explicitly unverified in the ledger.** The actual closed feature units contain connections, accounts, settings, navigation, threadList, projects, search, requests, goal, queue, turnActions, attachments, changes, review, drawing, ports, terminal, agents, composer and conversation. Workspace composition and diagnostics are also implemented. Their local CONTEXT files describe their public surfaces and verification limits.

## Current and target placement

Interaction policy now lives in cohesive owners under `features/`: workspace, navigation, threadList, projects, connections, settings, accounts, search, conversation, composer, queue, requests, goal, turnActions, attachments, changes, review, drawing, agents, terminal, ports and diagnostics.

A feature owns its policy, narrow public contracts, read/action binding, local state, pending/errors, retained callbacks, cleanup and styles. Conversation has separate detail, timeline, turns, protocol and content owners; composer separates draft, submission, settings, attachments, queue editing, voice binding, input and skills. No generic `useConversation` or `WorkspaceController` may replace the current monolith.

CodeWideScreen is the stable route-facing composition export; it renders WorkspaceScreen. `features/workspace` wires stable feature surfaces and runtime capabilities without implementing their algorithms. Existing deep [data/runtime owners](data/CONTEXT.md), native/platform mechanisms and shared render primitives retain their authority.

## What belongs and does not belong

- Feature-specific UI/interaction policy belongs with its owner; merely placing a view in a new folder is insufficient. Project order/management and composer mode choice are feature policy, even when currently under data/UI.
- Runtime startup, session authority, persistence, command publication, source-qualified read lanes and shared caches belong below features. Never duplicate a model, cache, DTO schema or transport state machine for a feature.
- Generic UI/rendering primitives remain at their proven owners. Shared review hosts/formats and voice-input scope synchronization are retained; not all existing UI modules are protocol-neutral Views.
- `presentation/`, `boot/` and `v2/` retain their existing [V2/generation-neutral contracts](../../../docs/android-v2-client-architecture.md). This context does not override those contracts or move their runtime/native responsibilities.

## Allowed relationships and forbidden dependencies

Composition imports feature public surfaces; features expose narrow scoped intents/results and model-owned reads. Feature adapters may import lower data/native/platform contracts. Feature consumers do not receive arbitrary RPC, all database handles or the broad `RemoteWorkspace` object. Cross-feature workflows use public capabilities: queue edit to composer, review/drawing result to attachment admission, agents to the public conversation detail surface.

Binding target rules, including type imports:

- V1 must not import `v2/**`, `@codewide/sync-client/v2` or V2 storage. The versioned upstream `@codewide/codex-protocol/v0.147.0/v2` DTO path is not the V2 sync runtime.
- Data/native must not import features or CodeWideScreen. Generic UI/rendering must not depend on feature internals; move actual feature policy or inject a narrow capability instead.
- Feature internals must not import root composition, another feature's private model/adapter/style, or the legacy facade after their unit closes. Public entry modules must be explicit; broad barrels and type cycles are forbidden.
- Conversation detail/timeline/turns/protocol/content cannot import full ConversationWorkspace, composer, agents or tool implementations. Agents may consume only public detail/read/navigation capabilities. Composer emits intents rather than navigating or importing queue/review/drawing/tool internals.
- `presentation/**` accepts display props and typed capabilities only; no V1/V2 model, store, route, transport, persistence or native imports.

## Preserved lifetime and interaction contracts

Main-chat selection publishes immediately, revealing cached content or a local skeleton with progressive transcript hydration; header/composer do not wait for complete history. Restore composer state before editing. Subagent selection preserves its existing Transition. These are the V1-specific interpretation of navigation loading; do not convert main-chat selection to an atomic full-transcript transition.

Keep the native conversation shell mounted across chat switches. Existing activation guards reset local state before commit and reject stale completions, including unmount/remount of the same scope. `useEvent` serves escaping latest-value callbacks; captured activation capabilities retain their distinct semantics. Queue-edit upload scope remains distinct from the ordinary draft. Feature hide/unmount is not automatic native controller/terminal/tunnel disposal.

Stable Legend resources own render data and Promise identity; no effect-triggered fetch, per-render cache construction, broad snapshot mirror or graph clone. The [runtime context](data/CONTEXT.md) preserves module-started JS startup separately from the native boot handle.

## Migration and validation

Use the exact M0–M8 owner units, platform siblings, consumer map, lifetime checks and rollback in the [ledger](../../../docs/android-v1-feature-migration.md). Create each feature-local CONTEXT with its real module, stating purpose, language, public capabilities, lifetime, allowed/forbidden dependencies, tests and migration status. Do not scaffold empty owner folders in D0.

Every application unit runs `pnpm validate:android:v1`; M0 must first extend existing lint/dependency coverage to new feature paths without exemptions. Check actual native/web/type/dynamic/test consumers atomically with each move. Run the V2 gate if a V2-owned or generation-neutral gate surface changes; avoid that scope expansion. Docs must distinguish planned paths from implemented code until each unit closes.
