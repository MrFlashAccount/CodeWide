# Agent provider layer

## Purpose and owner

`agent.rs` and `agent/**` are the companion's bounded context for talking to coding agents. All agent traffic — RPCs, events and runtime requests — reaches a provider only through the `AgentProvider` trait. Codex and Claude are equal adapters, each in its own crate. The cross-zone contract (neutral protocol, capability table, bindings, error codes, rollback) is in [`docs/agent-providers.md`](../../../../docs/agent-providers.md).

Code owner: backend. This document: architect.

## Crates

Dependency graph (an arrow points at a dependency):

```text
agent-transport        → agent-core
companion-host         → (redb, no agent crate)
agent-search           → (SQLite, no agent crate)
agent-resources        → agent-core, companion-host
agent-provider-codex   → agent-core, agent-transport, companion-host, agent-search, agent-resources
agent-provider-claude  → agent-core, agent-transport, companion-host, agent-search, agent-resources
companion-core         → all of the above
```

- [`crates/agent-core`](../../../agent-core/CONTEXT.md) — the neutral model, the `AgentProvider` contract, capabilities, provider-neutral token accounting and `wire-request-ids-v0`. Re-exported here as `agent::model` and `agent::provider`.
- `crates/agent-transport` — the JSON-RPC WebSocket and supervised stdio transports (`UpstreamHandle`), re-exported as `crate::upstream`.
- [`crates/companion-host`](../../../companion-host/CONTEXT.md) — narrow host contracts this crate implements for the adapters (thread index, canonical content, preview files, workspace VCS, derived index schemas, activity metrics).
- [`crates/agent-search`](../../../agent-search/CONTEXT.md) — the stored-message search index format and reads shared by the adapters.
- [`crates/agent-resources`](../../../agent-resources/CONTEXT.md) — the thread resource model, projection and reads shared by the adapters.
- [`crates/agent-provider-codex`](../../../agent-provider-codex/CONTEXT.md) — the Codex adapter and the Codex-owned storage.
- [`crates/agent-provider-claude`](../../../agent-provider-claude/CONTEXT.md) — the Claude adapter (Rust) and its index of Claude's session store; its TypeScript host lives in `crates/agent-provider-claude/host/`.

No adapter crate depends on `companion-core`; `companion-core` depends on both adapter crates only to wire them in.

## Module jobs

- `registry.rs` — enabled providers in configured order (primary first), the capability index, host-level capability owners (`host.fs`, `host.config`), the discovery providers, `is_multi_provider` (more than one provider enabled), the enabled providers' price tables (`usage_pricing`) and the parser of `agent-providers.json` with opaque per-provider entries. It names no concrete provider and does not import `providers/`; `build_registry` in `providers/mod.rs` is the only place outside the adapter crates that may name a provider id.
- `providers/mod.rs` — wiring of the adapter crates (`providers::codex`, `providers::claude` re-export them) and the configuration → adapter factory (`load_registry`, `build_registry`): the only code outside the adapter crates that maps a provider id to its adapter. `ProviderHost` hands the companion index, state directory, preview files and workspace VCS to adapters that keep their own index (Claude). Codex is always enabled; an invalid or unknown entry disables only that provider; a missing, unreadable or invalid file means Codex only.
- `providers/codex_hub.rs` — Codex host integration of SyncHub: Codex-only registry constructors from an App Server connection (`SyncHub::new`, `SyncHub::with_mutations`) and installation of the Codex-owned account pool. Hosts with several providers use `build_registry`.
- `providers/codex_golden_tests.rs` with `providers/testdata/app_server_streams.jsonl` — golden replay of recorded App Server streams through the Codex adapter and the wire projector (byte-identical client wire).
- `bindings.rs` — the `agent_thread_bindings` store (record v2: segments), the `agent_thread_continuations` index, the `agent_bindings_backfill_v1` job (`run_backfill`), observation upserts, routing on a miss (`route`: bound, provisional or unknown) and `assemble_history` (an app thread's history from its segments).
- `client_wire/` — the single client-wire ↔ neutral translation: `decode.rs` (request classification), `gateway.rs` (routing by binding or capability, degradation errors, provisional-binding confirmation, `thread/start` provider choice), `items.rs`, `results.rs`, `events.rs`, `settings.rs`, `history.rs` (neutral → v0.155.1 projection), `request_ids` (`wire-request-ids-v0`, owned by `agent-core`), `list.rs` (merged `thread/list`), `catalog.rs` (merged `model/list` and `permissionProfile/list`). `mod.rs` owns `Thread.codewideAgent {provider, providerName, primary, capabilities}`; it and the `codewideAgentProvider` / `codewideAgentProviders` annotations are attached only in multi-provider mode.
- `testing.rs` — the in-memory fake provider for unit tests of this layer.

SyncHub (`sync.rs` and `sync/`) keeps sessions, the outbox and ingest. `companion/search*` goes to the `history.messageSearch` owner with the `codex.native` surface; when an enabled provider searches its own stored history (`AgentProvider::message_search`, Claude), its threads' reads go to it and a global `companion/search` merges every searching provider's hits (`sync/search_routing.rs`); a Codex-only host keeps the single-owner path. Thread resources work the same way: a provider with its own resources (`AgentProvider::thread_resources`, Claude) answers its threads' resource reads and prewarms and observes its own events (`ResourceRoute` in ingest); every other thread keeps the `history.threadResources` owner. It holds the `ProviderRegistry`, routes RPCs through `client_wire`, requeues a `busy` start until the thread's `turn.completed`, spawns the backfill job for each discovery provider (active mutation mode only, 30 s after startup), and runs one ordered forwarder per provider into the existing ingest channel. It no longer holds a raw `UpstreamHandle`. It reaches thread history, message search and thread resources only through the `NativeSurface` storage traits of the capability owner (or of the thread's own provider), never by provider id. Ingest projects live usage with `crate::usage::LiveUsageProjector`, priced by the registry's `UsagePricing` (the enabled providers' `AgentProvider::usage_pricing` tables in registry order); pricing inputs, never prices, are journaled (`agent_core::usage::prepare_replay_payload`). Pins are companion state in `thread_pins.rs` and the store, not agent storage.

The host side of the adapters' storage stays here: `store.rs` (`IndexStore`) owns the index database, its schema version and the companion tables, migrates registered derived schemas (`IndexStore::open_with`) and implements `HostThreadIndex`; `content.rs` asks a `CanonicalContentSource` before its own bytes; `server/services.rs` resolves unknown threads through a `ThreadMetadataSource`; `files.rs` and `vcs.rs` implement `PreviewFiles` and `WorkspaceVcs`.

## Binding segments (phase-2 groundwork)

- A binding is an ordered list of segments `{provider, nativeThreadId, firstTurnOrdinal, lastTurnOrdinal | null, handoffRefs[]}`. The app thread id is the first segment's native id; routing uses the active (last) segment.
- Record v2 keeps the v1 fields (`activeProvider`, `refs`) as a projection, so an older companion still routes it. v1 records are upgraded once on open (marker `agent_bindings_segments_v2` in `agent_meta`) and read as one segment until then.
- A native thread that is a non-first segment (a continuation, indexed in `agent_thread_continuations`) is never its own app thread: merged `thread/list` rows and global search hits of it are dropped, binding observation and backfill skip it, and a call addressed to it is `thread not found`.
- An app thread's history is its segments' native turns in segment order, a closed segment contributing at most its ordinal span (`assemble_history`).
- Every neutral turn and item carries optional `provenance {provider, nativeThreadId}`; the adapters stamp it, the client wire never shows it.
- Phase 1 writes exactly one segment per binding; switching providers inside a thread is not implemented.

## Invariants

- The binding decides the provider. Model id, `thread_metadata.model_provider` and id shape never do. Every thread has an explicit binding; an upsert never changes an existing binding's provider.
- Discovery on a miss: with exactly one `threads.externalDiscovery` provider the call is routed provisionally to it (no `thread.owns` call) and the `discovered` binding is written only after that provider accepts the call; with several, `thread.owns` is asked in registry order and the first owner is bound before routing; otherwise `-32600 "thread not found: <id>"`.
- A host with one enabled provider emits no client-wire extension field; its wire is byte-for-byte today's.
- Capabilities decide features and degradation. A thread-scoped call without the mapped capability returns `-32072` without contacting the provider.
- The neutral → wire translation exists once, in `client_wire`. Adapters never emit client-wire JSON.
- Neutral `turn.start` never steers; steer is only explicit `turn.steer`.
- Phase-1 binding: exactly one segment, its native id equal to `appThreadId`; the provider never changes.

## Dependency rules (`must_not_import`, checked by grep in review)

- `agent-core`, `agent-transport`, `companion-host` and the adapter crates must not depend on `companion-core`; the adapter crates must not depend on each other.
- `client_wire`, `registry` and `bindings` must not import `agent::providers`, `agent_provider_codex`, `agent_provider_claude` or `upstream`.
- `sync.rs` must not import `upstream` request APIs.
- `sync.rs`, `sync/*`, `thread_view.rs` and `sync_pending.rs` must not import `agent_provider_codex`; they reach Codex storage only through the `NativeSurface` storage traits of the capability owner.
- No `match`/`if` on a `ProviderId` value outside the adapter crates and the factory in `providers/mod.rs`.
- Only `providers/`, `managed_runtime.rs` (the composition root) and test code import `agent_provider_codex`; this crate names no rollout format, `state_5.sqlite` path or `OpenAI` price outside that wiring.

## Compatibility surfaces

- **`codex.native`** and **`wire-request-ids-v0`** (`keep_temporarily`, backend) — defined in [`docs/agent-providers.md`](../../../../docs/agent-providers.md#compatibility-surfaces) with their removal conditions and negative checks.

## Phase 2 room

In-thread provider switching appends segments (`BindingStore::replace_segments`), hands context over through `handoffRefs` and assembles history with `assemble_history`; it must not add provider-id branches outside the adapter crates.

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`. Contract tests on a fake neutral provider and a fake App Server live in `apps/companion-linux/tests/agent_providers.rs`.
