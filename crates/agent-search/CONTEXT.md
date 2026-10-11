# Agent search

## Purpose and owner

The stored-message full-text search index shared by provider adapters: one `SQLite` FTS5 schema (`SCHEMA`), the bounded `companion/search` query (`query.rs`), the neighbor read around a hit (`context.rs`) and a whole-thread document writer for providers that read their history as neutral turns (`documents.rs`). Each adapter owns its database file, the indexing of its own sources and the window around a hit. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md).

## Users

- `agent-provider-codex` — `message_search/` indexes rollouts incrementally into the schema and reads through `query` and `context`.
- `agent-provider-claude` — `search.rs` replaces whole threads with `documents::replace_thread` from indexed neutral turns.

## Boundary

- Depends on no CodeWide crate; names no provider and no provider storage format.
- The page size (30), the offset bound (100 000), the result order (newest first, then thread id, then the later position) and the error texts are the `companion/search` contract; the companion's cross-provider merge relies on them.
