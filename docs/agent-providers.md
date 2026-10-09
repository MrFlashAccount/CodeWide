# Agent provider layer

Status: **approved phase-1 contract; implementation in progress**. Host integration experiments (E-HARDEN, E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE) and the idle-memory load measurement are not yet recorded; their sections below say so explicitly.

The companion talks to coding agents only through a provider layer: one provider trait, one neutral model and declared capabilities. Codex and Claude are two equal providers. Every thread is bound to exactly one provider for its whole life. The client keeps its Codex-shaped wire (protocol `0.155.1` shapes) in phase 1; the companion translates neutral → client wire in exactly one place, and the client hides features that the thread's provider does not declare.

Local ownership rules live with their source zones; this document routes to them and records the cross-zone contract:

- [`packages/agent-protocol/CONTEXT.md`](../packages/agent-protocol/CONTEXT.md) — the `codewide-agent` protocol contract, version policy and fixtures.
- [`crates/agent-core/CONTEXT.md`](../crates/agent-core/CONTEXT.md) — the neutral model (Rust mirror), the `AgentProvider` trait, `NativeSurface` storage traits, neutral usage accounting, `wire-request-ids-v0`.
- [`crates/agent-search/CONTEXT.md`](../crates/agent-search/CONTEXT.md) — the stored-message full-text search schema and query shared by provider adapters (`companion/search`).
- [`crates/agent-resources/CONTEXT.md`](../crates/agent-resources/CONTEXT.md) — the provider-neutral thread resource model, projection and service shared by provider adapters.
- [`crates/companion-host/CONTEXT.md`](../crates/companion-host/CONTEXT.md) — narrow host contracts the companion hands to adapter crates.
- [`crates/companion-core/src/agent/CONTEXT.md`](../crates/companion-core/src/agent/CONTEXT.md) — provider layer bounded context in the companion (registry, bindings, client wire, crate graph), no-go imports, compatibility surfaces.
- [`crates/agent-provider-codex/CONTEXT.md`](../crates/agent-provider-codex/CONTEXT.md) — Codex adapter, Codex-owned storage modules, `codex.native`, Codex pricing.
- [`crates/agent-provider-claude/CONTEXT.md`](../crates/agent-provider-claude/CONTEXT.md) — Claude adapter (Rust): host supervision boundary and install contract.
- [`crates/agent-provider-claude/host/CONTEXT.md`](../crates/agent-provider-claude/host/CONTEXT.md) — the Claude agent host: neutral-protocol server over the Claude Agent SDK and Claude's session store.
- [`docs/thread-catalog-pagination-regression.md`](thread-catalog-pagination-regression.md#multi-provider-pages) — multi-provider `thread/list` pages and the composite cursor.

## Scope

Phase 1 delivers the provider layer (`crates/agent-core`, `crates/agent-transport`, `crates/companion-host`, the adapter crates and `crates/companion-core/src/agent`), the neutral protocol package, the Codex adapter as a refactor of today's paths, the Claude provider (Rust adapter plus the Claude agent host), binding backfill, capability delivery to the client and the minimal client change set (provider at `thread/start`, same-provider model filter, capability gating, provider badge, approval title, neutral wording).

Not in phase 1:

- switching the provider inside a thread and context handoff (phase 2; bindings and the neutral model keep room for it);
- migrating the client to the neutral protocol;
- ~~moving the Codex storage modules to new paths~~ — done: they live in `crates/agent-provider-codex/src/`;
- Claude fork, review, goals, background terminals, realtime voice, global supervisor, message search and thread resources;
- any Claude account pool, rate limits, pricing or credential handling;
- bundling the Claude Agent SDK into CodeWide binaries.

## Shape

```text
Android (Codex-shaped client wire, capability gating)
  └─ /v1 sync ─ SyncHub (sessions, outbox, ingest)
       └─ agent/client_wire  — the only neutral ↔ client-wire translation
            └─ agent/registry + agent/bindings — routing by binding and capability
                 ├─ AgentProvider ─ crates/agent-provider-codex  ─ Codex App Server (in-process adapter)
                 │                   └─ rollout storage + index, message search ─ crates/agent-search
                 └─ AgentProvider ─ crates/agent-provider-claude ─ codewide-agent v1 over stdio (crates/agent-transport)
                                     ├─ Claude native index (state.redb tables, watcher), message search ─ crates/agent-search
                                     └─ host/ (Claude agent host) ─ Agent SDK ─ user's claude CLI
                                                                  └─ Claude's session store (session records)
```

The registry is built by `crates/companion-core/src/agent/providers/mod.rs` (`build_registry`), the only code outside an adapter crate that maps configured provider ids to adapters. The neutral types and the `AgentProvider` trait live in `crates/agent-core`; the JSONL/WebSocket transports, including the supervised stdio child (`spawn_supervised_stdio`), live in `crates/agent-transport`.

Forbidden edges: provider-id branches in `client_wire` or SyncHub; `registry`, `bindings` or `client_wire` depending on an adapter crate (`agent-provider-codex`, `agent-provider-claude`); SyncHub (`sync.rs`, `sync/*`, `thread_view.rs`, `sync_pending.rs`) reaching Codex storage in `crates/agent-provider-codex` (`history_service`, `resources`, `account_pool`, `rollout*`, `catalog*`, `message_search`) instead of the `NativeSurface` storage traits of the capability owner; `agent-core`, `agent-transport` or an adapter crate depending on `companion-core`; `agent-provider-claude` depending on `agent-provider-codex` or `companion-host`; the client reaching the Claude agent host directly.

## Ubiquitous language

- **Provider** — an agent backend implementing `AgentProvider` (`codex`, `claude`; the `ProviderId` set is open).
- **Primary provider** — the configured provider that leads `thread/list` pagination, owns the single default model row and whose threads carry no badge.
- **Binding** — the companion-owned record that fixes a thread's provider.
- **Capability** — a declared, named feature of a provider; the only basis for routing differences and client gating.
- **Neutral model** — the `codewide-agent` v1 types: thread, turn, item, runtime request, events and operations.
- **Client wire** — the existing Codex-shaped v0.155.1 protocol the client speaks in phase 1.
- **Wire projector** — `agent/client_wire`, the single neutral → client-wire translation and client-wire → neutral decoder.
- **Wake turn** — a turn with `origin: provider`, started by the provider without a user message.
- **Busy start** — the `turn.start` outcome `busy {activeTurnId}` for a provider whose thread is already active.

## Neutral protocol `codewide-agent` v1

`packages/agent-protocol` is the source of truth (TypeScript types, capability vocabulary, versioned fixtures). Rust mirrors it with serde under `crates/agent-core/src/model/`; both must round-trip every fixture. Ids are branded in both languages: `ProviderId`, `AppThreadId`, `ProviderThreadRef`, `TurnId`, `ItemId`, `RuntimeRequestId {provider, nativeId}`, `ClientMessageId`.

The model covers `AgentThread`, `AgentTurn` (`origin: user | provider`), the `AgentItem` discriminated union, `RuntimeRequest` (`approval`, `userInput`, `capabilityRequest`), events (`thread.updated`, `turn.*`, `item.*`, `request.*`, `usage.updated`, `plan.updated`, `diff.updated`, `capability.event`) and operations (`initialize`, catalogs, `thread.*`, `turn.start | steer | interrupt`, `request.respond`, `capability.invoke`). The exact shapes are owned by the package, not by this document.

Ordering rules every provider keeps:

- `turn.started` precedes any item of that turn;
- a `userMessage` is the first item of a user-origin turn;
- every started item is completed before `turn.completed`;
- at most one `agentMessage` with phase `final` per turn;
- `item.completed` carries full content.

Version policy: changes within v1 are additive only. A breaking change bumps the version and `initialize` negotiates it; a mismatch disables that provider with the `error` log "agent protocol version mismatch".

## Thread bindings

Every thread has an explicit binding, Codex threads included. "No binding means Codex" is never a rule.

- Record: redb table `agent_thread_bindings`, versioned `v:2`: `appThreadId`, `origin: created | discovered | backfilled`, `createdAtMs` and ordered `segments [{provider, nativeThreadId, firstTurnOrdinal, lastTurnOrdinal | null, handoffRefs[]}]`. Each segment is one provider's native thread serving a contiguous run of the app thread's turns; the app thread id is the first segment's native id; routing uses the active (last) segment. The v1 fields (`activeProvider`, `refs {provider → ProviderThreadRef}`) are kept as a copy so a rolled-back companion still routes. v1 records are upgraded once (marker `agent_bindings_segments_v2`).
- Table `agent_thread_continuations`: native threads that are non-first segments of an app thread. Hiding rule: a continuation is never listed, searchable or addressable as its own thread.
- History of an app thread: its segments' native turns in segment order, a closed segment contributing at most its ordinal span (`assemble_history`). Turns and items carry optional `provenance {provider, nativeThreadId}`; adapters stamp it where absent.
- Phase-1 invariants: exactly one segment; its native id equals `appThreadId`; the provider never changes.
- Writers, independent of provider identity:
  - **create** — `thread/start` names a provider in `codewideAgentProvider` (absent or `null` → the primary provider, for older clients; an invalid id → `-32602 "codewideAgentProvider is invalid"`); the companion mints a UUIDv7 `AppThreadId` for providers declaring `threads.hostMintedIds`, otherwise takes the provider-minted id; the binding is written before the response;
  - **backfill** — one-time job `agent_bindings_backfill_v1` (durable progress marker per provider) for every provider declaring `threads.externalDiscovery` (Codex and Claude); pages non-archived then archived threads through the neutral `thread.list` (the Codex adapter asks for all source kinds, state-DB only; Claude lists its own and terminal-started sessions), 100 rows per page; restart-safe and duplicate-free. It runs only when the companion is in active mutation mode, starts 30 s after companion startup and then waits until the provider is live;
  - **observation** — every listed row and every `thread.updated` upserts its binding;
  - **discovery on a miss** — a thread id without a binding:
    - exactly one provider declares `threads.externalDiscovery` → the call is routed provisionally to that provider without an extra `thread.owns` call; the `discovered` binding is written only after the provider accepts the call, so a rejected call leaves no binding and the provider's own error reaches the client;
    - several providers declare it (Codex and Claude) → each is asked in registry order via `thread.owns` (Codex, then Claude; Claude answers from its native index first, then from the host); the first owner gets a `discovered` binding before the call is routed;
    - no provider declares it, or none owns the id → `-32600 "thread not found: <id>"`.
- An upsert never changes an existing binding's provider. A conflicting claim is logged at `error` and ignored.
- `thread_metadata.model_provider`, model ids and id shape are never used for routing.

## Capabilities

Each provider declares its capability set at `initialize`. The registry indexes them.

Client-wire extensions are attached only when more than one provider is enabled (`ProviderRegistry::is_multi_provider`). A Codex-only host therefore keeps today's client wire byte-for-byte. In multi-provider mode:

- every projected `Thread` — RPC results (`result.thread`, `thread/list` and `companion/supervisor/threadList` rows), `thread/started`, and durable replay of notifications projected in this mode — carries `Thread.codewideAgent {provider, providerName, primary, capabilities}`: the bound provider id, its display name (badge text only), whether it is the primary provider (no badge) and its declared capability set. The TypeScript shape is `CodewideAgentThreadExtension` in `packages/agent-protocol`;
- `model/list` and `permissionProfile/list` carry the `codewideAgentProvider` / `codewideAgentProviders` annotations described below.

A thread without `codewideAgent` (single-provider or legacy companion) is treated by the client as a Codex thread with every capability.

| Capability | Codex | Claude |
|---|---|---|
| `turns.steer` | yes | yes |
| `turns.startWhileActive` | `nativeJoin` | `busy` |
| `turns.providerInitiated` | no | yes |
| `threads.hostMintedIds` | no | yes |
| `threads.externalDiscovery` | yes | yes |
| `threads.compact` | yes | yes |
| `threads.fork` | yes | no |
| `requests.userInput` | yes | yes |
| `requests.mcpElicitation` | yes | no |
| `requests.dynamicToolCall` | yes | no |
| `settings.serviceTier` | yes | no |
| `settings.personality` | yes | no |
| `input.skillsAndMentions` | yes | no |
| `catalog.skillsPlugins` | yes | no |
| `review` | yes | no |
| `goals` | yes | no |
| `backgroundTerminals` | yes | no |
| `realtimeVoice` | yes | no |
| `globalSupervisor` | yes | no |
| `subagentThreads` | yes | no |
| `accounts.pool` | yes | no |
| `accounts.rateLimits` | yes | no |
| `history.threadResources` | yes | yes (with host storage) |
| `history.messageSearch` | yes | yes (with host storage: the Claude native index) |
| `host.fs` | yes | no |
| `codex.native` | yes | no |

Routing and degradation, by capability only:

- A thread-scoped call resolves the binding (discovery first), then requires the capability its client-wire method maps to. Missing → `-32072 "<capability> is not supported by this thread's agent"` with `data {capability, provider}`, without contacting the provider.
- A connection-scoped call (`config/read`, `fs/*`, `skills/list`, `plugin/*`, realtime start, account methods) goes to the registry's owner of the matching host capability (`host.fs`, `host.config`).
- `model/list` in multi-provider mode: every row carries `codewideAgentProvider`; the first page appends other providers' rows after the primary provider's rows; exactly one `isDefault` (the primary's); at most 100 rows; a duplicate model id keeps the earlier provider's row. Non-primary rows are labelled `"<Provider> · <displayName>"`. With one provider the response is unchanged.
- `permissionProfile/list` in multi-provider mode: every row carries `codewideAgentProviders` (the providers offering it); profiles offered only by non-primary providers are appended. With one provider the response is unchanged.
- Thread pins are companion state, not agent storage: `thread_pins.rs` stores them in the companion store and SyncHub annotates `codewide.threadPin {version, pinned, cursor}` on `result.thread` and on `thread/list` / `companion/supervisor/threadList` rows of every provider; a pin read failure returns `-32020 "Thread pin projection unavailable"`.
- Clients decide features only from `codewideAgent.capabilities`, never from model ids or provider names. The provider name is used only as badge text.

## Delivery, steer and interrupt

- Neutral `turn.start` never steers implicitly. A provider whose thread is active and declares `turns.startWhileActive: busy` returns `busy {activeTurnId}`; the companion puts that outbox command back in the queued state ("deliver after idle") and redelivers it once on that thread's `turn.completed`. The client sees an ordinary queued item through `companion/queue/changed`.
- `nativeJoin` (Codex) keeps today's App Server behavior: the adapter reports `started` with the joined turn id, so Codex wire behavior is unchanged.
- Steer is only an explicit `turn.steer {expectedTurnId}`; a mismatch returns `-32600 "expected turn is not active"`.
- `turn.interrupt` answers `{}` within 1 s when a turn is active, already interrupted, completed or the thread is idle; it errors only for a foreign `turnId` during an active turn or an unknown thread. Open requests resolve with `request.resolved` before `turn.completed`. Repeats never hang.

## Error codes

- `-32070 "<Provider> provider is disabled on this host"` — terminal (`Rejected`, then `Failed`).
- `-32072 "<capability> is not supported by this thread's agent"`, `data {capability, provider}`.
- `-32020 "Thread binding is unavailable"` — the binding store could not be read or written while resolving a thread-scoped call (logged at `warn` with `err`).
- Claude agent host not live → transport `UpstreamError::Reconnecting` (outbox retries); a direct RPC gets the existing `-32003`.
- `-32600 "native session not found: <id>"` — `nativeSession.read` of a session the provider's store does not have.
- `-32601` — `nativeSession.list` / `nativeSession.read` on a provider without a native session store.
- `-32071` is not used: there is no session cap.

## Compatibility surfaces

| Surface | Decision | Owner | Removal condition | Negative check |
|---|---|---|---|---|
| `codex.native` — Codex notifications and request params without a neutral or capability mapping pass through unchanged as `capability.event` or `providerOptions["codex.native"]` | `keep_temporarily` | backend | every Codex method the client uses has a neutral or capability mapping and the client speaks the neutral protocol | no other provider emits it; the projector drops `providerOptions` for capabilities the target provider lacks (logged at `debug`) |
| ~~Codex storage modules stay in place~~ — **done**: `history_service`, `history`, `rollout*`, `catalog*`, `resources`, `message_search`, `account_pool`, `rollout_store` and the OpenAI price table (`pricing.rs`) live in `crates/agent-provider-codex/src/` | `removed` | backend | — | SyncHub reaches history, message search and resources only through the `NativeSurface` storage traits (`crates/agent-core/src/provider/native_storage.rs`), implemented by `CodexStorage` (`crates/agent-provider-codex/src/storage.rs`). Usage is split: provider-neutral accounting and `prepare_replay_payload` in `crates/agent-core/src/usage.rs`; `LiveUsageProjector` stays in `crates/companion-core/src/usage.rs`; SyncHub prices through `AgentProvider::usage_pricing` (the registry's `UsagePricing`), so no price table lives outside its provider crate |
| `wire-request-ids-v0` — primary-provider runtime request ids are emitted unchanged (the client persists them); other providers' ids are emitted as `"cw-<provider>:" + JSON(nativeId)`; a primary-provider string id starting with `cw-` is rejected and logged | `keep_temporarily` | backend | the client moves to the neutral protocol | non-primary ids always carry the prefix; a reconnect of one provider resolves only that provider's user-interaction requests |

## Claude provider

The Claude provider is one crate, `crates/agent-provider-claude`: the Rust adapter (`src/`) and the Claude agent host (`host/`, package `@codewide/claude-agent-host`), a Node process that exists only as the adapter's child (formerly `apps/claude-sidecar`).

- **Process model.** The Claude adapter supervises one Claude agent host child and speaks `codewide-agent` v1 JSON-RPC over stdio. The host opens one Agent SDK query per live session against the user's own `claude` CLI.
- **Session lifecycle.** `Shell` (hidden from the non-archived list until the first user message) → `Active` ↔ `Idle` → `Released` (idle release) → resumed on the next turn; a lost session is recovered with a new session id and a bounded transcript prefix (up to 16 KiB under `[Historical conversation from this thread]`, built from whatever history Claude's store still has for the thread); a second loss in the same turn fails it.
- **Idle release.** After 30 min without activity (configurable 5–240 min); never while a turn is active or a request is pending; background tasks defer release up to 4 h.
- **No session cap.** One idle `claude` process costs about 125 MB PSS (research probe P2), and idle release bounds the steady state. Without a cap, a host-killed `claude` process fails only its own active turn ("Claude process exited unexpectedly"); its open requests resolve, the session becomes `Released` and the next turn resumes it. The host logs its live session count at `info` on every open and release. The companion memory watch reads only the companion main PID, so host children do not trigger its alerts.
- **Permission profiles.** `:read-only` restricts built-in tools to Read/Glob/Grep/LS, disables settings sources and MCP, and denies everything else in `canUseTool`; `:workspace` accepts edits with user/project/local settings and asks for the rest; only `:full-access`/`:danger-full-access` bypasses permissions; an unknown profile returns `-32602 "Unsupported permission profile for Claude: <id>"`.
- **Approval decisions.** `accept` → allow; `acceptForSession` → session-scoped permissions only (never a settings file); `decline` → deny; `cancel` → deny with interrupt. `canUseTool` never returns `null`; a decline or response error never becomes allow.
- **Credentials.** No CodeWide component reads, stores, forwards or logs Claude credentials, tokens or `ANTHROPIC_*` values. Auth state comes only from the SDK initialization result. The Rust watcher reads only directory entries and size/mtime under `$CLAUDE_CONFIG_DIR/projects` (or `~/.claude/projects`); session records are read only by the host through the SDK. Claude usage is unpriced.
- **Logs.** Full errors in `err`; opaque ids allowed; prompts, outputs, tool inputs and env values never logged.

### History and thread list from Claude's session store

The Claude provider is symmetric with Codex: Codex's adapter crate owns rollout storage, a rollout parser and a native index; Claude's adapter crate (`crates/agent-provider-claude`, Rust) owns its native index in the companion's `state.redb` and a watcher on Claude's session files, and the Claude agent host is its parser — it reads Claude's native sessions only through the official SDK session API and maps them to neutral items. The host keeps no conversation copy and no index or cache of history.

#### Native session operations (additive v1)

Two optional operations, typed in `packages/agent-protocol` (`OperationMap`, `NativeSession`, `NativeSubagent`; fixture `fixtures/v1/native-sessions.json`). A provider without a native store answers `-32601`; no capability is added, because only the provider's own adapter crate calls them.

- `nativeSession.list {dir: string|null, cursor: string|null, limit}` → `{sessions: NativeSession[], nextCursor}` — every session of one project directory (with its git worktrees) or of all projects, programmatic and interactive, newest first, at most 500 per page. `NativeSession {sessionId, appThreadId, cwd, title, summary, firstPrompt, createdAtMs, lastModifiedMs, fileSize, interactive}`: `appThreadId` is the session id, or the CodeWide thread a replacement session continues; `lastModifiedMs` and `fileSize` let the index detect a change cheaply; `interactive` marks sessions a person started (terminal, IDE). The cursor (`v1:<offset>`) is opaque; a store change between pages may shift entries, which a re-index tolerates.
- `nativeSession.read {sessionId}` → `{session, turns: AgentTurn[], subagents: NativeSubagent[]}` — one session as neutral turns, rebuilt as below, plus each sub-agent transcript (`getSubagentMessages`) as `{agentId, parentAgentId, parentToolUseId, turns}`, sorted by `agentId`; `parentToolUseId` links it to the spawning tool item. Ids depend only on the stored messages and the host's turn index: turn id = the host's turn id or the uuid of the turn's first stored message; items `{turnId}:user:{n}`, `{message.id}:{block}`, `tool_use.id`, `{tool_use.id}:image`, the compact-boundary uuid. Reading unchanged input twice returns equal results, so re-indexing is idempotent. A turn still running in the session is returned as its live snapshot (`inProgress`); after `turn.completed` the companion re-reads and re-indexes. Unknown session: `-32600 "native session not found: <id>"`.
- `NativeSession.codewide` (optional; omitted for a session CodeWide never touched) carries every `thread.list` row field Claude's store cannot hold: `{createdAt, cwd (the CodeWide thread's working directory, where its turns run), origin: "interactive" | "external", presence: {type: "listed", archived} | {type: "deleted", deletedAt}, recencyAt: number | null, settings: ThreadSettings (effective: pending settings when set), title: {type: "none"} | {type: "pending", name} | {type: "cleared", hiddenTitle}, updatedAt}` (unix seconds). The row name is the latest session title of the thread, replaced by `title.name` when `pending`, and `null` when `cleared` and the store title equals `hiddenTitle`. Tombstoned threads whose session still exists are listed with `presence.type: "deleted"`, never silently dropped. Every session of a chain carries the same object.
- Each session's `turns` hold only that session's share of its thread: a replacement session after a lost session starts with the resent prompt (history prefix removed, the original turn id and `clientMessageId`) and never repeats earlier turns. If the old session still exists in the store, the interrupted turn appears in both sessions under the same turn id; the later session's share is the continuation.
- Every turn and item the host emits (live events, `thread.turns`, `nativeSession.read`) carries `provenance {provider: "claude", nativeThreadId: <appThreadId>}` (phase 1: the Claude thread is its only native thread).
- Live turns keep streaming as events; `thread.list`, `thread.read` and `thread.turns` keep working from Claude's store until the companion serves them from its index.

- `thread.list`, `thread.read`, `thread.turns` and `thread.owns` read Claude's own session store through the SDK session API: `listSessions` (all sessions, and `includeProgrammatic: false` for sessions a person started), `getSessionInfo` and `getSessionMessages`. `thread.update` name and delete use `renameSession` and `deleteSession`.
- Listed threads are CodeWide's own threads plus every session a person started outside CodeWide (for example, `claude` in a terminal or an IDE), with the session id as thread id, `origin: external` and default settings (`model: default`, `:read-only`) until changed. Other SDK-started sessions are not listed unless the host owns them. `thread.list` semantics are unchanged: params, the `v1:<sortKey>:<direction>:<valueSec>:<id>` cursor, the sort keys (`recencyAt` falls back to `updatedAt`), windows, search over name else first prompt, and shells hidden from the non-archived list. Every listing rescans Claude's store; the host keeps no index or cache of history.
- Name: Claude's session title (`/rename`, `renameSession` or Claude's generated title). A name given before Claude created the session is kept by the host and applied with `renameSession` once the session exists; clearing a name (Claude cannot) hides the current title in the host. Repeats emit `thread.updated` only on a real change.
- Delete writes a host tombstone, then deletes every session of the thread's chain with `deleteSession`; a session Claude no longer has counts as deleted, a failed removal is logged at `error` and retried by a repeated delete, and repeats always answer `{thread: null}`.
- The host keeps only metadata Claude's store cannot hold (`<journalDirectory>/threads/<id>/state.json`, version 2): the session chain, settings and pending settings, the archive flag, the tombstone, a title override, cumulative usage and a turn index (turn id, origin, outcome and error, prompt uuids with their role and `clientMessageId`). `active-turn.json` holds the in-flight turn's snapshot until it ends, so a host restart finalizes it as interrupted. No conversation content is stored. A v1 journal of the former sidecar is converted on first start (its copied turns are left on disk unused and can be deleted).
- History is rebuilt from the stored messages of the session chain and replayed through the live `TurnBuilder`, so turns and items have the live ids, types, ordering and final-answer rule. A user turn's id is the uuid of its first prompt offer, which Claude persists. Turn boundaries are derived: a prompt starts a user turn unless the index knows it as a steer or a resent prompt; a task-notification or peer message starts a provider turn; `[Request interrupted by user…]` ends a turn as interrupted; the first persisted message of every host-driven turn starts that turn. The active turn is served from the live snapshot.
- Lost in history compared with live: reasoning text (Claude stores only thinking signatures; reasoning items keep their ids with empty summaries), Bash stdout/stderr split (the tool result text is used), applied patches (file diffs are rebuilt from Edit/MultiEdit/Write input; a `Write` over an existing file shows as `add`), tool durations other than tool_use → tool_result timestamps, MCP server names when they contain `__` (the init frame is not stored), sub-agent internals, and — for sessions the host did not drive — `clientMessageId` echoes, failed outcomes and steer grouping. If Claude's store loses a session, its history is gone too, and a replacement session gets only the prefix the store still allows.

### Discovery of sessions started outside CodeWide

- Claude declares `threads.externalDiscovery` (adapter baseline and host). A terminal-started session becomes a thread when it appears in a merged `thread/list` page or a `thread.updated` event (observation), through the one-time backfill over Claude's `thread.list`, or on a miss: discovery asks Codex then Claude via `thread.owns`; Claude answers from its native index first, then from the host, which owns any session in Claude's store that is not another thread's continuation.

### Claude native index

- `thread.list`, `thread.turns`, message search and thread resources of Claude threads are served from the companion's Claude native index; the host answers until the index is fresh. The provider-neutral thread resource model, projection and service live in the shared crate `crates/agent-resources`; Codex keeps its rollout reading and its own store.
- Freshness: the index serves `thread.list` only after a listing pass matched the host, while no turn runs and no re-read is pending; a `thread.updated` the index would list differently triggers a collapsed re-pass. Deleted threads are dropped from list, search and `thread.owns`. Turns are de-duplicated by turn id across a thread's sessions (the later session wins).
- Known gaps: a CodeWide thread with no session file yet, and a first prompt Claude has not written yet, are not in the index list (the host answers during running turns anyway). Merged search treats a failing provider index as a failed source and errors only when every source fails.

- Symmetric with Codex's rollout index: the Claude adapter crate derives disposable tables inside the companion's index database — `claude_sessions` (session id → indexed session), `claude_session_turns` (session id + ordinal → one neutral turn) and `claude_thread_sessions` (app thread id + session id) — versioned by `claude_index_logic_version` (a change drops and rebuilds them).
- Watcher: filesystem events under Claude's projects directory trigger a debounced rescan, plus a periodic 30 s rescan. It compares each session's `fileSize` and `lastModifiedMs` from `nativeSession.list` (the file's byte size and floor of its mtime in ms) with the index and re-reads only changed sessions.
- Indexer: backfills every listed session with `nativeSession.read`, re-reads a session after a change or after `turn.completed` of a live turn, and removes sessions that left the store. CodeWide thread metadata from `NativeSession.codewide` is published to the companion's thread index, so the catalog and thread list are served from the index; tombstoned sessions (`presence.type: "deleted"`) are dropped there.
- Freshness rule: the index serves `thread.turns` only when the thread has no running turn and no pending re-read; otherwise the call goes to the host.
- Message search: the adapter writes indexed turns into `claude-message-search.sqlite` using the shared `crates/agent-search` schema (`documents::replace_thread`). `companion/search` routes to every provider declaring `history.messageSearch` and merges results in the shared order (newest first, then thread id, then the later position); continuations are never search results.

### Install and configuration

- Host prerequisites: Node ≥ 22 (tested) or Bun (best-effort); the user installs and signs in to the `claude` CLI.
- Config file `<companion state dir>/agent-providers.json`: `version: 1`, `primary: "codex"`; `providers.claude` with absolute `runtimeExecutable`, `sidecarEntry` (the host's `dist/main.js`; key name kept for compatibility), `claudeExecutable`, plus `journalDirectory` (the host's metadata directory; passed as `--journal-directory`, which the host also accepts as `--state-directory`) and `idleReleaseMinutes`.
- File absent, unreadable or invalid → Codex only, built from the existing host flags (an unreadable or invalid file is logged once at `error`); the registry is still built and holds one provider. An invalid `providers.claude` entry or an unknown provider id → only that provider is disabled, with one `error` log.
- `registry.rs` parses the file with opaque per-provider entries; the mapping from a provider id to its adapter lives in `crates/companion-core/src/agent/providers/mod.rs` (`build_registry`), so the registry never imports an adapter.
- `crates/agent-provider-claude/host/package.json` is the single SDK version source; the install lock check (`scripts/checkInstallLock.mjs` against `host/install/`) fails the host tests on drift.
- `scripts/install-claude-provider.sh` copies the host's `dist/`, installs its pinned dependencies without optional packages or install scripts into `~/.local/lib/codewide/claude-agent-host` (formerly `…/claude-sidecar`; re-running the script repoints `sidecarEntry`), writes the config and installs the systemd drop-in only if E-HARDEN requires it.

### Pending host evidence

- **E-HARDEN** — whether the Claude agent host and a Bash turn work under `codewide-companion.service` hardening. Outcome: *not yet recorded*. On failure, a backend drop-in relaxes only the proven properties, for the companion unit only.
- **Idle memory** — load run with 10 sessions (expected about 125 MB PSS each while idle, released after the idle timeout). Measurement: *not yet recorded*. It is not a pass threshold.
- **E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE** — SDK experiments gating the host mapping. Fallbacks that keep the contract: steer without a uuid; release the session after an interrupt that hit a running tool.

## Rollback

- Triggers: any Codex golden-replay diff or Codex regression; a Claude permission bypass; more than 5 Claude agent host restarts in 10 min.
- **Disable Claude:** remove `providers.claude` from `agent-providers.json` and restart the companion. Claude models leave the picker, calls on Claude threads return `-32070`, queued Claude commands fail once, Claude rows leave the list. Bindings and the host's thread metadata stay; nothing is deleted.
- **Revert the layer:** revert the C3 switch-over commit. The old single-upstream route returns. The binding table is ignored and needs no reverse migration.
