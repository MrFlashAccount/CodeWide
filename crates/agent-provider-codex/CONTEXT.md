# Codex provider adapter

## Purpose and owner

The in-process `AgentProvider` implementation for Codex and the Codex-owned storage it wraps. It holds the `UpstreamHandle` connection to the Codex App Server, maps neutral operations to App Server methods and App Server notifications to neutral events, and owns everything that reads Codex's own storage (`CODEX_HOME` rollouts, `state_5.sqlite`, the account pool) and the `OpenAI` price table. It depends on `agent-core`, `agent-transport` and `companion-host`, never on `companion-core`. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md).

## Module jobs

Adapter:

- `lib.rs` — `CodexProvider`, the `AgentProvider` implementation over `UpstreamHandle`, the account pool and the Codex storage modules; exposes the `codex.native` `NativeSurface` and the `OpenAI` price table (`usage_pricing`); stamps neutral turns and items with `provenance {provider: "codex", nativeThreadId}` (phase 1: the app thread id).
- `storage.rs` — `CodexStorage`, the only bridge from the sync hub to the Codex storage modules: it implements `NativeThreadStore`, `NativeMessageSearch` and `NativeThreadResources` over `history_service` (rollout catalog and history), message search and `resources`, keeping the error messages and codes the hub forwarded before.
- `rollout_changes.rs` — watches rollout files written by other App Server processes and turns them into thread invalidations for the sync hub's journal (echoes coalesced, the trailing write never dropped).
- `client_tools.rs` — the installed client tools as `dynamicTools` on `thread/start`, and `item/tool/call` requests for them answered here (with their `serverRequest/resolved`) instead of reaching the client.
- `mapping.rs` — pure App Server values → neutral model and neutral params → App Server params (`thread.list` asks for all source kinds, state-DB only).
- `dispatch.rs` — thread-mutation dispatch with account admission and one safe resume-retry.
- `host.rs` — Codex services the companion host wires in at startup: the catalog metadata warmup (`spawn_catalog_warmup`) and `RolloutThreadMetadata`, the `ThreadMetadataSource` for threads the host index does not know yet.

Codex-owned storage:

- `rollout_store.rs` — the rollout tables inside the companion's index database (`RolloutStore`, `ROLLOUT_INDEX_SCHEMA`, `ROLLOUT_LOGIC_VERSION`, `TurnRef`, `RecordRef`, `FileState`); thread metadata and pins are written and read through `HostThreadIndex`.
- `rollout.rs`, `rollout_monitor.rs`, `rollout_content.rs` — rollout indexing and metadata, the rollout file watcher, canonical command output (`RolloutContentSource`, a `CanonicalContentSource`).
- `history.rs`, `history_questions.rs`, `history_service.rs` — turn projection from rollouts and history paging.
- `catalog.rs`, `catalog_visibility.rs`, `catalog_summary.rs` — the session catalog over `CODEX_HOME` rollouts and `state_5.sqlite`.
- `resources.rs` — thread resources of Codex threads: the shared `agent-resources` reads over projections built from rollout records (compact redb store), plus `companion/threadChangeOutput/read` from the rollout.
- `message_search/` — full-text search over stored messages: incremental rollout indexing into the shared `agent-search` schema, read through its `query` and `context`.
- `account_pool.rs` — the `OpenAI` account pool.
- `pricing.rs` — the `OpenAI` API-equivalent rates (data for the shared `CatalogPricing`, published as `catalog.models` `prices` and served as `OpenAiPricing`) and the usage projection of turns read back from rollouts.
- `user_text.rs` — `CodexUserText`, Codex's own formats in user text: model-only context the App Server sends as user input and Codex Desktop's envelopes (request heading, browser context, image tags, realtime delegation, question replies). Declared through `AgentProvider::user_text_cleaner` and used by thread-list previews.

Host construction (`apps/companion-linux/src/main.rs`, `crates/companion-core/src/managed_runtime.rs`): open the host index with `IndexStore::open_with(path, &[&ROLLOUT_INDEX_SCHEMA])`, attach `RolloutStore::attach(index.database(), index)`, then `CodexProvider::new(upstream).with_storage(CodexStorage::new(history).with_resources(resources))`. The Codex-only `SyncHub` constructors in `companion-core` (`agent/providers/codex_hub.rs`) attach `CodexStorage::new(history)` without resources. The golden replay of recorded App Server streams through this adapter and the wire projector lives in `companion-core` (`agent/providers/codex_golden_tests.rs`), next to the projector.

AccountPool runs only inside this adapter's `turn.start` and `thread.update(settings)`. That is how every other provider bypasses it, with no provider-name check anywhere. SyncHub reaches the Codex storage modules only through this adapter: storage through `CodexStorage` behind the `NativeSurface` storage traits, the account pool inside `turn.start` and `thread.update(settings)`, prices through `usage_pricing`.

## Declared behavior

- Capabilities: the Codex column of the table in [`docs/agent-providers.md`](../../docs/agent-providers.md#capabilities), including `threads.externalDiscovery` (CLI and VS Code threads), `turns.startWhileActive: nativeJoin` and `codex.native`.
- As the only `threads.externalDiscovery` provider on a Codex + Claude host, it receives unbound thread ids provisionally; the companion writes the `discovered` binding only after this adapter accepts the call. `thread.owns` (a `thread/read` probe) is used only when several providers declare discovery. It is also the backfill source (see [thread bindings](../../docs/agent-providers.md#thread-bindings)).
- `turns.startWhileActive: nativeJoin` — the App Server itself joins an active turn; the adapter reports `started` with that turn id, so Codex client-wire behavior is unchanged.
- Codex mints its own thread ids; the binding takes the returned id.

## `codex.native` surface

Codex notifications and request params with no neutral or capability mapping pass through unchanged as `capability.event` or `providerOptions["codex.native"]`, so phase 1 cannot regress unmapped Codex features. `keep_temporarily`, owner backend. Removal condition: every Codex method the client uses has a neutral or capability mapping and the client speaks the neutral protocol. Negative check: no other provider emits it.

## Invariants

- Without a model call of an installed client tool the client wire is unchanged; installed tools change only the `thread/start` request sent upstream.

- A golden replay of recorded App Server streams and RPC exchanges through this adapter and the wire projector is byte-identical to today's client wire, including request ids, cursors, `codewideCatalogSummary`, pins and extension fields.
- With only Codex enabled, no client-wire extension is attached and `thread/list` cursors pass through byte-for-byte. With several providers the only golden-replay difference is the additive `codewideAgent` extension on projected threads.
- This adapter never emits client-wire JSON; projection belongs to `agent/client_wire`.

## Boundary

- A Codex thread that continues another app thread (a non-first binding segment) is hidden by the companion, not by this adapter.
- Must not depend on `companion-core` or `agent-provider-claude`; companion infrastructure is reached only through `companion-host` contracts and the `agent-core` provider contract.
