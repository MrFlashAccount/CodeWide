# Companion host contracts

## Purpose and owner

Narrow host infrastructure contracts that `companion-core` hands to provider adapter crates, so an adapter never depends on the companion itself. Each module is a trait or a value model; implementations stay with their owners in `companion-core`. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md).

## Module jobs

- `database.rs` — redb opening with the companion page-cache budget and cache metrics.
- `index.rs` — `StoreError` of the companion index, its `META` table and `DerivedIndexSchema`: tables an adapter derives from its own sources inside the index database, migrated by `IndexStore::open_with` in the index's opening transaction.
- `thread_index.rs` — `IndexedThreadMetadata`, `ThreadPinSnapshot`, `HostThreadIndex` (metadata writes, subagent tree, pins; implemented by `IndexStore`) and `ThreadMetadataSource` (an adapter's lookup of threads the index does not know yet).
- `content.rs` — `CanonicalContentSource`: content an adapter proves from its canonical sources, asked by the private content service before its own bytes.
- `files.rs`, `vcs.rs` — `PreviewFiles` (implemented by `FileService`) and `WorkspaceVcs` with the VCS value model (implemented by `VcsService`), used by thread resources.
- `activity_metrics.rs` — companion-owned activity counters on client-wire items, shared by sync ingest and stored-history projection.

## Boundary

- Must not depend on `companion-core`, `agent-transport` or an adapter crate, and must not name a provider.
- A new contract is added only when an adapter needs host infrastructure; it stays as narrow as that use.
