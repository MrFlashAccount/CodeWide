# Codex provider adapter

## Purpose and owner

The in-process `AgentProvider` implementation for Codex. It wraps the existing `UpstreamHandle` connection to the Codex App Server and the Codex-owned storage modules, maps neutral operations to App Server methods and App Server notifications to neutral events. Code owner: backend. This document: architect. Layer contract: [`../../CONTEXT.md`](../../CONTEXT.md).

## Module jobs

- `mod.rs` — `CodexProvider`, the `AgentProvider` implementation over `UpstreamHandle`, the account pool and the Codex storage modules; exposes the `codex.native` `NativeSurface`.
- `storage.rs` — `CodexStorage`, the only bridge from the sync hub to the Codex storage modules: it implements `NativeThreadStore`, `NativeMessageSearch` and `NativeThreadResources` over `history_service` (rollout catalog and history), message search and `resources`, keeping the error messages and codes the hub forwarded before.
- `rollout_changes.rs` — watches rollout files written by other App Server processes and turns them into thread invalidations for the sync hub's journal (echoes coalesced, the trailing write never dropped).
- `mapping.rs` — pure App Server values → neutral model and neutral params → App Server params (`thread.list` asks for all source kinds, state-DB only).
- `dispatch.rs` — thread-mutation dispatch with account admission and one safe resume-retry.
- `hub.rs` — Codex host integration of SyncHub: Codex-only registry constructors from an App Server connection and installation of the Codex-owned account pool. Hosts with several providers use `agent::providers::build_registry`.
- `golden_tests.rs` with `testdata/app_server_streams.jsonl` — golden replay of recorded App Server streams through this adapter and the wire projector.

Host construction: `CodexProvider::new(upstream).with_storage(CodexStorage::new(history).with_resources(resources))` (`apps/companion-linux/src/main.rs`, `managed_runtime.rs`); the Codex-only constructors in `hub.rs` attach `CodexStorage::new(history)` without resources.

## Owned modules

This adapter is the only importer, from inside `agent/`, of the Codex storage modules that stay at their current paths in phase 1: `history_service`, `history`, `rollout`, `rollout_monitor`, `catalog`, `catalog_visibility`, `resources`, `message_search`, `account_pool`, `usage` (compatibility surface `keep_temporarily`; removal condition: moved under this folder in a later slice).

AccountPool runs only inside this adapter's `turn.start` and `thread.update(settings)`. That is how every other provider bypasses it, with no provider-name check anywhere. SyncHub reaches the Codex storage modules only through this adapter: storage through `CodexStorage` behind the `NativeSurface` storage traits, the account pool inside `turn.start` and `thread.update(settings)`. The one remaining direct use is `usage` (`LiveUsageProjector`, `prepare_replay_payload`) in SyncHub ingest.

## Declared behavior

- Capabilities: the Codex column of the table in [`docs/agent-providers.md`](../../../../../../docs/agent-providers.md#capabilities), including `threads.externalDiscovery` (CLI and VS Code threads), `turns.startWhileActive: nativeJoin` and `codex.native`.
- As the only `threads.externalDiscovery` provider on a Codex + Claude host, it receives unbound thread ids provisionally; the companion writes the `discovered` binding only after this adapter accepts the call. `thread.owns` (a `thread/read` probe) is used only when several providers declare discovery. It is also the backfill source (see [thread bindings](../../../../../../docs/agent-providers.md#thread-bindings)).
- `turns.startWhileActive: nativeJoin` — the App Server itself joins an active turn; the adapter reports `started` with that turn id, so Codex client-wire behavior is unchanged.
- Codex mints its own thread ids; the binding takes the returned id.

## `codex.native` surface

Codex notifications and request params with no neutral or capability mapping pass through unchanged as `capability.event` or `providerOptions["codex.native"]`, so phase 1 cannot regress unmapped Codex features. `keep_temporarily`, owner backend. Removal condition: every Codex method the client uses has a neutral or capability mapping and the client speaks the neutral protocol. Negative check: no other provider emits it.

## Invariants

- A golden replay of recorded App Server streams and RPC exchanges through this adapter and the wire projector is byte-identical to today's client wire, including request ids, cursors, `codewideCatalogSummary`, pins and extension fields.
- With only Codex enabled, no client-wire extension is attached and `thread/list` cursors pass through byte-for-byte. With several providers the only golden-replay difference is the additive `codewideAgent` extension on projected threads.
- This adapter never emits client-wire JSON; projection belongs to `agent/client_wire`.
