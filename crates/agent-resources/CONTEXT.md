# Agent resources

## Purpose and owner

Thread resources shared by provider adapters: the resource model of a thread (file changes with bounded patches, attachments), its per-turn projection, and the `companion/threadResources|threadChanges|threadAttachments|threadChange/read` responses with the workspace VCS overlay and the live overlay of the mutable turn. Each provider supplies its immutable projection through `ProjectionSource`; every provider's client sees the same response shapes. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md).

## Module jobs

- `data.rs` — `ResourceData` and its parts; items applied from the client wire (`apply_materialized_item`), from neutral items (`apply_agent_item`, the same result as the item's client-wire projection) or from a provider's records; path, diff and revision helpers.
- `projection.rs` — `ResourceProjection`: finished turns and the active turn, `from_turns` over neutral turns, the last-turn scope.
- `service.rs` — `ThreadResources<S: ProjectionSource>`: request handling, VCS overlay, live overlay from observed client-wire events and its eviction once the source shows the turn completed, prewarm; `source()` exposes the provider's projection source to its adapter.

## Users

- `agent-provider-codex` — `resources.rs`: projections from rollout records in its redb store (`PersistedProjection` flattens a `ResourceProjection`; stored rows are unchanged), plus the Codex-only `companion/threadChangeOutput/read`.
- `agent-provider-claude` — `resources.rs`: projections from the indexed neutral turns.

## Boundary

- Depends on `agent-core` and `companion-host` only; names no provider and reads no provider storage.
