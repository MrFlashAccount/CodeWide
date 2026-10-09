# Agent provider layer

## Purpose and owner

`agent.rs` and `agent/**` are the companion's bounded context for talking to coding agents. All agent traffic — RPCs, events and runtime requests — reaches a provider only through the `AgentProvider` trait. Codex and Claude are equal adapters. The cross-zone contract (neutral protocol, capability table, bindings, error codes, rollback) is in [`docs/agent-providers.md`](../../../../docs/agent-providers.md).

Code owner: backend. This document: architect.

## Module jobs

- `model/` — serde mirror of `packages/agent-protocol` v1 with branded ids (`ids.rs`, `capabilities.rs`, `thread.rs`, `events.rs`, `operations.rs`). It must round-trip that package's fixtures (`fixture_tests.rs`).
- `provider.rs` — the `AgentProvider` trait: describe, catalogs, thread and turn operations, request responses, history pages, `capability.invoke`, event and status subscription. Optional native features are capabilities, not trait methods; the only exception is the `codex.native` `NativeSurface`.
- `provider/native_storage.rs` — `NativeThreadStore`, `NativeMessageSearch`, `NativeThreadResources`: host storage of `codex.native` threads, exposed through `NativeSurface` accessors `thread_store()/message_search()/thread_resources()` (part of the `codex.native` compatibility surface). Only the Codex adapter returns implementations.
- `registry.rs` — enabled providers in configured order (primary first), the capability index, host-level capability owners (`host.fs`, `host.config`), the discovery providers, `is_multi_provider` (more than one provider enabled) and the parser of `agent-providers.json` with opaque per-provider entries. It names no concrete provider and does not import `providers/`; `build_registry` in `providers/mod.rs` is the only place outside `providers/<id>/` that may name a provider id.
- `providers/mod.rs` — the configuration → adapter factory (`load_registry`, `build_registry`): the only code outside `providers/<id>/` that maps a provider id to its adapter. Codex is always enabled; an invalid or unknown entry disables only that provider; a missing, unreadable or invalid file means Codex only.
- `bindings.rs` — the `agent_thread_bindings` store, the `agent_bindings_backfill_v1` job (`run_backfill`), observation upserts and routing on a miss (`route`: bound, provisional or unknown).
- `client_wire/` — the single client-wire ↔ neutral translation: `decode.rs` (request classification), `gateway.rs` (routing by binding or capability, degradation errors, provisional-binding confirmation, `thread/start` provider choice), `items.rs`, `results.rs`, `events.rs`, `settings.rs`, `history.rs` (neutral → v0.155.1 projection), `request_ids.rs` (`wire-request-ids-v0`), `list.rs` (merged `thread/list`), `catalog.rs` (merged `model/list` and `permissionProfile/list`). `mod.rs` owns `Thread.codewideAgent {provider, providerName, primary, capabilities}`; it and the `codewideAgentProvider` / `codewideAgentProviders` annotations are attached only in multi-provider mode.
- `providers/codex/` — see [its CONTEXT](providers/codex/CONTEXT.md).
- `providers/claude/` — see [its CONTEXT](providers/claude/CONTEXT.md).
- `testing.rs` — the in-memory fake provider for unit tests of this layer.

SyncHub (`sync.rs` and `sync/`) keeps sessions, the outbox and ingest. It holds the `ProviderRegistry`, routes RPCs through `client_wire`, requeues a `busy` start until the thread's `turn.completed`, spawns the backfill job for each discovery provider (active mutation mode only, 30 s after startup), and runs one ordered forwarder per provider into the existing ingest channel. It no longer holds a raw `UpstreamHandle`. It reaches thread history, message search and thread resources only through the `NativeSurface` storage traits of the capability owner (or of the thread's own provider), never by provider id. Ingest still uses `crate::usage` directly: `LiveUsageProjector` and `prepare_replay_payload` run during ingest. Pins are companion state in `thread_pins.rs` and the store, not agent storage.

## Invariants

- The binding decides the provider. Model id, `thread_metadata.model_provider` and id shape never do. Every thread has an explicit binding; an upsert never changes an existing binding's provider.
- Discovery on a miss: with exactly one `threads.externalDiscovery` provider the call is routed provisionally to it (no `thread.owns` call) and the `discovered` binding is written only after that provider accepts the call; with several, `thread.owns` is asked in registry order and the first owner is bound before routing; otherwise `-32600 "thread not found: <id>"`.
- A host with one enabled provider emits no client-wire extension field; its wire is byte-for-byte today's.
- Capabilities decide features and degradation. A thread-scoped call without the mapped capability returns `-32072` without contacting the provider.
- The neutral → wire translation exists once, in `client_wire`. Adapters never emit client-wire JSON.
- Neutral `turn.start` never steers; steer is only explicit `turn.steer`.
- Phase-1 binding: exactly one ref, equal to `appThreadId`; `activeProvider` never changes.

## Dependency rules (`must_not_import`, checked by grep in review)

- `client_wire`, `registry` and `bindings` must not import `agent/providers/*`, `upstream`, `account_pool`, `history_service`, `rollout`, `catalog` or `resources`.
- `providers/claude` must not import the Codex storage modules.
- `sync.rs` must not import `upstream` request APIs.
- `sync.rs`, `sync/*`, `thread_view.rs` and `sync_pending.rs` must not import `history_service`, `resources`, `account_pool`, `rollout`, `catalog`, `catalog_visibility` or `message_search`; they reach that storage only through the `NativeSurface` storage traits of the capability owner.
- No `match`/`if` on a `ProviderId` value outside `providers/<id>/` and the factory in `providers/mod.rs`.
- Only `providers/codex/` imports the Codex storage modules listed below.

## Compatibility surfaces

- **Codex storage modules stay at their current paths** (`keep_temporarily`, backend): `history_service`, `history`, `rollout`, `rollout_monitor`, `catalog`, `catalog_visibility`, `resources`, `message_search`, `account_pool`, `usage`. They are Codex-adapter-owned. Removal condition: moved under `providers/codex/` in a later slice. Negative check: none is imported from `agent/` outside `providers/codex/`.
- **`codex.native`** and **`wire-request-ids-v0`** (`keep_temporarily`, backend) — defined in [`docs/agent-providers.md`](../../../../docs/agent-providers.md#compatibility-surfaces) with their removal conditions and negative checks.

## Phase 2 room

In-thread provider switching extends the binding (more than one ref, a changing `activeProvider`) and the neutral model; it must not add provider-id branches outside `providers/<id>/`.

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`. Contract tests on a fake neutral provider and a fake App Server live in `apps/companion-linux/tests/agent_providers.rs`.
