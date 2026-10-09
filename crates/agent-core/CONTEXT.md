# Agent core

## Purpose and owner

The provider-neutral core of the agent provider layer, shared by `companion-core` and every adapter crate. It depends on no CodeWide crate. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md) and [`docs/agent-providers.md`](../../docs/agent-providers.md).

## Module jobs

- `model/` — serde mirror of `packages/agent-protocol` v1 with branded ids (`ids.rs`, `capabilities.rs`, `thread.rs`, `events.rs`, `operations.rs`, `tools.rs` for client-side tools (`ClientToolSpec`, the `tool.call` request and result), `sessions.rs` for the optional `nativeSession.list` / `nativeSession.read`, including a session's CodeWide metadata `NativeSessionCodewide`). It must round-trip that package's fixtures (`fixture_tests.rs`). `thread.rs` also holds `Provenance` (the provider native thread of a turn or item, optional and Rust-first until the package adds it) and `turns.rs` the shared `thread.turns` paging (`page_turns`, `view_items`).
- `provider.rs` — `ClientToolHost` (the companion owner of client-side tools that providers declare and route calls to, `AgentProvider::install_client_tools`) and the `AgentProvider` trait: describe, catalogs, thread and turn operations, request responses, history pages, `capability.invoke`, event and status subscription (`ProviderStatus`, the transport lifecycle) and health (`ProviderHealth`: available with a `ProviderAuth` sign-in state, or unavailable; default available/unknown). Optional native features are capabilities, not trait methods; the exceptions are the `codex.native` `NativeSurface`, `usage_pricing` (a provider's price table; `None` = unpriced) `message_search` and `thread_resources` (`None` without a stored-history index).
- `provider/stored_search.rs` — `StoredMessageSearch`: search over a provider's own stored history in neutral form (`AgentProvider::message_search`); windows carry neutral turns.
- `provider/native_storage.rs` — `NativeThreadStore`, `NativeMessageSearch`, `NativeThreadResources`: host storage of `codex.native` threads, exposed through `NativeSurface` accessors `thread_store()/message_search()/thread_resources()` (part of the `codex.native` compatibility surface). Only the Codex adapter returns implementations.
- `usage.rs` — provider-neutral token accounting: counters, cost and usage projections, the `ModelPricing` price-table contract, `UsagePricing` (the enabled providers' tables in registry order) and the replay-journal pricing helpers. No price table lives here. A thread is priced only by its own provider's table (`UsagePricing::for_provider`); a provider-reported cost (`ProviderCost`, the `codewideProviderCost` client-wire field) becomes a `CostProjection` with `basis: "providerReported"`, and a recorded turn usage (`AgentTurn.usage`) projects through `TurnUsageProjection::from_record`.
- `request_ids.rs` — `wire-request-ids-v0`: the client-wire encoding of runtime request ids (compatibility surface, see `docs/agent-providers.md`).

## Boundary

- Must not depend on `companion-core`, `companion-host`, `agent-transport` or an adapter crate.
- Must not name a provider id, a price or a provider storage format.
