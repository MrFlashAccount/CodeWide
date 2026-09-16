# Android V1 feature migration ledger

Status: **M0–M8 capability migration implemented; post-M8 route closure recorded in the route ledger**. Selected contract: [feature architecture](android-v1-feature-architecture.md). Current application navigation: [route architecture](android-v1-route-architecture.md) and [route ledger](android-v1-route-migration.md). Source baseline: `3630ca4ed87a90916bd0a7cb4beaaba230fa28ce`; source line numbers and consumer inventories refer to this revision. Paths beginning `features/`, `data/`, `ui/` or `rendering/` are relative to `apps/android/src/`; other repository paths are named explicitly.

This ledger preserves the complete approved capability ownership/move contract and baseline inventories. Its implementation evidence records the authorized M0–M8 migration. `CodeWideScreen` was the stable composition wrapper at M8 and was deleted by the later route migration; the `RemoteWorkspace` facade remains deleted. Platform mechanisms and database schemas remain at their existing authorities. Historical per-unit evidence below records the state at each unit; the M8 closure supersedes earlier pending-work notes, and the route ledger supersedes M8 application-navigation ownership.

Navigate: [owners](#entity-delta-and-ownership), [runtime fields](../apps/android/src/data/CONTEXT.md#current-startup-and-complete-runtime-state-closure), [actions](#feature-action-mapping), [lifetimes](#lifetime-and-cancellation-matrix), [migration units](#migration--pr-slices), [source appendices](#source-mapping-appendices).

## Entity delta and ownership

Added: feature modules and their public capability records; small composition bindings; feature-local ownership contracts. Changed: source location and ownership of current screen behavior and feature actions; lint/dependency/test coverage paths. Removed at closure: the screen's private feature implementations, its shared stylesheet and the feature-facing omnibus `RemoteWorkspace` contract/hook. Unchanged: wire DTO/schema owners, databases/formats, native transport/runtime registration, V1 sync-client state machines, app route and boot generation boundaries.

Every row below is a real policy owner. Public names are architectural exports; implementation may infer internal types without duplicating these contracts. File families listed as `.native/.web/.types` move together only when the module belongs to that feature.

| Owner / target source | Owns and public surface | Existing mechanisms retained; what deletion would break |
| --- | --- | --- |
| `features/workspace/WorkspaceScreen.tsx` | Responsive shell and composition of stable feature surfaces; no data/action algorithms | Window layout and insets remain native-owned. Deleting it removes the application surface composition |
| `features/navigation/threadNavigation.ts`, `ConversationHost.tsx` | Destination model, selection/preload intent, IME handoff, deep-link and search destination admission; `selectThread`, `openDraft`, `openSearch`, scoped selection reads | Existing `createThreadNavigationModel` semantics and `WorkspaceConversationHost` subscriptions; deleting loses one selection/lifetime authority |
| `features/threadList/ThreadListFeature.tsx`, `threadListModel.ts`, `SidebarSectionHeader.tsx`, `sidebarRows.ts`, `summaryProjection.ts`, `SidebarListFeedback.tsx` | Server/project-scoped list paging/filtering, stable projections, scroll memory, list row actions | Summary database/query contracts retained; deleting loses list interaction policy, not transport |
| `features/projects/ProjectPickerFeature.tsx`, `projectSelection.ts`, `newChat.ts`, `SidebarProjects.tsx`, `sidebarProjects.ts`, `sidebarProjectOrder.ts`, `useSidebarProjectOrder.ts`, `useRemoteProjectCatalog.ts` | Project discovery/order/pinning, directory picker, new-chat workspace selection and draft-to-thread activation | Remote project model and V1 workspace creation behavior; deleting loses new-chat/project interaction invariants |
| `features/connections/ConnectionFeature.tsx`, `pairing.ts`, `connectionPresentation.ts`, `ConnectionActivityIndicator.tsx` | Add/edit/reconnect/enable/delete/order, pairing validation/session/camera/paste, diagnostics presentation; explicit connection capabilities | Native credentials/session adapter and validated profile contracts retained; deleting loses pairing/profile workflow |
| `features/settings/SettingsFeature.tsx` | Settings surface and app-lock/generation/diagnostic entry composition; owns visibility and settings section layout | Boot generation control and app-lock security shell remain their existing owners; deleting does not remove those security/runtime authorities |
| `features/accounts/AccountPoolFeature.tsx`, `accountUsage.tsx` | Account login/explicit cancellation/profile actions, usage read surface and copied-code timer | Account database and native/session adapters retained; deleting loses account UX. Explicit close cancels login; unmount currently clears only copied-code timer, **not** server login |
| `features/search/GlobalSearchScreen.tsx`, existing search-session/window family | Global search session/query/ranges, search-hit destination and selected-window identity | Move existing named feature zone as a unit; no second search store. Conversation receives search-window focus intent |
| `features/conversation/ConversationWorkspace.tsx`, `ConversationDetail.tsx` | Narrow conversation surface composition and model-owned detail binding; thread metadata, restore boundary and progressive history snapshot | ThreadChat/ThreadHistory/ThreadDetail owners unchanged; deleting loses the conversation's read/publication boundary |
| `features/conversation/timeline/*` | Timeline projection/cache, viewport/anchor/pagination/unread/search-within-visible-thread policy and navigation commit probes | Existing list/native metrics/history APIs; deleting reproduces position and acknowledgement logic in callers |
| `features/conversation/turns/*`, `protocol/*`, `content/*` | Turn activity/streaming/footer; dispatch of protocol render blocks; bounded output/disclosure/full-content viewing | Generic markdown/code/media renderers retained. No transport state machine; deleting loses presentation transformations and lazy-output behavior |
| `features/composer/ComposerFeature.tsx`, `draft.ts`, `submission.ts`, `settings.ts`, `suggestions.ts` | Draft editing, selection/native editor handle, submit/rollback, model/effort/permissions/personality/skills and scoped pending controls | Persisted ThreadUiState, delivery model and native input adapters retained; deleting loses exactly-once local admission/recovery and draft policy |
| `features/composer/attachments/*`, `queueEdit.ts`, `voice.ts` | Upload admission/large paste/attachment recovery; queue-edit editor scope; voice-to-current-draft binding | FileTransferController, composerUploads and VoiceInputController remain sole operational owners. This feature does not duplicate capture/upload state |
| `features/queue/QueueFeature.tsx`, `queueActions.ts` | Queue list/inline projection and cancel/move/steer controls; offers edit intent to composer | Queue server/delivery state retained. Composer owns transient editor content; queue does not mirror it |
| `features/requests/RequestFeature.tsx`, `requestResponse.ts` | Approval/user-input/MCP elicitation form, validation and response pending/rejection | Pending request database and protocol DTOs retained; deleting loses request-specific response policy |
| `features/goal/GoalFeature.tsx`, `goalEditor.ts` | Goal editor/resource read/set/clear and goal chip | Existing goal row/controller semantics retained; no optimistic server goal |
| `features/turnActions/ThreadActions.tsx`, `turnActions.ts` | Rename/archive/unarchive/delete/pin/read/fork/interrupt/compact and review-start intent | Shared thread mutations are capability calls; list and header consume the same public action owner |
| `features/attachments/AttachmentsFeature.tsx`, `documentNavigation.ts`, `attachmentPreview.tsx` | Attachment list, document stack, private image/video/document opening and annotation intent | Existing private asset/preview/rendering resource/cache owners retained. Preview closure aborts ephemeral reads under the current resource contract |
| `features/changes/ChangesFeature.tsx`, `changePresentation.ts` | Session/turn change scopes, diff/source/split preference, recorded-turn changes and code-document intent | ThreadResourcesModel and diff retrieval authority retained; deleting loses changes selection and per-thread presentation policy |
| `features/review/ReviewFeature.tsx`, `reviewSubmission.ts` | Code/content comment sessions, serialization and submission result; review-start target/delivery form | Shared rendering selection/highlight host and format contracts retain their proven cross-renderer ownership; CodeReviewWorkspace and feature integration move. Composer receives prepared attachment content and owns admission |
| `features/drawing/DrawingFeature.tsx`, `drawingAttachment.ts` | Drawing/annotation session, commit/snapshot/PNG conversion and result handoff | Existing drawing native implementation and upload capability retained; only close after accepted commit as currently implemented |
| `features/agents/AgentsFeature.tsx`, `agentSelection.ts` | Subagent list/projection/selection/opening, child conversation scope and sheet lifetime | Existing summary/detail databases retained. Subagent child renders the public conversation **detail/turn** surface without recursively mounting the full tools composition |
| `features/terminal/TerminalFeature.tsx`, `backgroundTerminals.tsx` | Interactive tab create/select/open/close and background process list/terminate | Existing native terminal store/controller retained; overlay dismissal and explicit close remain distinct |
| `features/ports/PortsFeature.tsx`, `browserNavigation.ts` | Native port forward manager adaptation, tunnel create/revoke, loopback parsing/opening and browser/feedback session | Existing forwarding store/native/browser implementations retained; runtime ports are not duplicated per chat |
| `features/diagnostics/DiagnosticsFeature.tsx`, `renderRecovery.ts` | Diagnostic UI/recovery-thread action and experiment presentation | Metrics collection/batching stays data/native-owned, never moved into render |

`features/conversation` contains several **named internal owners**, not one replacement `useConversation` hook. `ConversationWorkspace` may compose siblings' public surfaces; `ConversationDetail`, timeline and turn modules cannot import the full workspace, composer, agents or tools. This breaks the otherwise likely agents -> conversation -> agents cycle.

## Runtime facade closure

The complete [runtime/data ownership contract](../apps/android/src/data/CONTEXT.md) preserves the separate JS startup and native boot-handle lifetimes and assigns every facade field. Feature adapters consume lower owners; their creation cannot relocate caches to component lifetime. All four draft/attachment/preferences/scroll seed callers share one lower initialization operation.

## Feature action mapping

| Existing `RemoteWorkspace` methods | Feature owner; retained authority |
| --- | --- |
| `retryStartup` | Workspace readiness capability; runtime lifecycle |
| `addConnection`, `deleteConnection`, `setConnectionEnabled`, `reconnectConnection`, `updateConnectionProfile`, `updateConnection`, `moveConnection` | Connections adapter; connection/session runtime |
| `searchThreads`, `searchMessages`, `searchConversation` | Search adapter; existing mounted search resources/session and native queries. The unmounted standalone context screen/capability is removed during final closure |
| `listProjects`, `addProject`, `setProjectPinned`, `readDirectory`, `readProjectHome`, `inspectWorkspace`, `createWorkspace`, `startThreadInWorkspace`, `startThread` | Projects/new-chat adapter; existing workspace creation/idempotent command behavior |
| `setThreadPinned`, `renameThread`, `archiveThread`, `unarchiveThread`, `deleteThread`, `markThreadRead`, `interruptTurn`, `forkThread`, `compactThread` | Turn-actions public capability, consumed by list/header/timeline; lower summary/detail/session authority |
| `loadDraft`, `saveDraft`, `loadDraftAttachments`, `saveDraftAttachments`, `upsertDraftAttachment`, `removeDraftAttachment`, `loadComposerPreferences`, `saveComposerPreferences` | Composer adapter; ThreadUiState database and owner checks |
| `loadScrollOffset`, `saveScrollOffset` | Conversation timeline adapter; same ThreadUiState persisted anchor contract |
| `listQueuedPrompts`, `editQueuedPrompt`, `cancelQueuedPrompt`, `moveQueuedPrompt`, `steerQueuedPrompt` | Queue adapter/public editor capability; command delivery owner. Composer uses the edit capability, not queue internals |
| `listBackgroundTerminals`, `terminateBackgroundTerminal` | Terminal adapter; existing terminal resource/native authority |
| `readThread`, `observeThread`, `loadTurnItems`; internal `repairThreadProjection`, `loadOlderTurns`, `loadNewerTurns`, `loadTurnsBefore` | Shared thread-sync runtime; conversation/agents read through current detail models, no duplicate per-feature history protocol |
| `refreshSubagents`; internal `refreshThreadCatalog` | Catalog runtime; agents/list capabilities retain current source and retention rules |
| `loadThreadResources`, `loadThreadChangeDiff` | Shared thread-resource loader; changes/attachments adapters expose narrow kind/scope requests |
| `startVoiceTranscription` | Shared voice transport; composer and review bind existing VoiceInputController |
| `sendText`, `retryFailedMessage` | Composer submission/turn retry adapter over shared command-delivery authority; browser feedback/recovery-thread use the same capability |
| `loadTurnControls`, `updateThreadSettings` | Composer settings adapter; same resource/freshness and mutation-generation rules |
| `getThreadGoal`, `setThreadGoal`, `clearThreadGoal` | Goal adapter; same goal row authority |
| `startReview` | Review adapter invoked by turn-actions intent; same V1 review target/delivery contract |
| `refreshAccountRateLimits`, `refreshAccountPool`, `startAccountLogin`, `cancelAccountLogin`, `activateAccountProfile`, `updateAccountProfile`, `removeAccountProfile` | Accounts adapter and usage resource; same database/session |
| `createLocalhostTunnel`, `revokeLocalhostTunnel` | Ports adapter; same V1 tunnel owner |
| `respondToServerRequest` | Requests adapter; pending request/delivery authority |
| `transferAccess` | Shared private-transfer/session capability; only scoped access exposed to consumers |

## Lifetime and cancellation matrix

| State/resource | Sole lifetime owner | Activation/change/close behavior to preserve |
| --- | --- | --- |
| JS workspace startup, databases, supervisor and JS subscriptions | Module-lifetime singleton; `data/workspace-runtime.ts` after move | Preserve module-evaluation startup, startPromise reuse/retry and existing replacement/failure cleanup; boot native stop is not JS teardown |
| Native legacy resource handle | Existing legacy route effect / boot runtime slot / native bridge | Preserve current native start/stop callbacks; no consolidation with JS startup or invented JS disposal |
| Shared thread UI-state initialization | `data/thread-ui-state-initialization.ts` | Composer draft/attachment/preferences and timeline scroll readers share the same keyed pending operation; identity-checked finally cleanup, independent of feature mount |
| Destination and selected search window | Navigation model | Atomic discriminated destination and generation; repeated selection keeps existing explicit reload path |
| Sidebar filters, project scope, offsets and paging | Thread-list/project feature model at workspace lifetime | Desktop list stays mounted across chat changes; no per-chat reset |
| Persisted draft/preferences/attachments | ThreadUiState database; composer capability | Restore before editing; normal draft and queued edit never mirror each other |
| Conversation local UI and retained callbacks | Existing activation guards, owned by conversation/composer instance | Reset before commit; old activation cannot mutate replacement even with same connection/thread |
| Submit rollback and model-setting rollback | Composer submission/settings owner | Original operation and generation decide restoration; navigation may restore old persisted draft only when no replacement owns it |
| Upload staging and large-paste operation | FileTransferController/composerUploads plus composer admission owner | Keep upload/editor scope, abort/current checks and owned attachment merge; cleanup clears current paste operation, not arbitrary native transfers |
| Voice capture/session/audio retry | VoiceInputController + voice transport | Workspace capture remains global; composer/review bind selected input. Finishing sends explicit final text; feature moving must not redefine discard/unbind semantics |
| History range and source witness | ThreadDetail/Chat/History models | Shared source-qualified ranges; stale reads/write authority rejected inside current write lane; no fetch effect |
| Timeline refs, timers, scroll memory, unread frame | Conversation timeline activation | Cleanup cancels retry/save/unread/trim handles, saves outgoing anchor, dismisses outgoing scope; fullscreen cover pauses paging/tail following but not keyboard geometry |
| Projection caches/disclosure history | Named timeline/turn module-level owners | Preserve WeakMap keys and bounded disclosure cache lifetime; no per-render construction |
| Queue list vs queue editor | Queue model vs composer editor | Server queue remains model-owned; cancellation of editor removes only editor uploads, preserving ordinary draft |
| Pairing sheet | Pairing open identity | Reset on next open, preserve closing animation contents; do not use remount key as reset |
| Account login/code copied state | Accounts interaction | Explicit close calls cancelAccountLogin. Unmount clears copied-code timer only at baseline; adding automatic server cancellation is a separate behavior change |
| Preview stack/full content read | Attachment/content overlay session | Ephemeral resource abort/eviction on last observer; retained cached resources keep their existing limits/retry policy |
| Review/drawing result | Review/drawing session; composer owns attachment admission | Only close on accepted result where current UI does so; stale result cannot attach into replacement composer |
| Interactive terminal tabs / native forwarding | Existing terminal/forwarding stores | UI overlay visibility is not process/session ownership. Explicit close/terminate/revoke retain current meaning |
| Subagent sheet and child destination | Agents feature | Child selection transitions; closing selection does not transfer state into main conversation; no recursion into full conversation tools |
| Diagnostics collection/flush | Existing data/native metrics owners | Render only consumes bounded display data; no new hot-path work or content logging |

## Source, schema and compatibility proof

## domain_source_proof_map

| Concept / classification | Owner and source/runtime entry | Durable/schema authority | Forbidden path and negative gate |
| --- | --- | --- | --- |
| Navigation destination / local discriminated state | navigation model via Workspace host | No durable wire schema; existing destination union | No route/V2 state takeover; main/subagent navigation semantic test |
| Conversation activation / lifecycle token | existing scope/owner hooks, exposed only to owning feature | No DTO/durable entity | No global latest-token workaround; stale same-scope remount test |
| Thread/turn/history / projections | data thread models through detail resource reads | V1 protocol plus existing database contracts | No feature-written canonical projection or witness logic; history semantic/authority tests |
| Composer draft / persisted record | composer editing through ThreadUiState | Existing native/web DB contract | No component copy/hydration effect; failed-send/new typing/remount tests |
| Delivery/queue / durable command status and read model | data command delivery, queue capability | Existing V1 native command persistence | No V2 operation status/no optimistic UI duplicate; command receipt/retry semantic test |
| Resource request / cache handle | existing model resource cache, feature-owned keys/intent | Existing resource row types | No per-render Promise/map or second cache; deduplication/abort/identity checks |
| Pairing/profile/account / validated input and snapshot | connection/accounts feature adapters | Existing profile/security/session contracts | No credentials in UI logging or new auth DTO; pairing/profile/platform tests |
| Voice/transfer/terminal / operational lifecycle | existing controllers/native owners | Existing V1 contracts | No UI-owned replacement session or automatic dispose-on-hide; lifecycle/native parity checks |
| Render block / display projection | conversation protocol rendering | Renderer/protocol modules | No `entities/` laundering or widened IO; rendering semantic and bounded-output tests |
| Shared View / presentation component | `src/presentation` | Display props/capabilities only | No V1/V2/model/native import; existing presentation dependency gate |

## Source/runtime/schema alignment

The wire source is unchanged; `@codewide/codex-protocol/v0.147.0/v2` in V1 source is a versioned upstream app-server DTO path, **not** the forbidden `@codewide/sync-client/v2` runtime. Do not ban it based on the substring `v2`. V1 sync-client package-root exports, native registrations and database filenames/schema migrations remain unchanged. Native/web/unsuffixed adapter compatibility is checked through all three TypeScript environments.

At the baseline revision, `RemoteWorkspace` type consumers included `browser/send-feedback.native.ts` and `.web.ts`, `data/thread-chat-projection.ts`, `data/thread-chat-timeline.ts`, `rendering/CodeReviewWorkspace.tsx`, `rendering/ContentReviewHost.tsx`, `search/GlobalSearchScreen.tsx` and the unmounted `search/SearchContextScreen.tsx`. Lower data types moved to lower contract owners (delivery/settings/resource types as appropriate); UI features did not become their dependencies. Final closure deleted the unmounted context screen and its unused standalone capability instead of preserving a public orphan.

## compatibility_surface_plan

| Surface | Decision / owner / end condition |
| --- | --- |
| `CodeWideScreen` public route export | **public_exception**: retain only stable composition entry; `app/legacy.tsx` remains its caller |
| Private screen symbols | **delete_now per migration unit** from old file when moved; update tests/imports in same unit; no re-export bridge from root |
| `useRemoteWorkspace` / broad types | **keep_temporarily** only for not-yet-migrated composition. Each completed feature has zero imports; remove after final consumer migrates. Runtime lifecycle implementation is retained at explicit lower owner |
| Feature-specific moved ui/rendering modules | **delete_now** old path once all actual consumers and platform siblings update; no blanket compatibility barrels |
| Existing genuinely shared ui/rendering/data/native modules | **public_exception** at current path with the explicit retained invariant and consumer evidence; no unnecessary path churn |
| Native/web/unsuffixed exports | **public_exception** as platform contracts, not deprecation. Preserve all runtime variants and type compatibility |
| Old source-string tests | **migrate per unit**, preserve behavioral intent at new owner or semantic seam. No concatenation trick to pretend the monolith still exists |

No expiry calendar is invented. The removal condition is the reviewable unit's closure and zero remaining consumers, verified including type imports and tests.

## Fake-module, naming and reviewer gates

Each proposed module must pass: name its invariant; identify its runtime caller; show the state/resource/error/cleanup it owns; explain what complexity returns to callers if deleted. A `Feature` file that merely forwards wide props or a folder containing only an adapter interface fails. Do not put snapshots in `entities`, label UI props domain entities, or call an arbitrary record a model-owned resource.

Negative gates after implementation:

- No private feature declarations or `StyleSheet.create` monolith remain in CodeWideScreen.
- No moved feature imports `RemoteWorkspace` or root source; no lower data/native -> feature edge; no cross-feature private/deep imports; no type-only cycles.
- No new model/transport duplication, hydration effect, per-render resource/Promise/cache construction, broad context or message-graph clone.
- No new V2 dependency, changed V1 database schema, protocol endpoint, native registration, boot route or navigation semantics.
- Feature lint coverage includes new paths and source-test requirements are accounted for; unused suppressions are not permitted.
- Architecture docs mark current/planned/completed honestly and match implementation, tests and runtime contracts. Green validation alone does not prove ownership or parity.

## Migration / PR slices

These are bounded source ownership units, not permission to implement or publish. Split a listed unit further if its diff cannot be reviewed without mixing invariants; keep the stated owner closure atomic. No calendar estimates are implied.

| Unit | Structural delta and dependencies | Rationale and acceptance | Validation / rollback |
| --- | --- | --- | --- |
| D0 documentation — complete | Approved six-path documentation package authored; source migration not started | Selected target, current-vs-planned owner map, complete migration/proof ledger; no application edits or empty feature scaffolds | `git diff --check`, validate doc links and manifest completeness. Revert only authored docs if rejected |
| M0 boundary coverage — implemented | Application implementation authorized. Extend presentation lint to `src/features/**`, add exact feature/dependency rule support and baseline source/test mapping; no feature behavior move | A probe under new path demonstrably receives the existing rule; lower->feature and V1->V2/type-cycle negative probes fail | `pnpm validate:android:v1` plus boundary tests. Remove probes and revert gate unit together if rejected; never loosen old rules |
| M1 connections/accounts/settings — implemented | M0; move pairing/profile/account/settings interactions and related UI with narrow existing runtime bindings | Pairing open/close retains content; explicit login cancel and copied-code timer unchanged; settings security/generation surfaces remain external owners | V1 gate; pairing/profile/account/app-lock/native-config contracts; actual pairing/settings UI smoke. Revert whole moved ownership unit, no data migration |
| M2 list/navigation/projects/search — implemented | M0; move stable list projections/filter/page/offset state, navigation model/host and existing named search/project behavior; M1 public connection actions if used | Desktop sidebar commits isolated; mobile back/server/project/search behavior; immediate main-chat reveal; new-chat draft and workspace choice preserved | V1 gate; list query, navigation model, new-chat workspace, search and transition tests; native/browser list smoke. Restore old composition and imports as one unit |
| M3 requests/goal/turn actions/queue list — implemented | M0; separate small action owners and shared lower mutation contracts before composer split | Responses show same pending/errors; goal edits retain validation; header/list mutations share implementation; queue order/steer preserved | V1 gate; request/goal/queue/delivery tests and UI smoke. Revert owner plus consumers, never reverse remote mutation automatically |
| M4 preview/changes/review/drawing/tools | M0, narrow attachment/result/turn-action contracts from M3 as needed; move attachments/change scope/review/drawing, ports/browser, terminal and agents as individually reviewable subunits | Fullscreen/back/scroll coverage, preview abort/stack, explicit terminal close vs hide, drawing commit, review result admission and subagent transition all preserved. No broad conversation imports |
| M4 validation/rollback | Each subunit is separately gated | Do not combine all tools in one giant patch. Each subunit includes its source UI family, private helpers/styles, typed capabilities and tests | V1 gate plus corresponding preview/browser/terminal/review/agents tests and native behavior smoke. Revert each subunit without deleting cached assets, sessions or drafts |
| M5 composer | M2–M4 capability contracts; split draft/settings/submission, queue editor, attachment admission/paste, suggestions and voice binding | Failed pre-admission send restores correct draft; new text is preserved; queue edit and normal draft independent; stale same-thread remount guarded; voice sends final transcript; no view remount reset | V1 gate and semantic composer/upload/voice/queue tests; native input/paste/voice smoke. Revert composer unit together with bindings, preserve durable rows |
| M6 conversation/timeline/rendering | M2–M5 interfaces; move detail, viewport/unread/history, turn/protocol/content modules and caches/styles | Same progressive restoration, keys/anchors/gesture trim/search/unread behavior, bounded output/native reveal; composer/header remain available during history load | V1 gate, history/projection/command-output/streaming tests, web render smoke, representative native performance comparison. Roll back whole changed owner, never purge history as a workaround |
| M7 runtime facade closure | Feature units complete; split existing lower subsystem closures, move remaining feature command adapters and explicitly assigned lower caches, delete `RemoteWorkspace` public aggregation | Preserve separate JS module startup and boot-native handle authorities, exact current teardown limits, and every field owner in the linked runtime context; no feature still imports facade; all type consumers moved to correct lower contracts | V1 gate plus runtime/command/history/platform tests, full `pnpm test`, JS import/startup/retry/reconnect smoke plus separate native handle start/stop smoke; verify feature remount/native stop does not add JS disposal. No wire/storage/native change; revert composition unit if parity fails |
| M8 final closure | M1–M7 | CodeWideScreen contains only composition; all manifest symbols/styles/actions have destinations; no old-path wrappers/cycles; local CONTEXT docs created with their actual modules; canonical docs match final graph | Full V1 gate + full tests + web platform/build checks where affected; applicable native behavior/performance evidence. Document remaining unverified device scenarios; do not claim release completion |

Every implementation unit runs `pnpm validate:android:v1`. Targeted regression files include `conversation-transition-parity.test.ts`, `codewide-effect-ownership.test.ts`, `thread-list-query-contract.test.ts`, `thread-history-pagination-contract.test.ts`, `composer-delivery-mode.test.ts`, `failed-message-retry.test.ts`, `inline-queue-overlay.test.ts`, `content-review.test.ts`, `document-preview.test.ts`, `terminal-integration.test.ts`, `internal-browser.test.ts`, `message-action-menu-ownership.test.ts` and corresponding real model tests. These source-coupled checks must move to owner-aware assertions while semantic test cases prove behavior. The exact test file list is resolved against HEAD per unit; deleting a requirement is not an accepted migration.

If a V2-owned route, boot/presentation source or V2 module must change, the relevant `pnpm validate:android:v2` gate applies; avoid expanding this V1 refactor into those paths. Native implementation changes require native validation and separate scope justification. Releases remain separate explicit actions using repository one-shot commands.

Performance acceptance is relative to a reproducible same-device/build baseline: open cached/cold thread; rapidly switch A/B/A with typing; search a distant turn; paginate both directions during drag/fling; stream a long response; open/close fullscreen review/terminal while IME is visible. Compare affected commits, object identity retention, native frame/scroll metrics and resident-resource behavior. Preserve current bounds/algorithms; investigate any material regression before accepting. Do not invent numerical thresholds without a measured envelope.

## Source mapping appendices

The following maps are generated from parsed declarations and observed source references at the baseline, then assigned to the named owners above. They include private types/constants, caches and helper functions as well as components. They are an architectural move manifest, not generated application code.

## A. Complete top-level screen declaration map

Coverage: **275 declared names**, each assigned once below. Overloaded giant components are explicitly decomposed; their internal ownership is in appendix B. Shared formatting/context contracts keep actual consumer semantics, not guessed equivalence to an existing function. Adding exports to an existing owner does not permit changing the function behavior.

| Target path / disposition | Exact old declarations and baseline lines |
| --- | --- |
| `features/navigation/serverSelection.ts` | `ALL_SERVERS_ID` (553) |
| `features/threadList/threadListModel.ts` | `THREAD_LIST_PAGE_SIZE` (554), `ThreadListRow` (3362), `SidebarProjectsNavigation` (3364), `useProjectSidebarThreads` (3376), `sidebarRowKey` (3431), `THREAD_LIST_ROW_CONTENT_HEIGHT` (3437), `THREAD_LIST_ROW_VERTICAL_MARGIN` (3438), `THREAD_LIST_ROW_HEIGHT` (3439), `THREAD_LIST_SECTION_HEIGHT` (3440), `threadListRowHeight` (3442), `ThreadListMode` (3447), `threadListRowsEqual` (3449) |
| `features/agents/agentSelection.ts` | `SUBAGENT_LIST_LIMIT` (555), `subagentThreadListItem` (16596) |
| `features/threadList/SidebarSectionHeader.tsx` | `SidebarSectionHeader` (3414) |
| `features/connections/ConnectionActivityIndicator.tsx` | `ConnectionActivityIndicator` (3287) |
| `features/connections/connectionPresentation.ts` | `ServerStatus` (557), `ThreadListServer` (559), `ThreadServerProjection` (1658), `ConnectionActivity` (3275), `connectionActivity` (3277), `connectionActivityColor` (3283), `connectionStateLabel` (3324), `connectionStateColor` (3334), `connectionDiagnosticSummary` (3341), `connectionDiagnosticTime` (3353), `serverGlyph` (16481) |
| `features/threadList/threadListTypes.ts` | `ThreadListItem` (569) |
| `features/conversation/turns/disclosureState.ts` | `COLLAPSED_BODY_CHARS` (582), `persistentExpansionStates` (629), `PERSISTENT_EXPANSION_STATE_LIMIT` (630), `writePersistentExpansionState` (654), `textFingerprint` (16409) |
| `features/conversation/content/contentLimits.ts` | `EXPANDED_BODY_CHARS` (583), `CONTENT_VIEW_CHUNK_BYTES` (13103) |
| `features/conversation/protocol/ToolContent.tsx` | `TOOL_RESULT_MAX_HEIGHT` (584), `ToolCallProtocolBlock` (14015), `ToolCallProtocolDetails` (14039), `ToolCallResultContent` (14078), `ToolRichContent` (14138), `toolTextNeedsCodeViewport` (14275), `containsTerminalControlSequences` (14287), `ToolResourceLink` (14291) |
| `features/conversation/turns/TurnFooter.tsx` | `TURN_FOOTER_MIN_HEIGHT` (585), `TurnFooterProps` (12614), `TurnFooter` (12623) |
| `features/conversation/turns/UserMessageContent.tsx` | `USER_MESSAGE_COLLAPSED_LINES` (586), `USER_MESSAGE_COLLAPSED_CHARS` (587), `UserMessageContentProps` (14494), `UserMessageContent` (14502), `CollapsibleUserMessageProps` (14580), `CollapsibleUserMessage` (14586), `userMessageAttachmentReference` (14634), `UserImageGallery` (14642) |
| `features/composer/composerLayout.ts` | `COMPOSER_MIN_HEIGHT` (588), `COMPOSER_CHIP_TOP_INSET` (590), `COMPOSER_CHIP_BOTTOM_INSET` (591), `COMPOSER_MAX_HEIGHT` (592) |
| `features/turnActions/turnActions.ts` | `copySessionId` (594) |
| `features/composer/draft.ts` | `EMPTY_COMPOSER_PREFERENCES` (599), `EMPTY_COMPOSER_ATTACHMENTS` (607) |
| `features/conversation/timeline/historyAnchor.ts` | `LATEST_TIMELINE_THRESHOLD_PX` (608), `sessionConversationHistoryAnchors` (609) |
| `features/conversation/turns/turnContexts.tsx` | `ForceExpandCardsContext` (613), `ActiveToolCallContext` (614), `TurnActivityContentContext` (615), `TurnUsageContext` (616), `ExpansionItemKeyContext` (617), `ThreadCwdContext` (618) |
| `features/conversation/turns/turnContexts.tsx (injected public navigation callback)` | `SubagentNavigationContext` (619) |
| `features/conversation/content/contentViewerContext.ts` | `LargeContentViewerRequest` (620), `LargeContentViewerContext` (626) |
| `features/search/searchDelay.ts` | `abortableDelay` (632) |
| `features/composer/composerTypes.ts` | `ComposerMenuPage` (664), `QueuedComposerEdit` (673), `ComposerAccessoryAction` (678) |
| `features/changes/changePresentation.ts` | `ChangesDisplayMode` (679), `ChangesPreferences` (680), `changesPreferencesByThread` (686), `readChangesPreferences` (688), `recordedTurnChangeResources` (8882), `recordedTurnChangeDiff` (8914), `recordedTurnResourcesValue` (8939) |
| `features/composer/settings.ts` | `executionPermissionsLabel` (692), `permissionProfileLabel` (722), `EMPTY_TURN_CONTROLS` (958) |
| `features/changes/ThreadResourceContextChips.tsx` | `ThreadResourceContextChips` (786) |
| `features/connections/pairing.ts` | `pairingParseResult` (937), `pairingEndpointLabel` (15399) |
| `features/workspace/useWindowLayout.ts` | `useWindowLayout` (950) |
| `features/conversation/timeline/timelineTypes.ts` | `TimelineItem` (965) |
| `features/conversation/timeline/ThreadTimelineNavigationCommit.tsx` | `ThreadTimelineNavigationCommit` (994) |
| `DELETE omnibus props; each feature declares its own public contract` | `ConversationPaneProps` (1105) |
| `features/conversation/conversationCapabilities.ts` | `ConversationDestinationBaseProps` (1107) |
| `features/conversation/ConversationDetail.tsx` | `MainConversationDetailProps` (1122), `MainConversationDetail` (1133), `NewConversationDetailProps` (1402), `NewConversationDetail` (1408), `ConversationDestinationProps` (1436) |
| `features/conversation/ConversationDestination.tsx` | `ConversationDestination` (1454) |
| `features/conversation/ConversationNavigationBoundary.tsx` | `ConversationNavigationLoader` (1462), `ConversationNavigationFallback` (1503) |
| `features/conversation/timeline/timelineProjection.ts` | `timelineRowCache` (1543), `optimisticTimelineRowCache` (1547), `projectOptimisticTimelineItem` (1552), `projectTimelineTurns` (1575), `timelineItemKey` (1598), `projectTimelineDateLabels` (1604), `timelineItemTimestampMs` (1627), `timelineSearchTextCache` (1633) |
| `features/threadList/scrollOffsetMemory.ts` | `ScrollOffsetMemory` (1635) |
| `features/threadList/threadListProjection.ts` | `ThreadListItemProjection` (1646), `ThreadListScopeProjection` (1687), `firstLine` (16418), `deduplicateThreadSummaries` (16568), `storedThreadToListItem` (16574) |
| `features/ports/nativeForwardingAdapter.ts` | `nativePortForwardingManagerProps` (1720) |
| `CodeWideScreen.tsx (retain composition only)` | `CodeWideScreen` (1846) |
| `features/workspace/WorkspaceScreen.tsx` | `CodeWideWorkspaceScreen` (1860) |
| `features/workspace/WorkspaceScreen.tsx (decompose; policy owners below)` | `CodeWideWorkspaceContent` (1883) |
| `features/navigation/conversationScope.ts` | `workspaceConversationScope` (2649) |
| `features/workspace/WorkspaceConversationProviders.tsx` | `WorkspaceConversationProviders` (2666) |
| `features/navigation/threadNavigation.ts` | `SelectWorkspaceThread` (2716) |
| `features/conversation/ConversationWorkspace.tsx (decompose detail/action bindings)` | `ActiveWorkspaceConversation` (2724) |
| `features/ports/ForwardedLoopbackBrowser.tsx` | `ForwardedLoopbackBrowser` (3236) |
| `features/threadList/ThreadSidebar.tsx` | `ThreadSidebar` (3477) |
| `features/threadList/SelectableThreadRow.tsx` | `SelectableThreadRow` (3729) |
| `features/threadList/ThreadListMenus.tsx` | `ThreadListMenu` (3741), `ThreadFilterMenu` (3800) |
| `features/threadList/ThreadListBoundary.tsx` | `ThreadListSuspenseFallback` (3900), `ThreadListExperimentSuspended` (3904) |
| `features/threadList/threadListFilters.ts` | `ThreadListFilter` (3913), `threadFilterOptions` (3915), `effectiveThreadListFilter` (3933), `threadFilterLabel` (3940), `threadMatchesFilter` (3947) |
| `features/threadList/ThreadRow.tsx` | `ThreadRow` (3955) |
| `features/diagnostics/ThreadNavigationCommit.tsx` | `ThreadRowCommitBoundary` (4258), `ThreadNavigationRowCommitBoundary` (4271) |
| `features/threadList/ThreadSwipeActions.tsx` | `THREAD_SWIPE_ACTION_WIDTH` (4293), `THREAD_SWIPE_UNDERLAY_OVERLAP` (4294), `THREAD_SWIPE_ACTIONS_WIDTH` (4295), `ThreadSwipeActions` (4297), `ThreadSwipeAction` (4305) |
| `features/threadList/MobileThreads.tsx` | `MobileThreads` (4346) |
| `features/projects/NewThreadFloatingButton.tsx` | `NewThreadFloatingButton` (4596) |
| `features/composer/voice/VoiceCaptureStatus.tsx` | `VoiceCaptureStatus` (4615) |
| `features/composer/settings/ComposerControlChips.tsx` | `ComposerControlChips` (4659) |
| `features/ports/ComposerPortContextChip.tsx` | `ComposerPortContextChip` (4810), `ComposerPortContextChipLoaded` (4821) |
| `features/terminal/ComposerTerminalContextChip.tsx` | `ComposerTerminalContextChip` (4855) |
| `features/agents/ComposerSubagentContextChip.tsx` | `ComposerSubagentContextChip` (4889), `ComposerSubagentContextChipLoaded` (4913) |
| `features/conversation/ConversationHistoryStatus.tsx` | `ConversationHistorySubtitle` (4959), `ConversationBackendRefreshIndicator` (4994), `ThreadHistoryLoadingIndicator` (5019), `ThreadHistoryEmptyState` (5043) |
| `DELETE ConversationPane after splitting owners; ConversationWorkspace composes` | `ConversationPane` (5070) |
| `features/attachments/documentNavigation.ts` | `ThreadResourceDocumentRoute` (8953) |
| `features/attachments/AttachmentsFeature.tsx` | `ThreadResourcesSheet` (8958) |
| `features/attachments/ThreadAttachmentResourceRow.tsx` | `ThreadAttachmentResourceRow` (9344) |
| `features/turnActions/ThreadActions.tsx` | `ThreadHeaderMenu` (9376) |
| `features/queue/QueueFeature.tsx` | `QUEUE_DRAG_ROW_STEP` (9582), `QueueDragHandle` (9584), `QueueManagerSheet` (9623) |
| `features/terminal/backgroundTerminals.tsx` | `BackgroundTerminalsSheet` (9767) |
| `features/goal/GoalFeature.tsx` | `ThreadGoalDialog` (9890) |
| `features/review/ReviewTargetSheet.tsx` | `ReviewSheet` (10073), `buildReviewTarget` (10225) |
| `features/composer/ComposerAccessoryTray.tsx` | `COMPOSER_ACCESSORY_ACTIONS` (10234), `ComposerAccessoryTray` (10247) |
| `features/composer/ComposerMenu.tsx` | `ResourceComposerMenu` (10299), `ComposerMenu` (10381), `pageTitle` (10777) |
| `features/requests/RequestFeature.tsx` | `ApprovalPrompt` (10788), `approvalTitle` (11082) |
| `features/ports/LocalhostPreview.tsx` | `LocalhostPreview` (11090), `localhostTargetPort` (11239) |
| `features/conversation/turns/Card.tsx` | `Card` (11260), `usePersistentExpansion` (11344) |
| `features/conversation/turns/MessageActionRail.tsx` | `CopyButton` (11364), `MessageActionRailProps` (11385), `MessageActionRail` (11389) |
| `features/conversation/turns/OptimisticTurn.tsx` | `OptimisticTurnProps` (11414), `OptimisticTurn` (11420) |
| `features/conversation/turns/turnProjection.ts` | `CachedTurnProjection` (11527), `projectTurnProjection` (11536), `preTurnBlockUsesDisclosure` (11573), `activitySegmentUsesDisclosure` (11577), `projectThreadItem` (12399), `completedActivityItemCount` (12409), `turnMetadataKinds` (12416), `turnActivityLabel` (12750), `turnMetadataBlocks` (16368) |
| `features/conversation/turns/TurnTimelineItem.tsx` | `TurnTimelineItem` (11590) |
| `features/conversation/turns/LiveAgentResponse.tsx` | `LiveContentMode` (11998), `StableLiveTextSegment` (12000), `AppendOnlyLiveContent` (12020), `LiveAgentResponse` (12088) |
| `features/conversation/turns/PreTurnLifecycleRows.tsx` | `PreTurnLifecycleRows` (12114) |
| `features/conversation/turns/CompletedTurnHistory.tsx` | `CollapsedTurnActivity` (12189), `CompletedTurnHistory` (12274) |
| `features/conversation/turns/TurnActivity.tsx` | `TurnActivitySegment` (12425), `TurnActivityProps` (12528), `TurnActivity` (12540) |
| `ui/CalmSpinner.tsx` | `CalmSpinner` (12717) |
| `features/conversation/protocol/ProtocolBlock.tsx` | `ProtocolBlock` (12772) |
| `features/conversation/protocol/CommandOutput.tsx` | `CommandExecutionProtocolBlock` (12967), `LazyCommandOutputProps` (13016), `LazyCommandOutput` (13024), `OutputFootprintMetric` (13085) |
| `features/conversation/content/AgentResponseMarkdown.tsx` | `AgentResponseMarkdown` (13105), `markdownSegmentsWeight` (13218), `CompleteAgentMarkdown` (13222) |
| `features/conversation/content/FullContentViewer.tsx` | `nextRenderFrame` (13261), `LargeContentViewerSelection` (13265), `LargeContentViewerHost` (13277), `LargeContentViewerSession` (13289), `LargeContentControls` (13341), `largeContentPresentation` (13389), `FullContentViewer` (13403), `contentPointerLabel` (13544), `formatContentBytes` (13551) |
| `features/conversation/protocol/UnknownProtocolBlock.tsx` | `UnknownProtocolBlock` (13557) |
| `features/conversation/protocol/TokenUsageProtocolBlock.tsx` | `TokenUsageProtocolBlock` (13608) |
| `features/conversation/protocol/ImageProtocolBlock.tsx` | `OpenableImage` (13656), `ImageProtocolBlock` (13749), `ImageProtocolContent` (13773), `ScopedRemoteImage` (13834), `ScopedPrivateAssetImage` (13863) |
| `features/conversation/protocol/FileChangeProtocolBlock.tsx` | `FileChangeProtocolBlock` (13930), `FileChangeProtocolDetails` (13946), `DiffFile` (13971) |
| `features/conversation/protocol/MemoryCitationList.tsx` | `MemoryCitationList` (14309) |
| `features/conversation/protocol/WebSearchProtocolBlock.tsx` | `WebSearchProtocolBlock` (14350), `WebSearchProtocolDetails` (14365) |
| `features/conversation/protocol/ToolContent.tsx` | `LazyJsonProtocolBody` (14416) |
| `features/conversation/protocol/AgentActivityProtocolBlock.tsx` | `AgentActivityProtocolBlock` (14420), `subagentActivityLabel` (14484) |
| `features/conversation/protocol/protocolCopyText.ts` | `protocolCopyText` (14737) |
| `features/conversation/protocol/ToolContent.tsx` | `ProtocolBody` (14766) |
| `features/projects/NewThreadServerSheet.tsx` | `NewThreadServerSheet` (14858) |
| `features/connections/ConnectionSheet.tsx` | `ConnectionSheet` (14917), `ConnectionSheetSession` (14969) |
| `features/connections/PairingQrScanner.tsx` | `PairingQrScanner` (15408) |
| `features/settings/SettingsFeature.tsx` | `SubscribedConnectionSettings` (15487), `ConnectionSettings` (15495) |
| `features/connections/ConnectionRowEditor.tsx` | `ConnectionRowEditor` (15666) |
| `features/accounts/AccountPoolFeature.tsx` | `AccountPoolEditor` (15990) |
| `features/conversation/protocol/protocolKind.ts` | `protocolIcon` (16334), `isToolActivityKind` (16347) |
| `data/device-time.ts` | `formatThreadTime` (16360), `formatClockTime` (16364) |
| `features/navigation/threadSelection.ts` | `threadSelectionKey` (16423), `parseThreadSelectionKey` (16427) |
| `ui/ThreadTitle.tsx` | `leadingEmoji` (16436), `emojiSafeTitle` (16443), `ThreadTitle` (16455), `RunningThreadTitle` (16477) |
| `rendering/changed-file-path.ts` | `basename` (16487) |
| `features/conversation/protocol/protocolValue.ts` | `recordValue` (16492), `numberValue` (16498) |
| `ui/number-format.ts` | `compactNumber` (16502), `formatDuration` (16508) |
| `features/composer/voice/voicePresentation.ts` | `formatVoiceDuration` (16518) |
| `features/conversation/turns/turnPresentation.ts` | `formatTurnMeta` (16522) |
| `data/thread-lifecycle.ts` | `activeTurnId` (16534) |
| `features/conversation/timeline/timelineSearch.ts` | `timelineSearchText` (16543) |
| `SPLIT styles by consuming owner; no global stylesheet export` | `styles` (16618) |
| `features/composer/ComposerMenu.tsx` | `ComposerMenuProps` (10297) |
| `ui/MenuAction.tsx` | `MenuAction` (10709) |
| `ui/ControlOption.tsx` | `ControlOption` (10739) |
| `ui/ResourceContextChip.tsx` | `ComposerContextLabel` (729) |
| `ui/ResourceContextChip.tsx` | `ComposerContextCount` (752) |

## B. Nested screen action ownership

The names below identify the existing operation bodies, not a new all-purpose controller. Their captured state, pending/error handling and cleanup move to the same owner.

| Existing owner / action family | New owner |
| --- | --- |
| Workspace: setActiveThreadId, selectThread, preloadThread, openSearchThread, selectServer, closeActiveConversation, workspaceConversationScope | `features/navigation/threadNavigation.ts / conversationScope.ts` |
| Workspace: loadMoreThreads, loadMoreProjectThreads, toggleListThreadPin, archiveListThread, unarchiveListThread, markListThreadRead; list/filter/project limits and ScrollOffsetMemory | `features/threadList/threadListModel.ts; shared mutations through turnActions public capability` |
| Workspace: openSidebarProject, closeSidebarProject, toggleSidebarProject, moveSidebarProject, addSidebarProject, defaultProjectCwd, createSidebarThread, openNewChat; active changeEmptyThreadProject, addActiveProject, readActiveDirectory | `features/projects/projectSelection.ts / newChat.ts` |
| Workspace: openGlobalSearch, closeGlobalSearch, searchSession, mobileRemoteSearchResource, abortableDelay | `features/search/searchWorkspace.ts; list gets typed results/status` |
| Workspace: sendFeedback, browserFeedback, loopbackBrowser / ForwardedLoopbackBrowser | `features/ports/browserNavigation.ts and browser feedback owner` |
| Workspace: openConnectionSheet, saveConnection, toggleConnection, reconnectSavedConnection, deleteSavedConnection, updateSavedConnection, moveSavedConnection | `features/connections/connectionActions.ts` |
| Workspace: createRepairThread, createUnsupportedFixThread, createRenderFailureFixThread; pending diagnostic experiment controls | `features/diagnostics/renderRecovery.ts` |
| Active conversation: forkCurrentThread, markActiveThreadRead, loadTurnChanges and on* binding families | `features/turnActions/turnActions.ts and feature-specific adapters; ConversationWorkspace only selects qualified scope` |
| Conversation: setChangesPreferences, currentThreadResources, currentChangePresentation, presentTurnChanges, openCodeDocument | `features/changes/changePresentation.ts / ChangesFeature.tsx` |
| Conversation: openThreadResources, closeThreadResources, getStableTransferAccess, openDocumentLinkFromCwd, openThreadDocumentLink | `features/attachments/documentNavigation.ts / attachmentPreview.tsx; scoped private access remains lower owner` |
| Conversation: currentControlsResource, requestControls, updateComposerPreferences, selected model/effort/personality/permissions, mutation generations, openControls/closeControls, quick controls, selectModel/selectEffort/selectPermissions | `features/composer/settings.ts / ComposerMenu.tsx` |
| Conversation: thread search state, focusSearchMessage, positionSearchTurn, scrollToThreadSearchIndex, restoreThreadSearchOrigin, updateThreadSearch, closeThreadSearch, moveThreadSearch | `features/conversation/timeline/timelineSearch.ts; selected global SearchConversationWindow stays navigation-owned` |
| Conversation: onTimelineFirstVisibleItemChanged, loadOlderAtTimelineStart, loadNewerAtTimelineEnd, cancelScheduledPaginationTrim, trimPaginationWindow, schedulePaginationWindowTrim, reportHistoryViewport | `features/conversation/timeline/timelineViewport.ts` |
| Conversation: initialHistoryRestore, currentHistoryAnchor, persistTimelineOffset, persistTimelineAtEnd, commitInitialTimelineLoad, mayFinishLatestJump, completeLatestJump, jumpTimelineToLatest, clearTimelineRuntime, cleanUpTimeline | `features/conversation/timeline/historyAnchor.ts / timelineViewport.ts` |
| Conversation: acknowledgeUnreadReceipt, checkUnreadAgentVisibility, scheduleUnreadAgentVisibilityCheck, commitUnreadReceipt, setLatestUnreadAgentNode and unread refs | `features/conversation/timeline/unreadReceipt.ts` |
| Conversation: fullscreenScrollOwnership, fullscreenOverlayLifecycle, dismissComposerKeyboardForOverlay, handleAndroidBack | `features/conversation/timeline/overlayScrollOwnership.ts and navigation back capability; overlay implementation remains ui/AppFullscreenOverlay` |
| Conversation: renderTimelineItem, fixUnsupportedBlock, forkThroughTurn, loadStableTurnItems | `features/conversation/timeline/ThreadTimeline.tsx; callbacks injected from diagnostics/turnActions/model owners` |
| Conversation: updateDraft, persistAttachments, updateAttachments, composer seed, editor refs/selection, latest values, clearComposerText | `features/composer/draft.ts; stored state remains ThreadUiState` |
| Conversation: send, handleDeliveryAction, activatePrimaryAction, steerComposer, discardComposer and sent-content-review acknowledgement | `features/composer/submission.ts` |
| Conversation: closeInlineQueueOverlay, toggleInlineQueueOverlay; clearQueuedComposerUploads, cancelQueuedComposerEdit, beginQueuedComposerEdit, saveQueuedComposerEdit | `features/queue/QueueFeature.tsx owns overlay list; features/composer/queueEdit.ts owns edit state and submission` |
| Conversation: stageAttachment, uploadSelectedAttachment, pickComposerAttachment, clearLargePasteOperation, flushLargePasteCapture, handleComposerLargePaste | `features/composer/attachments/attachmentAdmission.ts / largePaste.ts` |
| Conversation: insertSkillInvocation, searchComposerSuggestions, selectComposerMention, handleComposerTextChange, handleComposerMarkdownChange | `features/composer/suggestions.ts and draft.ts` |
| Conversation: openProjectPicker, closeProjectPicker, selectProject and picker busy/error state | `features/projects/composerProjectSelection.ts` |
| Conversation: openThreadRename, closeThreadRename; respondToRequest; openGoalDetails | `features/turnActions/ThreadActions.tsx; features/requests/requestResponse.ts; features/goal/GoalFeature.tsx respectively` |
| Conversation: currentSubagentSummaries, openSubagents, subagent projection and selection | `features/agents/agentSelection.ts` |
| Conversation: presentTerminal, openTerminal, createAndOpenTerminal | `features/terminal/terminalActions.ts` |
| Conversation: attachCodeReview, attachContentReview, contentReviewAttachmentIds, clearContentReviewAttachmentId | `features/review/reviewSubmission.ts prepares content; features/composer/attachments/reviewAdmission.ts owns draft attachment ID admission/acknowledgement` |
| Conversation: commitDrawing, presentDrawing, openDrawing, annotateImage | `features/drawing/drawingAttachment.ts / DrawingFeature.tsx; result admission through composer attachment capability` |
| Conversation: bindVoiceController, finishVoice, retryVoice, toggleVoice, discardVoice, microphone access | `features/composer/voice.ts; shared controller/transport unchanged` |
| Conversation: openAccessoryAction, handleAnchoredComposerAction, anchoredComposerActions | `features/composer/ComposerAccessoryTray.tsx emits typed intent; ConversationWorkspace binds public feature activations only` |

## C. Existing source module dispositions and consumers

All platform siblings and local type/style files of a moved family move atomically. Paths below are exact module stems; source extensions remain unchanged. The generated consumer column lists static V1 source imports, excluding V2, at this baseline; test paths are listed separately below. No caller is allowed to retain an old import through an unowned re-export.

| Old stem/family | New owner stem | Observed V1 source consumers |
| --- | --- | --- |
| `ui/InlineQueueOverlay` | `features/queue/InlineQueueOverlay` | `CodeWideScreen.tsx` |
| `ui/ThreadRenameDialog` | `features/turnActions/ThreadRenameDialog` | `CodeWideScreen.tsx` |
| `ui/SubagentSheet` | `features/agents/SubagentSheet` | `CodeWideScreen.tsx` |
| `ui/SubagentWorkspace` | `features/agents/SubagentWorkspace` | `ui/SubagentSheet.tsx` |
| `ui/DrawingWorkspace` | `features/drawing/DrawingWorkspace` | `CodeWideScreen.tsx` |
| `ui/PortForwardingManager` | `features/ports/PortForwardingManager` | `CodeWideScreen.tsx` |
| `ui/ProjectPickerSheet` | `features/projects/ProjectPickerSheet` | `CodeWideScreen.tsx` |
| `ui/TerminalWorkspace` | `features/terminal/TerminalWorkspace` | `CodeWideScreen.tsx` |
| `ui/InternalBrowser` | `features/ports/browser/InternalBrowser` | `CodeWideScreen.tsx` |
| `ui/SkillsPicker` | `features/composer/skills/SkillsPicker` | `CodeWideScreen.tsx` |
| `ui/SettingsSheet` | `features/settings/SettingsSheet` | `CodeWideScreen.tsx` |
| `ui/SettingsVersion` | `features/settings/SettingsVersion` | `CodeWideScreen.tsx` |
| `ui/PerformanceDiagnostics` | `features/diagnostics/PerformanceDiagnostics` | `CodeWideScreen.tsx` |
| `ui/WorkspaceConversationHost` | `features/navigation/ConversationHost` | `CodeWideScreen.tsx` |
| `ui/ComposerDeliveryMenu` | `features/composer/ComposerDeliveryMenu` | `CodeWideScreen.tsx`, `ui/ComposerDeliveryMenu.web.tsx`, `ui/ComposerDeliveryMenu.native.tsx` |
| `ui/ComposerMarkdownInput` | `features/composer/input/ComposerMarkdownInput` | `CodeWideScreen.tsx`, `ui/ComposerMarkdownInput.web.tsx`, `ui/ComposerMentionInput.native.tsx`, `ui/ComposerMarkdownInput.native.tsx` |
| `ui/ComposerEditorTrial` | `features/composer/input/ComposerEditorTrial` | Family/indirect sibling: move with its named owning family |
| `ui/ComposerEditorTrialEntry` | `features/composer/input/ComposerEditorTrialEntry` | `CodeWideScreen.tsx` |
| `ui/ComposerMentionInput` | `features/composer/input/ComposerMentionInput` | `ui/ComposerMentionInput.native.tsx`, `ui/ComposerEditorTrial.native.tsx` |
| `ui/ComposerSuggestionsPopup` | `features/composer/input/ComposerSuggestionsPopup` | `ui/ComposerMarkdownInput.native.tsx` |
| `ui/composer-mentions` | `features/composer/input/composer-mentions` | `CodeWideScreen.tsx`, `ui/composer-skill-suggestions.ts`, `ui/ComposerMarkdownInput.native.tsx`, `ui/ComposerMarkdownInput.types.ts`, `ui/composer-editor-trial.ts`, `ui/composer-suggestions.ts`, `ui/ComposerSuggestionsPopup.tsx` |
| `ui/composer-skill-suggestions` | `features/composer/skills/composer-skill-suggestions` | `CodeWideScreen.tsx` |
| `ui/ThreadGoalChip` | `features/goal/ThreadGoalChip` | `CodeWideScreen.tsx` |
| `ui/LiveTurnPlanPopover` | `features/goal/LiveTurnPlanPopover` | `CodeWideScreen.tsx` |
| `ui/WorkspaceAccountUsagePopover` | `features/accounts/WorkspaceAccountUsagePopover` | `CodeWideScreen.tsx` |
| `ui/UsagePopover` | `features/accounts/UsagePopover` | `CodeWideScreen.tsx`, `ui/WorkspaceAccountUsagePopover.tsx` |
| `ui/AccountUsageRow` | `features/accounts/AccountUsageRow` | `ui/UsagePopover.tsx` |
| `ui/SessionUsageDetails` | `features/accounts/SessionUsageDetails` | `ui/UsagePopover.tsx` |
| `ui/CostBreakdownPopover` | `features/accounts/CostBreakdownPopover` | `CodeWideScreen.tsx` |
| `rendering/CodeReviewWorkspace` | `features/review/CodeReviewWorkspace` | `CodeWideScreen.tsx` |
| `rendering/code-review-files` | `features/review/code-review-files` | `CodeWideScreen.tsx`, `rendering/CodeReviewWorkspace.tsx` |
| `data/thread-navigation-model` | `features/navigation/threadNavigation` | `CodeWideScreen.tsx`, `ui/WorkspaceConversationHost.tsx` |
| `data/use-composer-latest-values` | `features/composer/useComposerLatestValues` | `CodeWideScreen.tsx` |
| `data/composer-mutation-recovery` | `features/composer/submissionRecovery` | `CodeWideScreen.tsx` |
| `data/composer-model-settings` | `features/composer/modelSettings` | `CodeWideScreen.tsx` |
| `data/composer-paste-attachment` | `features/composer/attachments/largePasteCapture` | `CodeWideScreen.tsx` |
| `data/goal-editor` | `features/goal/goalEditor` | `CodeWideScreen.tsx` |
| `data/elicitation-form` | `features/requests/elicitationForm` | `CodeWideScreen.tsx` |
| `data/pairing-error` | `features/connections/pairingError` | `CodeWideScreen.tsx` |
| `data/connection-diagnostic-report` | `features/connections/connectionDiagnosticReport` | `CodeWideScreen.tsx` |
| `ui/SidebarProjects` | `features/projects/SidebarProjects` | `CodeWideScreen.tsx` |
| `data/sidebar-projects` | `features/projects/sidebarProjects` | `CodeWideScreen.tsx`, `data/sidebar-rows.ts`, `ui/SidebarProjects.tsx` |
| `data/use-sidebar-project-order` | `features/projects/useSidebarProjectOrder` | `CodeWideScreen.tsx` |
| `data/sidebar-project-order` | `features/projects/sidebarProjectOrder` | `CodeWideScreen.tsx`, `data/use-sidebar-project-order.ts` |
| `data/use-remote-project-catalog` | `features/projects/useRemoteProjectCatalog` | `CodeWideScreen.tsx` |
| `data/new-thread-routing` | `features/projects/newThreadRouting` | `CodeWideScreen.tsx` |
| `data/sidebar-rows` | `features/threadList/sidebarRows` | `CodeWideScreen.tsx` |
| `data/thread-list-projection` | `features/threadList/summaryProjection` | `CodeWideScreen.tsx` |
| `ui/SidebarListFeedback` | `features/threadList/SidebarListFeedback` | `CodeWideScreen.tsx` |
| `data/composer-delivery-mode` | `features/composer/deliveryMode` | `CodeWideScreen.tsx` |

Specific closure rules discovered from consumers:

- `search/SearchMessageFocus.tsx` is a real shared rendering primitive imported by `rendering/NativeMarkup.tsx`, `RichMarkdown.tsx` and `NativeCodeBlock.tsx`. Move it to **`rendering/SearchMessageFocus.tsx`**, not into the private search feature. Move the other `src/search/` session/query/screens as a cohesive `features/search/` zone, updating navigation and tests. This avoids a generic renderer -> feature back-edge.
- Move the existing `src/browser/` behavior family into **`features/ports/browser/`**, with InternalBrowser platform variants. Browser feedback submission receives narrow thread/delivery capabilities; no RemoteWorkspace import survives.
- `ui/VoiceInputRuntime.tsx` remains a **V1 shared input-scope synchronization owner**, used by workspace/composer and review; it is not protocol-neutral presentation and does not migrate into composer. `VoiceAura`, `WorkspaceVoiceAura`, microphone/platform hooks and conversation ownership hooks keep their existing shared operational contracts.
- **Retain** `rendering/ContentReviewHost`, `rendering/ThreadCodeDocumentContext`, `rendering/code-review` and `rendering/content-review`. Their real consumers include DocumentPreviewHost, MessageAttachmentCard, ComposerAttachmentTray, MermaidDiagram native/web, CodeReviewEditor native/web, code-review-bridge, RichMarkdown, ReviewableText, ImagePreviewHost, MarkdownDocumentView and HeroUIRoot native/web. They own shared rendering selection/highlights/comment format and host lifetime; moving them wholesale into features/review would create forbidden renderer/root -> feature back-edges. Feature review owns session activation/submission and CodeReviewWorkspace; the shared rendering host retains its existing placement and public capability contract. Its voice type imports move directly to data/voice-input-controller, not a feature type.
- Move `ui/composer-suggestions.ts` to `features/composer/input/composer-suggestions.ts` and `ui/composer-editor-trial.ts` to `features/composer/input/composer-editor-trial.ts` with the input family: they import moved composer-mentions and are feature-specific. Update their existing consumer imports atomically.

The project policy audit closes the whole family: `SidebarProjectsSheet` owns server choice, pinned/recent/other sections, expansion, pending/error and project action flow (`ui/SidebarProjects.tsx:160–255`); its views and sheet move together into projects. The ordering hook and pure ordering policy move together; the existing `data/user-preferences-database` stays the physical storage owner, preserving the `sidebar-project-order` preference key, JSON contents and other-server order retention. `sidebarProjects` is the public projects projection consumed by thread-list `sidebarRows`; expose that narrow contract rather than a private view type. Thread list owns row grouping, its cached summary projection and delayed loading/empty/error feedback. Project catalog demand/retention is a projects binding over the retained `remote-project-catalog-model`, and new-chat server choice is projects policy. The same audit identified composer send-mode choice as composer interaction policy, so it moves too.

Remaining direct imports are **retained at their explicit existing owner**, with no blanket claim that all are universally shared. The retained categories are existing database/resource/authority mechanisms, platform contracts, rendering primitives and small reusable transformations. Some are currently single-consumer mechanisms; consumer count alone neither requires moving a physical resource owner nor proves generic ownership. Feature interaction, selection, pending/error and persistence-binding policy must follow the feature; the concrete project/list/composer corrections above apply this distinction. The exhaustive remainder records retained implementation placement without creating a second copy:

- **data/**: `data/thread-current-outcome`, `data/catalog-summary-model`, `data/thread-fork`, `data/thread-pagination`, `data/use-thread-history-controller`, `data/use-thread-history`, `data/thread-history-telemetry`, `data/thread-history-model`, `data/thread-history-anchor`, `data/use-thread-chat-window`, `data/use-thread-ui-state`, `data/composer-uploads`, `data/use-thread-resources`, `data/thread-resources-model`, `data/use-deep-link-listener`, `data/second-clock`, `data/thread-chat-model`, `data/thread-chat-projection`, `data/thread-load-status`, `data/thread-partitions`, `data/thread-cache`, `data/thread-detail-database`, `data/thread-summary-database`, `data/use-thread-summary-view`, `data/subagent-projection`, `data/thread-projects`, `data/remote-projects`, `data/voice-draft`, `data/connection-validation`, `data/account-rate-limits`, `data/account-pool`, `data/device-time`, `data/deep-link`, `data/operational-metrics`, `data/thread-navigation-metrics`, `data/performance-experiments`, `data/workspace-creation`, `data/native-port-forwarding-store`, `data/interactive-terminal-store`, `data/thread-lifecycle`, `data/connection-profile-types`, `data/pending-request-types`, `data/thread-summary-types`, `data/thread-delivery-state`, `data/thread-ui-state-types`, `data/workspace-resource-database`, `data/use-workspace-resource-row`, `data/voice-input-controller`, `data/file-transfer-controller`, `data/attachment-upload`, `data/quickdraw-attachment`, `data/quickdraw-image`, `data/quickdraw-image-source`, `data/private-transfer`, `data/thread-chat-timeline`, `data/account-rate-limits-database`, `data/thread-list-account-usage`.
- **native/**: `native/native-transport`, `native/large-paste`, `native/performance-metrics`, `native/window-layout-store`, `native/file-transfer`.
- **rendering/**: `rendering/ComposerAttachmentTray`, `rendering/MessageAttachmentCard`, `rendering/MessageAttachmentTile`, `rendering/MessageFooterRow`, `rendering/TurnChangesFooter`, `rendering/TurnChangesContext`, `rendering/turn-changes`, `rendering/StreamingRevealSurface`, `rendering/FluidLayoutFrame`, `rendering/NativeRevealSurface`, `rendering/agent-artifacts`, `rendering/ArtifactImageReferences`, `rendering/RichMarkdown`, `rendering/RichContentLayout`, `rendering/ImagePreviewHost`, `rendering/DocumentPreviewHost`, `rendering/document-preview`, `rendering/MarkdownLinkHandler`, `rendering/loopback-link`, `rendering/NativeCodeBlock`, `rendering/AttachmentVideoPreview`, `rendering/change-menu`, `rendering/native-code-block`, `rendering/bounded-json`, `rendering/async-resource-store`, `rendering/command-output-resource`, `rendering/changed-file-path`, `rendering/file-change-rendering`, `rendering/image-source`, `rendering/live-text-stream`, `rendering/reasoning-title`, `rendering/rich-markdown-layout`, `rendering/live-turn-plan`, `rendering/thread-render-window`, `rendering/ThreadTimelineList`, `rendering/TimelineDateSeparator`, `rendering/timeline-identity`, `rendering/turn-sequence`, `rendering/Bubble`, `rendering/unread-visibility`, `rendering/user-message-normalizer`, `rendering/user-message-attachments`, `rendering/command-activity`, `rendering/use-private-image-uri`, `rendering/reduced-motion-store`.
- **ui/**: `ui/InlineIcon`, `ui/ConversationPanelUnderlay`, `ui/ThreadErrorBanner`, `ui/conversation-chrome-layout`, `ui/AppListRow`, `ui/AttachmentListRow`, `ui/AppListRow.styles`, `ui/AppListRow.types`, `ui/thread-list-layout`, `ui/AppLockGate`, `ui/MessageListBoundary`, `ui/AppSheet`, `ui/AppFullscreenOverlay`, `ui/fullscreen-scroll-ownership`, `ui/ActionMenu`, `ui/MessageActionMenu`, `ui/MessageActionMenu.types`, `ui/AppDialog`, `ui/use-microphone-access`, `ui/TurnControlMenus`, `ui/Typography`, `ui/VoiceInputRuntime`, `ui/WorkspaceVoiceAura`, `ui/WaveText`, `ui/SwipeDiscardAction`, `ui/token-display`, `ui/AnimatedNumber`, `ui/number-format`, `ui/RecoverableRenderBoundary`, `ui/render-recovery-prompt`, `ui/use-android-back-handler`, `ui/use-conversation-scope`, `ui/use-unmount`, `ui/CommitProbe`, `ui/use-conversation-owner`.
- **presentation/**: `presentation/input/searchLayout`, `presentation/icons/composeIconNames`, `presentation/layouts/windowLayout`, `presentation/conversation/timelineDates`.
- **boot/**: `boot/UiGenerationControl`, `boot/uiGenerationResource`.
- **react/**: `react/useEvent`.
- **root values**: `theme`, `turn-cost`.

Additional test consumer closure for the corrected policy moves: update `apps/android/test/sidebar-projects.render.test.tsx`, `sidebar-projects.test.ts`, `sidebar-project-order.test.ts`, `sidebar-list-feedback.render.test.tsx`, `thread-list-projection.test.ts`, `new-thread-routing.test.ts`, `composer-delivery-mode.test.ts` and the project-catalog path in `codewide-effect-ownership.test.ts` atomically with their respective M2/M5 owners. Preserve their current behavior assertions; the physical preference/catalog resource owners and persistence formats remain unchanged.

## D. Stylesheet ownership rule and complete key inventory

**488 style keys** are accounted for below. The entire `styles` object is deleted from the root at closure. For a key used by one target feature, move its declaration unchanged to that consumer file’s `<module>.styles.ts`. For a key used in several modules of the same feature, colocate it with the narrow common presentation owner within that feature. For a genuinely shared primitive (`flex`, pressed/disabled state, typography/layout tokens), use the existing primitive/theme owner or reproduce the small token-based declaration locally; do not retain/export a global style bag. Do not copy the full stylesheet or change dimensions as part of relocation. Keys currently used inside decomposed giant components follow the feature action/UI owner from appendix B and the ownership table, never wholesale into WorkspaceScreen.

| Original key | Current symbol consumers (new owners in A/B) |
| --- | --- |
| `root` | `CodeWideWorkspaceContent`, `ForwardedLoopbackBrowser` |
| `desktopWorkspace` | `CodeWideWorkspaceContent` |
| `flex` | `CodeWideWorkspaceContent`, `ForwardedLoopbackBrowser`, `ThreadResourcesSheet`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ThreadGoalDialog`, `ReviewSheet`, `LocalhostPreview`, `Card`, `UnknownProtocolBlock`, `AgentActivityProtocolBlock`, `NewThreadServerSheet`, `ConnectionSheetSession`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `pressed` | `ThreadFilterMenu`, `ThreadRow`, `NewThreadFloatingButton`, `ConversationPane`, `ComposerAccessoryTray`, `MessageActionRail`, `OptimisticTurn`, `TurnActivity`, `LargeContentControls`, `AgentActivityProtocolBlock` |
| `serverEmoji` | `ConnectionSettings` |
| `connectionActivityIndicator` | `ConnectionActivityIndicator` |
| `threadSidebar` | `ThreadSidebar` |
| `threadListHeaderChrome` | `ThreadSidebar`, `MobileThreads` |
| `threadListContentSurface` | `ThreadSidebar`, `MobileThreads` |
| `threadListSuspended` | `ThreadSidebar`, `MobileThreads` |
| `sidebarHeader` | `ThreadSidebar` |
| `serverTitleRow` | `ThreadSidebar` |
| `serverTitle` | `ThreadSidebar` |
| `headerIcon` | `ConversationNavigationLoader`, `ThreadSidebar`, `ThreadListMenu`, `MobileThreads`, `ConversationPane`, `ThreadResourcesSheet`, `ThreadHeaderMenu`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `LocalhostPreview`, `FullContentViewer`, `PairingQrScanner` |
| `headerMenuAnchor` | `ThreadHeaderMenu` |
| `threadSearchRow` | `ThreadSidebar`, `MobileThreads` |
| `threadSearchBox` | `ThreadSidebar`, `MobileThreads` |
| `threadFilterButton` | `ThreadFilterMenu` |
| `threadFilterActiveDot` | `ThreadFilterMenu` |
| `searchBox` | `ThreadSidebar`, `MobileThreads` |
| `searchInput` | `ThreadSidebar`, `MobileThreads`, `ConversationPane` |
| `sectionHeader` | `SidebarSectionHeader` |
| `threadListEmpty` | `ThreadListExperimentSuspended` |
| `threadListEmptyText` | `ThreadListExperimentSuspended` |
| `threadRow` | `ThreadRow` |
| `threadContextMenu` | `ThreadRow` |
| `threadRowSwipeChild` | `ThreadRow` |
| `swipeContainer` | `ThreadRow` |
| `swipeChildren` | `ThreadRow` |
| `swipeActionsLeft` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `swipeActionsRight` | `ThreadSwipeActions` |
| `swipeActionsUnderlay` | `ThreadSwipeActions` |
| `swipeAction` | `ThreadSwipeAction` |
| `swipeActionNeutral` | `ThreadSwipeAction` |
| `swipeActionAccent` | `ThreadSwipeAction` |
| `swipeActionDanger` | `ThreadSwipeAction` |
| `swipeActionPressed` | `ThreadSwipeAction` |
| `swipeActionText` | `ThreadSwipeAction` |
| `threadRowSelected` | `ThreadRow` |
| `selectionBar` | `ThreadRow` |
| `threadText` | `ThreadRow` |
| `threadTitleLine` | `ThreadRow` |
| `threadServerEmoji` | `ThreadRow` |
| `threadTitleSlot` | `ThreadRow` |
| `runningThreadTitle` | `ThreadTitle` |
| `threadTitle` | `ThreadTitle` |
| `threadTitleWave` | `ThreadTitle` |
| `threadStatusIcon` | `ThreadRow` |
| `threadMeta` | `ThreadRow` |
| `threadTime` | `ThreadRow` |
| `unreadSlot` | `ThreadRow` |
| `unreadDot` | `ThreadRow` |
| `threadPreviewLine` | `ThreadRow` |
| `threadPreview` | `ThreadRow` |
| `mobileList` | `MobileThreads` |
| `mobileTitleRow` | `MobileThreads` |
| `mobileTitleSelector` | `MobileThreads` |
| `mobileIdentity` | `MobileThreads` |
| `mobileTitle` | `MobileThreads` |
| `mobileTitleGrow` | `MobileThreads` |
| `mobileSubtitle` | `MobileThreads` |
| `mobileSearchWrap` | `ThreadSidebar`, `MobileThreads` |
| `newThreadFab` | `NewThreadFloatingButton` |
| `conversation` | `ConversationNavigationLoader`, `ConversationPane` |
| `conversationRaised` | `ConversationPane` |
| `conversationKeyboard` | `ConversationNavigationLoader`, `ConversationPane` |
| `emptyConversation` | `ConversationPane`, `PairingQrScanner` |
| `emptyText` | `ThreadHistoryEmptyState`, `ConversationPane`, `PairingQrScanner` |
| `newChatEmptyState` | `ConversationPane` |
| `newChatPrompt` | `ConversationPane` |
| `newChatProjectButton` | `ConversationPane` |
| `newChatProjectText` | `ConversationPane` |
| `newChatWorkspaceButton` | `ConversationPane` |
| `newChatWorkspaceText` | `ConversationPane` |
| `projectSearch` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `projectSearchInput` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `projectPickerProgress` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `conversationHeaderChrome` | `ConversationPane` |
| `conversationHeader` | `ConversationNavigationLoader`, `ConversationPane` |
| `conversationHeaderUnderlay` | `ConversationPane` |
| `conversationIdentity` | `ConversationNavigationLoader`, `ConversationPane` |
| `conversationIdentityRaised` | `ConversationPane` |
| `conversationTitleRow` | `ConversationPane` |
| `conversationTitle` | `ConversationNavigationLoader`, `ConversationPane`, `LocalhostPreview` |
| `conversationHeaderTitle` | `ConversationPane` |
| `conversationBackendRefreshIndicator` | `ConversationBackendRefreshIndicator` |
| `emojiText` | `emojiSafeTitle` |
| `conversationSubtitle` | `ConversationNavigationLoader`, `ConversationHistorySubtitle`, `LocalhostPreview` |
| `threadSearchBar` | `ConversationPane` |
| `searchAction` | `ConversationPane` |
| `threadSearchCount` | `ConversationPane` |
| `conversationScroll` | `ConversationPane` |
| `conversationContentSurface` | `ConversationPane` |
| `conversationKeyboardBody` | `ConversationPane` |
| `timelineShell` | `ConversationPane` |
| `historyLoadingIndicator` | `ThreadHistoryLoadingIndicator` |
| `historyLoadingIndicatorPill` | `ThreadHistoryLoadingIndicator` |
| `livePlanFloat` | `ConversationPane` |
| `conversationContent` | `ConversationPane` |
| `conversationContentCompact` | `ConversationPane` |
| `conversationContentWide` | `ConversationPane` |
| `timelineRow` | `ConversationPane` |
| `historyBeginning` | `ConversationPane` |
| `timelineItem` | `ConversationPane` |
| `timelineItemWide` | `ConversationPane` |
| `turnGroup` | `OptimisticTurn`, `TurnTimelineItem` |
| `preTurnLifecycleList` | `PreTurnLifecycleRows` |
| `preTurnLifecycleRow` | `PreTurnLifecycleRows` |
| `preTurnLifecycleIcon` | `PreTurnLifecycleRows` |
| `preTurnLifecycleText` | `PreTurnLifecycleRows` |
| `preTurnLifecycleWave` | `PreTurnLifecycleRows` |
| `preTurnLifecycleDetail` | `PreTurnLifecycleRows` |
| `turnMessages` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `turnBlock` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `turnFooter` | `OptimisticTurn` |
| `turnTokenMetrics` | `TurnFooter` |
| `turnFooterEnd` | `OptimisticTurn` |
| `turnStatusDot` | `OptimisticTurn`, `TurnFooter` |
| `turnStatusRunning` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `turnStatusFailed` | `OptimisticTurn`, `TurnFooter` |
| `turnStatusStopped` | `TurnFooter` |
| `turnStatusCompleted` | `TurnFooter` |
| `userTurnCluster` | `OptimisticTurn`, `TurnTimelineItem` |
| `userMessageRow` | `OptimisticTurn`, `TurnTimelineItem` |
| `agentMessageRow` | `TurnTimelineItem` |
| `messageActionRail` | `MessageActionRail` |
| `messageActionButton` | `MessageActionRail` |
| `userBubble` | `ProtocolBlock` |
| `userBubbleText` | `CollapsibleUserMessage` |
| `userMessageContent` | `TurnTimelineItem`, `UserMessageContent` |
| `userMessageMediaContent` | `UserMessageContent` |
| `userMessageBlock` | `TurnTimelineItem` |
| `userMessageTextBlock` | `CollapsibleUserMessage` |
| `pendingUserMessageShimmer` | `CollapsibleUserMessage` |
| `userMessageExpandButton` | `CollapsibleUserMessage` |
| `userMessageExpandText` | `CollapsibleUserMessage` |
| `userImageGallery` | `UserImageGallery` |
| `userImageGalleryHero` | `UserImageGallery` |
| `userImageGalleryTile` | `UserImageGallery` |
| `userImage` | `OpenableImage`, `ScopedPrivateAssetImage`, `UserImageGallery` |
| `generatedImage` | `OpenableImage` |
| `openableImage` | `OpenableImage` |
| `imageOpenBadge` | `OpenableImage` |
| `attachmentChip` | `ToolRichContent`, `UserMessageContent` |
| `attachmentText` | `ToolRichContent`, `UserMessageContent` |
| `messageTime` | `OptimisticTurn`, `TurnTimelineItem` |
| `optimisticError` | `OptimisticTurn` |
| `retryMessageButton` | `OptimisticTurn` |
| `retryMessageText` | `OptimisticTurn` |
| `agentMessage` | `ProtocolBlock` |
| `agentMarkdownDocument` | `AgentResponseMarkdown`, `CompleteAgentMarkdown` |
| `agentMarkdownDocumentFill` | `AgentResponseMarkdown`, `CompleteAgentMarkdown` |
| `waveTextShell` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `waveTextRest` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `waveTextMask` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `waveTextBand` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `agentPlaceholder` | `TurnTimelineItem`, `CompletedTurnHistory` |
| `turnActivity` | `TurnActivity` |
| `turnActivityCompact` | `TurnActivity` |
| `turnActivityExpanded` | `TurnActivity` |
| `turnActivityToggle` | `TurnActivity` |
| `turnActivityToggleCompact` | `TurnActivity` |
| `activityIconSlot` | `TurnActivity` |
| `activityChevronSlot` | `TurnActivity` |
| `turnActivityLabel` | `TurnActivity` |
| `turnActivityLabelWave` | `TurnActivity` |
| `outputFootprintMetric` | `OutputFootprintMetric` |
| `outputFootprintMetricText` | `OutputFootprintMetric` |
| `turnActivityList` | `TurnActivitySegment`, `TurnActivity` |
| `turnActivityListWithoutToggle` | `TurnActivity` |
| `activityMoreButton` | `CollapsedTurnActivity` |
| `activityMoreText` | `CollapsedTurnActivity` |
| `copyButton` | `CopyButton` |
| `copyButtonCompact` | `CopyButton` |
| `agentText` | `ProtocolBody` |
| `liveAgentResponse` | `AppendOnlyLiveContent` |
| `liveAgentResponseFill` | `AppendOnlyLiveContent` |
| `liveMarkdownResponse` | `AppendOnlyLiveContent` |
| `card` | `Card`, `AgentActivityProtocolBlock` |
| `bubbleNestedSurface` | `Card`, `UnknownProtocolBlock`, `TokenUsageProtocolBlock`, `AgentActivityProtocolBlock` |
| `cardContent` | `Card` |
| `cardHeader` | `Card`, `AgentActivityProtocolBlock` |
| `cardHeaderToggle` | `Card`, `AgentActivityProtocolBlock` |
| `cardIconSlot` | `Card`, `ProtocolBlock`, `AgentActivityProtocolBlock` |
| `cardTitle` | `Card`, `ProtocolBlock`, `TokenUsageProtocolBlock`, `AgentActivityProtocolBlock` |
| `cardTitleWave` | `Card`, `ProtocolBlock`, `AgentActivityProtocolBlock` |
| `cardStatusIcon` | `Card`, `AgentActivityProtocolBlock` |
| `cardStatusDot` | `Card`, `AgentActivityProtocolBlock` |
| `commandActivitySection` | `CommandExecutionProtocolBlock`, `LazyCommandOutput` |
| `commandActivitySectionHeader` | `CommandExecutionProtocolBlock`, `LazyCommandOutput` |
| `commandActivitySectionLabel` | `CommandExecutionProtocolBlock`, `LazyCommandOutput` |
| `agentActivityMeta` | `AgentActivityProtocolBlock` |
| `tokenStrip` | `TokenUsageProtocolBlock` |
| `tokenStripTitle` | `TokenUsageProtocolBlock` |
| `tokenMetrics` | `TokenUsageProtocolBlock` |
| `tokenMetric` | `TokenUsageProtocolBlock` |
| `tokenMetricValue` | `TokenUsageProtocolBlock` |
| `planStep` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `planText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `reasoningCard` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `reasoningText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `thinkingStatusSection` | `TurnActivitySegment` |
| `thinkingStatus` | `ProtocolBlock` |
| `thinkingStatusInActivity` | `ProtocolBlock` |
| `monospaceStrong` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `toolRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `toolLabel` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `toolValue` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `codeBlock` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `codeLine` | `StableLiveTextSegment` |
| `commandLine` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `diffAdd` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `diffRemove` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `diffFile` | `DiffFile` |
| `diffFileHeader` | `DiffFile` |
| `diffFilePath` | `DiffFile` |
| `diffKind` | `DiffFile` |
| `diffStat` | `DiffFile` |
| `diffStatAdd` | `DiffFile` |
| `diffStatDelete` | `DiffFile` |
| `diffLines` | `DiffFile` |
| `searchResult` | `ToolResourceLink`, `MemoryCitationList`, `WebSearchProtocolDetails` |
| `compactToolCard` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `compactToolTitle` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `compactToolText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `resultCount` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `unknownCard` | `UnknownProtocolBlock` |
| `unknownText` | `UnknownProtocolBlock` |
| `unknownFixButton` | `UnknownProtocolBlock` |
| `unknownFixText` | `UnknownProtocolBlock` |
| `rawLink` | `ApprovalPrompt`, `ToolRichContent`, `ToolResourceLink`, `MemoryCitationList`, `WebSearchProtocolDetails`, `ProtocolBody`, `ConnectionRowEditor` |
| `protocolBody` | `ToolRichContent`, `MemoryCitationList`, `ProtocolBody` |
| `toolMarkdownResult` | `ToolRichContent` |
| `protocolBodyActions` | `ProtocolBody` |
| `largeContentControl` | `LargeContentControls` |
| `largeContentActions` | `LargeContentControls` |
| `largeContentButton` | `LargeContentControls` |
| `largeContentButtonText` | `LargeContentControls` |
| `largeContentPager` | `FullContentViewer` |
| `largeContentPageButton` | `FullContentViewer` |
| `fullContentViewer` | `FullContentViewer` |
| `fullContentHeader` | `FullContentViewer` |
| `fullContentHeaderIcon` | `FullContentViewer` |
| `fullContentHeaderText` | `FullContentViewer` |
| `fullContentTitle` | `FullContentViewer` |
| `fullContentMeta` | `FullContentViewer` |
| `fullContentViewport` | `FullContentViewer` |
| `fullContentCentered` | `FullContentViewer` |
| `fullContentMarkdown` | `FullContentViewer` |
| `fullContentRawHorizontal` | `FullContentViewer` |
| `fullContentRawText` | `FullContentViewer` |
| `fullContentFooter` | `FullContentViewer` |
| `fullContentFooterText` | `FullContentViewer` |
| `turnMeta` | `ConversationPane` |
| `turnMetaText` | `ConversationPane`, `OptimisticTurn`, `TurnFooter`, `ProtocolBlock`, `CommandExecutionProtocolBlock`, `LargeContentControls`, `ToolCallProtocolDetails` |
| `jumpToLatest` | `ConversationPane` |
| `jumpToLatestBadge` | `ConversationPane` |
| `jumpToLatestBadgeText` | `ConversationPane` |
| `composerSticky` | `ConversationPane` |
| `composerDock` | `ConversationPane` |
| `composerContextStrip` | `ConversationPane` |
| `composerContextContent` | `ConversationPane` |
| `composerContextChip` | `ThreadResourceContextChips`, `ComposerControlChips`, `ComposerPortContextChipLoaded`, `ComposerTerminalContextChip`, `ComposerSubagentContextChipLoaded` |
| `composerContextText` | `ComposerContextLabel`, `ComposerContextCount`, `LocalhostPreview` |
| `composerContextCount` | `ComposerContextCount` |
| `composerContextCountHidden` | `ComposerContextCount` |
| `composerContextRefreshOverlay` | `ComposerContextCount` |
| `composerContextValue` | `ComposerContextCount` |
| `composerContextWave` | `ComposerContextLabel` |
| `threadResourceRoute` | `ThreadResourcesSheet` |
| `threadResourceRouteHidden` | `ThreadResourcesSheet` |
| `threadResourcesContent` | `ThreadResourcesSheet` |
| `threadAttachmentCell` | `ThreadResourcesSheet` |
| `threadResourceDocumentContent` | `ThreadResourcesSheet` |
| `threadResourcePreviewCenter` | `ThreadResourcesSheet` |
| `primaryAction` | `ThreadResourcesSheet` |
| `primaryActionText` | `ThreadResourcesSheet` |
| `threadResourceRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceIcon` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceTitle` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceSubtitle` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceMeta` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceStat` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceDeleted` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourceUnavailable` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `threadResourcesEmpty` | `ThreadResourcesSheet` |
| `composerAttachments` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentsContent` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentCard` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentOpen` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentThumbnail` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentFileIcon` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentName` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentKind` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAttachmentRemove` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerAccessoryTray` | `ComposerAccessoryTray` |
| `composerAccessoryAction` | `ComposerAccessoryTray` |
| `composerAccessoryLabel` | `ComposerAccessoryTray` |
| `queuedComposerEditBar` | `ConversationPane` |
| `queuedComposerEditTitle` | `ConversationPane` |
| `queuedComposerEditPreview` | `ConversationPane` |
| `queuedComposerEditClose` | `ConversationPane` |
| `composer` | `ConversationPane` |
| `composerErrorRow` | `ConversationPane` |
| `composerError` | `ConversationPane` |
| `composerMenu` | `ConversationPane` |
| `composerMenuActive` | `ConversationPane` |
| `composerMenuAnchor` | `ConversationPane` |
| `composerMenuText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `composerInputShell` | `ConversationPane` |
| `composerInput` | `ConversationPane` |
| `voiceCapture` | `VoiceCaptureStatus` |
| `voiceMeter` | `VoiceCaptureStatus` |
| `voiceMeterBar` | `VoiceCaptureStatus` |
| `voiceCaptureLabel` | `VoiceCaptureStatus` |
| `composerIcon` | `ConversationPane` |
| `sendButton` | `ConversationPane` |
| `sendButtonPressed` | `ConversationPane` |
| `stopButton` | `ConversationPane` |
| `sheetTitle` | `ThreadRow`, `ThreadResourcesSheet`, `ThreadHeaderMenu`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ReviewSheet`, `ComposerMenu`, `LocalhostPreview`, `NewThreadServerSheet`, `PairingQrScanner` |
| `sheetPage` | `ComposerMenu` |
| `expandedSheetPage` | `ComposerMenu` |
| `menuTitleRow` | `ThreadResourcesSheet`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ReviewSheet`, `ComposerMenu`, `NewThreadServerSheet` |
| `sheetHeaderIconSlot` | `ThreadResourcesSheet` |
| `queueRow` | `QueueManagerSheet` |
| `queueCompactRow` | `QueueManagerSheet` |
| `queueDragHandle` | `QueueDragHandle` |
| `queueBody` | `QueueManagerSheet` |
| `queueText` | `QueueManagerSheet` |
| `queueMetaRow` | `QueueManagerSheet` |
| `queueTime` | `QueueManagerSheet` |
| `queueSteerButton` | `QueueManagerSheet` |
| `queueSteerLabel` | `QueueManagerSheet` |
| `optimisticAttachments` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `menuNotice` | `ThreadResourcesSheet`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ComposerMenu`, `LocalhostPreview`, `LazyCommandOutput`, `FullContentViewer`, `OpenableImage`, `ImageProtocolContent`, `ScopedPrivateAssetImage`, `FileChangeProtocolDetails`, `UserImageGallery`, `ProtocolBody`, `AccountPoolEditor` |
| `menuScroll` | `ThreadResourcesSheet`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ReviewSheet`, `ComposerMenu`, `NewThreadServerSheet` |
| `menuScrollContent` | `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ReviewSheet`, `ComposerMenu`, `NewThreadServerSheet` |
| `securitySettingRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `securitySettingIcon` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `menuAction` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `menuActionIcon` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `menuActionText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `menuActionTitle` | `ApprovalPrompt`, `ToolResourceLink`, `WebSearchProtocolDetails` |
| `menuActionSubtitle` | `ApprovalPrompt`, `MemoryCitationList`, `WebSearchProtocolDetails`, `AccountPoolEditor` |
| `controlSectionLabel` | `ReviewSheet`, `ComposerMenu`, `ToolCallProtocolDetails`, `ToolCallResultContent`, `MemoryCitationList` |
| `controlOption` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `controlOptionText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `controlOptionTitleRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `controlOptionTitleText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `controlOptionSelected` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `controlOptionAttention` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `runtimeSelector` | `ComposerMenu` |
| `disabled` | `ThreadResourceContextChips`, `ConversationPane`, `ReviewSheet`, `ComposerAccessoryTray`, `OptimisticTurn`, `FullContentViewer`, `UnknownProtocolBlock`, `ConnectionSheetSession`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `previewRoot` | `LocalhostPreview` |
| `previewEmbeddedRoot` | `LocalhostPreview` |
| `previewHeader` | `LocalhostPreview` |
| `previewIdentity` | `LocalhostPreview` |
| `previewSetup` | `LocalhostPreview` |
| `previewWebView` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `previewError` | `ForwardedLoopbackBrowser`, `LocalhostPreview` |
| `previewLoading` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `tunnelTtlChoices` | `LocalhostPreview` |
| `tunnelTtlChip` | `LocalhostPreview` |
| `tunnelTtlChipSelected` | `LocalhostPreview` |
| `livePill` | `LocalhostPreview` |
| `livePillText` | `LocalhostPreview` |
| `approvalCard` | `ApprovalPrompt` |
| `approvalInline` | `ApprovalPrompt` |
| `approvalTitleRow` | `ApprovalPrompt` |
| `approvalTitle` | `ApprovalPrompt` |
| `approvalPending` | `ApprovalPrompt` |
| `approvalQueueCount` | `ApprovalPrompt` |
| `approvalReason` | `ApprovalPrompt` |
| `approvalCommand` | `ApprovalPrompt` |
| `approvalCwd` | `ApprovalPrompt` |
| `approvalQuestion` | `ApprovalPrompt` |
| `approvalInput` | `ApprovalPrompt` |
| `answerOptions` | `ApprovalPrompt` |
| `approvalActions` | `ApprovalPrompt` |
| `approvalButton` | `ApprovalPrompt` |
| `approvalDeclineButton` | `ApprovalPrompt` |
| `approvalDeclineText` | `ApprovalPrompt` |
| `modeSelector` | `ReviewSheet` |
| `overwriteRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `overwriteLabel` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `transferProgress` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `transferProgressFill` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `transferProgressText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `successText` | `ReviewSheet` |
| `dangerButton` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `connectionSheetScroll` | `ConnectionSheetSession` |
| `connectionSheetContent` | `ConnectionSheetSession` |
| `pairingHeader` | `ConnectionSheetSession` |
| `pairingHeaderTitle` | `ConnectionSheetSession` |
| `pairingBack` | `ConnectionSheetSession` |
| `pairingBody` | `ConnectionSheetSession` |
| `pairingHeroIcon` | `ConnectionSheetSession` |
| `pairingLead` | `ConnectionSheetSession` |
| `pairingHint` | `ConnectionSheetSession` |
| `pairingCode` | `ConnectionSheetSession` |
| `pairingActionStack` | `ConnectionSheetSession` |
| `pairingPrimaryAction` | `ConnectionSheetSession` |
| `pairingPrimaryText` | `ConnectionSheetSession` |
| `pairingSecondaryAction` | `ConnectionSheetSession` |
| `pairingSecondaryText` | `ConnectionSheetSession` |
| `pairingTextAction` | `ConnectionSheetSession` |
| `pairingTextActionLabel` | `ConnectionSheetSession` |
| `pairingSafety` | `ConnectionSheetSession` |
| `pairingSafetyText` | `ConnectionSheetSession` |
| `pairingError` | `ConnectionSheetSession` |
| `pairingReviewCard` | `ConnectionSheetSession` |
| `pairingIdentityRow` | `ConnectionSheetSession` |
| `pairingIdentityFields` | `ConnectionSheetSession` |
| `pairingEmojiInput` | `ConnectionSheetSession` |
| `pairingNameInput` | `ConnectionSheetSession` |
| `pairingServerMeta` | `ConnectionSheetSession` |
| `pairingEndpoint` | `ConnectionSheetSession` |
| `pairingMetaText` | `ConnectionSheetSession` |
| `pairingSuccess` | `ConnectionSheetSession` |
| `pairingSuccessIcon` | `ConnectionSheetSession` |
| `pairingSuccessTitle` | `ConnectionSheetSession` |
| `goalDialogContent` | `ThreadGoalDialog` |
| `goalDialogIntro` | `ThreadGoalDialog` |
| `goalObjectiveInput` | `ThreadGoalDialog` |
| `goalClearPrompt` | `ThreadGoalDialog` |
| `goalDialogActions` | `ThreadGoalDialog` |
| `fieldLabel` | `LocalhostPreview`, `ConnectionSheetSession`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `fieldInput` | `ThreadGoalDialog`, `ReviewSheet`, `LocalhostPreview`, `ConnectionSheetSession`, `ConnectionRowEditor` |
| `errorText` | `ThreadResourcesSheet`, `QueueManagerSheet`, `BackgroundTerminalsSheet`, `ReviewSheet`, `ComposerMenu`, `ApprovalPrompt`, `LocalhostPreview`, `LazyCommandOutput`, `AgentResponseMarkdown`, `FullContentViewer`, `UnknownProtocolBlock`, `NewThreadServerSheet`, `ConnectionSheetSession`, `PairingQrScanner`, `ConnectionSettings`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `sheetActions` | `ConnectionRowEditor` |
| `secondaryButton` | `ApprovalPrompt`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `secondaryButtonText` | `ApprovalPrompt`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `primaryButton` | `ReviewSheet`, `ApprovalPrompt`, `LocalhostPreview`, `PairingQrScanner`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `primaryButtonText` | `ReviewSheet`, `ApprovalPrompt`, `LocalhostPreview`, `PairingQrScanner`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `connectionEditor` | `ConnectionRowEditor` |
| `connectionEditorForm` | `ConnectionRowEditor` |
| `connectionIdentityFields` | `ConnectionRowEditor` |
| `connectionRow` | `ConnectionRowEditor` |
| `connectionSummary` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `connectionActions` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `connectionMiniButton` | `ConnectionRowEditor`, `AccountPoolEditor` |
| `connectionActionMenuAnchor` | `ConnectionRowEditor` |
| `connectionEmojiInput` | `ConnectionRowEditor` |
| `connectionStateRow` | `ConnectionRowEditor` |
| `connectionStateIcon` | `ConnectionRowEditor` |
| `connectionEndpointRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `connectionEndpointText` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `connectionStateDot` | `ConnectionSettings`, `ConnectionRowEditor`, `AccountPoolEditor` |
| `connectionStateText` | `ConnectionRowEditor` |
| `connectionDiagnostic` | `ConnectionRowEditor` |
| `connectionDiagnosticHeader` | `ConnectionRowEditor` |
| `connectionDiagnosticSummary` | `ConnectionRowEditor` |
| `connectionDiagnosticMeta` | `ConnectionRowEditor` |
| `connectionDiagnosticTime` | `ConnectionRowEditor` |
| `connectionDiagnosticRaw` | `ConnectionRowEditor` |
| `accountPoolEditor` | `AccountPoolEditor` |
| `accountPoolHeader` | `AccountPoolEditor` |
| `accountPoolRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolDivider` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolTitleRow` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolName` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolRole` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolRoleActive` | No static consumer found: delete only after dynamic/reference check in implementation unit |
| `accountPoolLimit` | `AccountPoolEditor` |
| `accountPoolLimitPending` | `AccountPoolEditor` |
| `accountPoolMenuAnchor` | `AccountPoolEditor` |
| `accountPoolAddButton` | `AccountPoolEditor` |
| `accountLoginSheet` | `AccountPoolEditor` |
| `accountLoginHeader` | `AccountPoolEditor` |
| `accountLoginIcon` | `AccountPoolEditor` |
| `accountLoginTitle` | `AccountPoolEditor` |
| `accountLoginSubtitle` | `AccountPoolEditor` |
| `accountLoginCodeCard` | `AccountPoolEditor` |
| `accountLoginCodeLabel` | `AccountPoolEditor` |
| `accountLoginCode` | `AccountPoolEditor` |
| `accountLoginCopyButton` | `AccountPoolEditor` |
| `accountLoginCopyButtonDone` | `AccountPoolEditor` |
| `accountLoginCopyLabel` | `AccountPoolEditor` |
| `accountLoginCopyLabelDone` | `AccountPoolEditor` |
| `accountLoginHint` | `AccountPoolEditor` |
| `accountLoginPrimaryButton` | `AccountPoolEditor` |
| `scannerRoot` | `PairingQrScanner` |
| `scannerHeader` | `PairingQrScanner` |
| `scannerCamera` | `PairingQrScanner` |
| `scannerFrame` | `PairingQrScanner` |
| `scannerError` | `PairingQrScanner` |

## E. Existing monolith-source test consumers

These **40 files** mention CodeWideScreen and must be triaged during corresponding moves. Some mentions are intentional route/config negative checks and stay; others inspect private source shape and must migrate to owner/behavior tests. A pathname occurrence is not proof a test must be deleted.

- `apps/android/test/content-review.test.ts`
- `apps/android/test/codewide-effect-ownership.test.ts`
- `apps/android/test/streaming-reveal-native.test.ts`
- `apps/android/test/terminal-integration.test.ts`
- `apps/android/test/sidebar-edge-alignment.test.ts`
- `apps/android/test/thread-list-query-contract.test.ts`
- `apps/android/test/composer-attachment-preview.test.ts`
- `apps/android/test/composer-swipe-discard.test.ts`
- `apps/android/test/composer-delivery-mode.test.ts`
- `apps/android/test/model-centric-persistence.test.ts`
- `apps/android/test/failed-message-retry.test.ts`
- `apps/android/test/native-app-config.test.ts`
- `apps/android/test/tool-output-viewer.test.ts`
- `apps/android/test/v2-goal-plan-contract.test.ts`
- `apps/android/test/inline-queue-overlay.test.ts`
- `apps/android/test/expo-ui-menu-shape.test.ts`
- `apps/android/test/message-action-menu-ownership.test.ts`
- `apps/android/test/bubble-yoga-layout.test.ts`
- `apps/android/test/composer-model-settings.test.ts`
- `apps/android/test/app-text-input-contract.test.ts`
- `apps/android/test/user-message-attachments.test.ts`
- `apps/android/test/typography-scaling-contract.test.ts`
- `apps/android/test/empty-agent-response.test.ts`
- `apps/android/test/conversation-chrome-layout.test.ts`
- `apps/android/test/voice-aura-native.test.ts`
- `apps/android/test/internal-browser.test.ts`
- `apps/android/test/command-activity.test.ts`
- `apps/android/test/conversation-transition-parity.test.ts`
- `apps/android/test/document-preview.test.ts`
- `apps/android/test/review-voice-input.test.ts`
- `apps/android/test/navigation-performance-hud.test.ts`
- `apps/android/test/thread-list-polish.test.ts`
- `apps/android/test/companion-transport-security.test.ts`
- `apps/android/test/app-lock.test.ts`
- `apps/android/test/attachment-list-virtualization.test.ts`
- `apps/android/test/fullscreen-sheet-contract.test.ts`
- `apps/android/test/thread-history-pagination-contract.test.ts`
- `apps/android/test/new-chat-workspace.test.ts`
- `apps/android/test/native-reveal.test.ts`
- `apps/android/test/mobile-server-sheet.test.ts`

## Dependency corrections from source-graph pressure

A conservative declaration-to-target-module graph exposed two cycles before review. They are resolved in the target manifest, not suppressed:

- `ToolCallProtocolBlock` / rich tool content, `ProtocolBody` and `LazyJsonProtocolBody` form one bounded protocol-content rendering owner, **`features/conversation/protocol/ToolContent.tsx`**. Their mutual source references cannot be turned into cyclic leaf modules; the wrapper alone does not earn a module.
- `ComposerMenuProps` remains with `ComposerMenu`; it must not live in a separate type module that depends back on the component. Shared `MenuAction`, `ControlOption`, `ComposerContextLabel` and `ComposerContextCount` move to explicit UI-level component owners (`ui/MenuAction.tsx`, `ui/ControlOption.tsx`, `ui/ResourceContextChip.tsx`) because review/tool chips consume them too. These modules own reusable interaction/layout contracts, not feature state.
- `ComposerMenu` is decomposed along with ConversationPane: it retains model/permissions/skills menu behavior; its old review/goal/ports panel bodies are owned by their public feature surfaces and supplied by outer composition. It may not import a ports/review private adapter to preserve the old switch. `ThreadHeaderMenu` similarly emits feature intents through public capabilities.
- `ThreadListServer`/connection display helpers and thread selection identity have public owner contracts used by lists/navigation/conversation; avoid moving them into a private view-only file. Shared title/emoji rendering currently consumed across feature surfaces is a UI presentation contract, not a dependency on a thread-list private model.

These corrections are mandatory parts of the selected target. Source-graph checks are conservative structural evidence, not semantic runtime validation.

## Baseline structural evidence

- Declaration coverage: 275 of 275 names assigned once; zero duplicate names.
- RemoteWorkspace public command coverage: 73 of 73 method names present in the action map.
- WorkspaceRuntime state coverage: 31 of 31 property declarations explicitly assigned in the runtime-state closure, including callable properties; all ten snapshot slots and the three additional accessor/method members are accounted for.
- JSX destination check: zero intact JSX-bearing declarations assigned to .ts targets. SidebarSectionHeader and ConnectionActivityIndicator have separate .tsx view owners; the intact-unit graph remains acyclic.
- Styles: all 488 declared keys listed with current static consumers and an explicit owner-following relocation rule.
- Existing moved-file import projection: zero retained data/native/ui/rendering -> moved-feature static edges after the review-host, input-family and project/list/composer policy corrections. This check includes existing V1 source imports and excludes V2.
- Conservative target-module declaration graph: zero remaining cycles for intact moved units. It deliberately excludes the seven explicitly decomposed/deleted source owners: ConversationPane, CodeWideWorkspaceContent, ActiveWorkspaceConversation, ConversationPaneProps, styles, ComposerMenu and ThreadHeaderMenu. Their final imports are governed by the explicit capability/slot rules and must be checked in implementation; the audit does not pretend those old bodies can be moved unchanged.
- These are source-baseline/static proposal checks. D0 validation is recorded below; they do not claim an implemented target graph or device parity.

## D0 verification and remaining work

D0 changes exactly the two new central docs, two new local CONTEXT contracts, the narrow V1 section in AGENTS.md and the V1 quality-routing update. D0 validation passed: all 36 documentation links resolve; 275 declarations, 488 style keys, 73 public methods and 31 runtime properties remain covered, with zero declaration destination changes from the approved map. `git diff --check` and `pnpm validate:android:v1` passed (native/web/compatibility typing, ESLint and Dependency Cruiser: 2024 modules, 6735 dependencies). Application and device/performance evidence remains due per migration unit; no speedup, measured budget, completed source extraction or release is claimed. Rerun the source inventory against the current revision when each unit starts.

## M0 implementation evidence

The V1 ESLint configuration now includes `src/features/**/*.{ts,tsx}` in the existing presentation-token rule; the existing React rule already covers all source paths. V1 dependency rules reject lower data/native imports into features or root composition and feature imports back into root composition. Existing cycle, resolution and V2-isolation rules are unchanged.

`v1-feature-boundaries.test.ts` exercises the production ESLint config and Dependency Cruiser rules against isolated temporary sources. It verifies token and React diagnostics, allowed feature-to-lower contracts, rejected data/native-to-feature type imports, V1-to-V2 imports, root back-edges and type-only cycles. It verifies the production `err` reporter exits unsuccessfully; JSON report output is inspected separately. Temporary fixtures are removed in `finally`.

Validation: `pnpm validate:android:v1` passed (2024 modules, 6735 dependencies); focused boundary/presentation tests passed (16 tests). Parsed baseline inventory still matches 275 distinct declarations, 488 styles and 40 listed source-test consumers. No application ownership was moved in M0; M1–M8 and platform/performance evidence remain pending.

## M1 implementation evidence

Connections, accounts and settings now live in their mapped feature owners, including the listed UI families, pairing/error/diagnostic helpers, local styles and actual source/test consumers. `connectionActions` owns pairing visibility and profile-edit admission; workspace still supplies existing lower methods and receives the same add/navigation intent. Settings composes the public connection surface and keeps external security/generation ownership. Account profile operations, explicit login cancellation and copied-code lifetime remain distinct.

Private forms/views were decomposed within each mapped owner while retaining the approved public destinations and declarations. Pairing modes share one submission/retry control, account profile/login/session usage views are separate, and connection fields/status retain their original state owner. No new source file exceeds 200 lines. The source-only assertions migrated to `v1-settings-feature-contract.test.ts` read individual real owners; no concatenated screen surrogate exists.

Validation: focused Vitest checks passed (117 tests); existing settings, account-menu and subscription render checks passed (9 tests). New mounted-owner tests cover pairing closing content/next-open reset and readiness rejection, account explicit cancellation, profile snapshot completion, copied feedback expiry and cleanup. M1 V1 gate retains native/web/compatibility typing and dependency checks. Device tools were resolved through the repository Android SDK path; `adb devices -l` returned an empty device list. Camera scanning, actual account sign-in and biometric settings remain unverified device scenarios; no device parity or performance gain is claimed. M2–M8 remain required work.

## M2 implementation evidence

M2 closes list/navigation/projects/search source ownership. Stable list projections, paging/filter/offset state, row command intents, new-chat/project state, active project changes, composer picker activation guards and global/mobile search coordination now live with their feature. Navigation keeps its model runtime-neutral and places native/React intents in separate same-owner modules. ThreadListFeature and ProjectPickerFeature own the real list/sheet composition boundaries. Private view/session/style decomposition preserves the mapped public declarations while keeping the new M2 UI modules under 200 lines.

Moved families and their source/test consumers use the new paths; no old-path wrappers remain. SearchMessageFocus, ThreadTitle, MenuAction and ControlOption are real shared rendering/UI owners. Exact public-module allowlists reject private peer imports, and migrated units reject the old workspace facade. The negative fixture covers both cases alongside the original lower/V2/cycle gates. Necessary database/resource references retain their original identities; the list scope projection directly retains its unchanged readonly source.

Completed evidence: V1 native/web/compatibility typing, ESLint and dependency graph passed (2132 modules, 7348 dependencies); 102 focused semantic/source/boundary checks passed across the final focused runs; 30 project/search/navigation render checks passed. Expo web export and Android Metro export completed. The native export is validation output under the workflow step artifacts. No release or native runtime change was performed. Camera, account browser handoff, biometric settings, real device list/back/keyboard/new-chat interaction and same-device performance comparison remain explicitly unverified under the resolved device disclosure. M3–M8 remain required.

## M3 implementation evidence

Requests, goal, queue list and thread actions now have actual feature owners, including their scoped state, errors, resource reads and command bindings. The goal and queue types used by lower consumers moved to the existing workspace resource database and delivery-state owner; the facade no longer declares or re-exports them. Header and catalog actions use the existing lower mutation authority. The queue overlay retains its measured cards and shared animation values across expand/collapse; its motion, layout, state and view policies are separate private owners. Request answers/pending/rejection, goal validation and voice scope, rename admission, queue ordering/steer and original command IDs are preserved. Composer queue-edit and upload admission remain M5 obligations.

Completed automated evidence: 109 focused Vitest semantic/source/boundary cases; seven render cases covering request pending/rejection, queue action/refresh/error, qualified queue intents, rename and goal chip. V1 native/web/compatibility typing, ESLint and dependency graph passed (2159 modules, 7491 dependencies). Actual Android queue gestures, goal voice input and native request interaction remain explicitly unverified under the resolved device disclosure. M4–M8 remain required.

## M4 attachment subunit evidence

Attachment list, private document/media routing and the mounted document stack moved to features/attachments. Preview loading still uses the existing ephemeral resource/abort contract. Fixed-height attachment cells and same-scope sheet visibility remain intact. Shared ThreadChangeDiffValue is now declared by data/thread-resource-types, and HTTP(S) link validation has one shared rendering owner. The existing protocol-owned code viewport bound is passed as display configuration, avoiding a feature-to-conversation implementation edge.

The V1 gate passed (2168 modules, 7562 dependencies), 70 focused semantic/source/boundary tests passed, and a render test proved immediate attachment sheet publication while loading remains pending, error retention, explicit close, changes dispatch and scope reset. Device media/document/download interaction remains unverified. Changes, review, drawing, ports/browser, terminal and agents remain separately gated M4 obligations; M5–M8 are pending.

## M4 changes subunit evidence

Changes scope/preferences, recorded-turn transformation, lazy turn file loading, contextual chips and fullscreen source/change presentation now belong to features/changes. Module-retained preference identity, received patch order and lower resource authority are preserved. Shared context chip labels/counts moved to the approved ui/ResourceContextChip owner. No feature facade/private peer/root imports were added.

V1 gate passed (2176 modules, 7614 dependencies); 65 focused semantic/source/boundary tests and three render cases passed. Tests cover repeated file aggregation, recorded patch ordering, qualified preferences and turn-change footer actions. Device interaction remains unverified. Review/drawing/ports/browser/terminal/agents and M5–M8 remain pending.

## M4 review subunit evidence

ReviewTargetSheet and CodeReviewWorkspace now live in the review feature with private resource, comment, voice, viewport and display owners. Source-before-diff publication, abort checks and captured voice-line binding remain explicit. reviewSubmission prepares files while the composer reviewAdmission owner handles draft IDs and identity-checked acknowledgement. The approved composer latest-values move is an M5 prerequisite; the remaining composer unit is pending.

V1 gate passed (2189 modules, 7677 dependencies); 83 focused tests and two render cases passed. Native voice/WebView interaction remains unverified. Drawing, ports/browser, terminal, agents and M5–M8 remain pending.

## M4 drawing subunit evidence

DrawingWorkspace, DrawingFeature and drawingAttachment own bridge interaction, captured drawing session and PNG preparation. Composer retains staged upload admission. The opening activation stays captured across image loading and fullscreen lifetime; stale image qualification and accepted-result close remain unchanged.

V1 gate passed; 47 focused tests and two render cases passed, including pending duplicate suppression, rejection/retry and accepted close. Device drawing/WebView/export appearance remain unverified. Ports/browser, terminal, agents and M5–M8 remain pending.

## M4 ports/browser subunit evidence

The complete browser and port manager families moved with native/web variants, helpers, private styles and consumers. PortsFeature owns forwarding/tunnel selection; nativeForwardingAdapter reads the retained native store. Browser feedback receives qualified upload and durable queue capabilities without RemoteWorkspace. Native bridge lifetime remains single-owned in browserDevTools; navigation, feedback selection, pane layout and external message validation are separate private owners. The facade TunnelPreview alias was removed in favor of its existing lower TunnelValue authority.

V1 gate passed (2224 modules, 7840 dependencies); 67 focused checks and seven render cases passed. Actual Android forwarding/CDP/WebView/screenshot scenarios remain unverified. Terminal, agents and M5–M8 remain pending.

## M4 terminal subunit evidence

Terminal native/web views, tab rendering, contextual chip, background process list/actions and retained fullscreen activation now have terminal feature owners. The existing interactive store owns tabs and rendered offsets; explicit close and hide remain separate. Successful thread deletion closes only the captured terminal workspace. The facade BackgroundTerminal alias was removed in favor of its existing BackgroundTerminalValue lower resource type.

V1 gate passed (2233 modules, 7880 dependencies); 64 focused tests and one hook render case passed. The full background component could not initialize Expo EventEmitter in Node; its real pending/error action owner was tested without new mocks. Actual Android terminal/input/keyboard/persistence scenarios remain unverified. Agents and M5–M8 remain pending.

## M4 agents and unit closure evidence

Subagent sheet/workspace, row/pending views, contextual chip, scoped summary projection and opening/refresh now belong to agents. The public child-render capability carries the owning connection. Selection retains its Transition and reads the existing ready thread-chat-window; the overlay survives opening-scope unmount. M6 will close the remaining legacy root detail-rendering composition.

V1 gate passed (2240 modules, 7931 dependencies); 67 focused tests and one workspace render case passed. All M4 owner subunits are separately gated. Device-only scenarios remain explicitly unverified. M5 composer, M6 conversation, M7 lower runtime and M8 final closure remain required.

## M5 implementation evidence

Composer input/delivery/skills families and mapped draft/settings/submission/queue/paste/suggestions/voice/menu owners are implemented. Tool pages now compose in `features/workspace/ComposerMenuComposition.tsx`; the composer receives display slots and typed intents. Captured draft, preference, upload and send callbacks preserve activation ownership across file picking, drawing, review and final voice completion. The lower SendMode/TurnSendOptions and ThreadSettings contracts now belong to their durable delivery/control owners; facade-only attachment/control aliases are removed from consumers.

`pnpm validate:android:v1` passed after the final source extraction: 2286 modules, 8194 dependencies, native/web/compatibility typing and lint (`m5-closed-gate2.log`). Focused semantic/source contracts passed 103 tests; migrated native integration contracts passed 21 tests (`m5-tests-final.json` records the former aggregate before the final native expectation moves; `m5-native-contract3.json` records their passing result). Seven render suites passed 35 tests; the extended native editor suite passed 11, including the new retained-editor assertion, for 36 unique tests across that scope. Android and web Expo export exited successfully into `m5-platform-export`; Expo printed its existing forced-exit notice after producing the export. No device interaction or performance parity is claimed. M6–M8 remain required.

## M6 implementation evidence

Conversation detail now publishes the existing progressive snapshot into an unkeyed composition. Timeline projection, frozen initial position, history anchors, viewport/gesture trimming, visible search and unread receipts have separate owners. Turn/protocol/content renderers retain the mapped caches, bounded output and native reveal. Header/composer layout remains mounted; composer restoration still precedes editable presentation. Subagents compose a read-only surface and retain their Transition, without editor, queue-edit, upload or voice-binding hooks.

The V1 gate passed (2422 modules, 9100 dependencies), including a new rule that rejects full feature composition imports from conversation read/render owners. Android test coverage comprises 1890 passing assertions in the broad run and 43 passing cases in the three repaired source/recorded-change suites; the broad run initially could not load those three suites. Five render suites passed 21 cases, including frozen timeline position, gesture trim guards, activation cleanup, read-only context and mounted editor/submit behavior. Expo Android and web exports completed. Actual native scroll/fling, keyboard, voice, view-retention and same-device performance comparison remain unverified because no Android device is attached. No performance gain or device parity is claimed.

At the M6 checkpoint, the temporary ConversationWorkspace command aggregation and lower RemoteWorkspace facade still remained. The implemented M7 and M8 sections below record their removal, complete source/style/action/consumer closure and final available validation.


## M7 implemented evidence — lower runtime and capability closure

The feature-facing `data/use-remote-workspace.ts` facade, `RemoteWorkspace` and `WorkspaceActions` are deleted. `CodeWideScreen.tsx` is the retained route composition export. `features/workspace/createWorkspaceFeatures.ts` binds existing lower handles once to owner-qualified capability groups; private adapters are admitted only from that exact factory and their own feature. Workspace and conversation composition no longer aggregate command algorithms or mirror runtime snapshots.

`data/workspace-runtime.ts` retains the module-started singleton, startup Promise, database/controller construction and supervisor/subscription ordering. Session/catalog/history/resource/control/account/voice/transfer/command owners retain their in-flight maps, qualified keys, error and cancellation paths. The complete runtime audit covers 31 properties, ten snapshot slots, three accessor/method entries and 73 command entries with no unmapped owner. Boot's native start/stop handle remains separate: native stop and feature unmount do not dispose the JS singleton or its caches.

Meaningful contract coverage includes shared ThreadUiState seed identity, session attachment, control/resource deduplication, private transfer authorization, voice resources, command/history reconciliation and first-send workspace admission before durable send. Source consumers and the V2 root-compatibility validator read the real lower runtime owner. No wire schema, database format, native registration, V2 runtime authority or release path changed.

## M8 implemented evidence — exact closure and final validation

All 275 baseline declaration entries are accounted for: 272 named declarations remain at their exact mapped paths, the stylesheet is split by consuming owner, and the two approved omnibus ConversationPane declarations are deleted. All 50 moved module-family rows have their destination and no surviving old source path. The unmounted SearchContextScreen and its unused capability, plus the empty ConversationBottomChrome stylesheet, are removed instead of becoming public migration artifacts. The 488 baseline styles comprise 411 live values with identical tokenized initializers and 77 approved dead entries; baseline computed style access is absent. Same-name keys in existing shared UI modules and ordinary capability object properties are separate owners, not surviving monolith styles. The runtime and old-consumer audits report no unmapped command or old module import.

Private decomposition preserves public mapped declarations and actual mounted hierarchy. Workspace list/project bindings, main history/publication, read-only timeline layout, scroll gesture/measurement callbacks, ordered user/agent turn bodies, bounded protocol presentation, search rows/filters, attachment document resources, DevTools pane and diagnostic sample presentation have cohesive private owners. The intentionally coupled ToolContent public declarations remain together. Feature TSX owners remain near 200 lines (largest: 224); no new or materially rewritten module exceeds 400 lines. Existing larger ContentReviewHost and RichMarkdown receive only import-routing cleanup. No broad lint/type/dependency exception was added.

The former native-app-config monolith is an entrypoint for owner-local contracts; all 1533 original assertions remain represented and all 47 tests remain in the authoritative V2 gate. Positive source checks read actual current owners rather than concatenating a replacement monolith. Semantic and mounted render tests remain alongside these boundary checks.

Final available validation on 2026-09-15:

| Check | Evidence |
| --- | --- |
| `pnpm validate:android:v1` | Native, web and compatibility TypeScript, ESLint and dependency boundaries pass after semantic review; 2542 modules / 9699 dependencies |
| `pnpm test` | 302 files / 2209 tests pass after semantic review; no failed tests or suites |
| `pnpm validate:android:v2` | Sync V2 tests 91; selected Android tests 545; 107 render suites / 485 tests; formatting, typing, lint, dead-code and dependency gates; Android Metro compilation; Kotlin and Android unit tests pass; `m8-pressure-v2-final.log` |
| Android and web export | Expo export passes; Android 4975 modules, web 6261 modules; `m8-final-platform-export.log`. Expo prints its existing forced-exit notice after writing artifacts |
| Browser platform contract | Real Chromium list style/custom-scroll/event check passes; `m8-final-web-platform.log` |
| Exported V1 application | Fresh Chromium `/legacy` load and reload both show the empty thread-list surface with no page errors; `m8-final-web-app-smoke.log` |
| Exact source closure | `m8-exact-declarations.json`, `m8-ledger-audit.json`, `m8-style-values.json`, `m8-runtime-command-audit.json`, `m8-old-consumers.json`; no missing mapped declaration, style-value mismatch or old consumer |
| Diff hygiene | `git diff --check` passes |

Actual Android camera pairing, sign-in browser handoff, biometric settings, microphone, native gestures/keyboard, retained native views, device startup/failure/retry and relative same-device/build performance remain explicitly unverified because no device is attached. Available source/model/boot-slot tests do not establish those device behaviors. The resolved device disclosure permits completing source migration and available validation; no device parity or performance improvement is claimed. No commit, push, release, deployment or external mutation was performed.

## Post-M8 route ownership closure

The subsequent route migration deleted the M8 `CodeWideScreen`, `WorkspaceScreen`,
`WorkspaceOverlays`, `features/navigation/**`, `ComposerMenuComposition`, and duplicate
agent/Terminal route wrappers. Expo Router now owns V1 destinations under `app/v1/**`; typed
services own cross-route identity and bounded private sessions. Feature capabilities and lower
runtime owners from M0–M8 remain in place. See the [route ledger](android-v1-route-migration.md) for
the current source disposition, behavior contracts, test migration and validation state. Final
route closure passed `pnpm validate:android:v1` with 2,601 modules and 9,967 dependencies cruised,
and full `pnpm test` passed 305 files and 2,214 tests. Device-only interaction and performance
scenarios remain unverified as recorded there.
