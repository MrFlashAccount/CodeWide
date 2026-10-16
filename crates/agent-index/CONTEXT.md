# Agent index

## Purpose and owner

The shared offset index of agent transcripts: the part of indexing an
append-mostly JSONL transcript that no record format owns. Provider adapters
plug their format in through `IndexSource` and read their turns back as byte
ranges of their own files. Code owner: backend. This document: architect.
Layer contract: [`docs/agent-providers.md`](../../docs/agent-providers.md);
migration plan: [`docs/claude-rust-migration.md`](../../docs/claude-rust-migration.md).

## Module jobs

- `file.rs` — the durable end of a file (its last complete line), file
  identity, the tail hash and modification time of a checkpoint, bounded line
  reads around an offset, and `FileWitness`: the serialized proof a client
  cursor carries that a file's bytes are unchanged (its field set is a
  compatibility contract with issued cursors).
- `store.rs` — `IndexStore` over the companion's host index database: one
  provider's `IndexTables` (files, records, turns, turns by id, removed turns,
  turn summaries, content by digest and by file) with the provider's logic
  version; `FileState`, `TurnRef`, `RecordRef`, `ContentEntry`, `IndexBatch`
  and their byte encodings; the per-file index lane. The schema is a
  `DerivedIndexSchema`: the tables are disposable and rebuilt from the files.
- `scan.rs` — `IndexSource` and `SummaryProjection`; the forward scan
  (`index_file`) with its crash-safe batches, cold tail bootstrap of a large
  file, prefix backfill, anchor recovery and full indexing; reads qualified
  against the open file handle (`current_indexed_*`); the reverse boundary
  visitors and tail scans that find turns without an index; witness checks.
- `monitor.rs` — the debounced recursive watcher of transcript roots,
  reporting one `FileChange` per provider-derived key.

## Contract

- A turn is a contiguous byte range of one file, opened by a `Boundary::Started`
  record and closed by its `Terminal` record (or by the next start, or the
  durable end). `Boundary::Rollback(n)` tombstones the newest `n` turns before
  it. A standalone record (`standalone_turn`) is a complete turn by itself
  outside any started turn.
- Every committed checkpoint describes one contiguous indexed suffix
  (`indexed_from..indexed_bytes`); a crash never exposes a hole as history.
- Rows keyed by file id and offset never change meaning without a logic
  version bump; a bump drops only the provider's tables.
- Thread metadata is published only from a file's first record (its header);
  a later record of the same shape (a copied header) never publishes.
- Malformed records are the source's to tolerate: a boundary record that
  does not parse fails the scan (`IndexError::InvalidBoundary`); a summary
  that cannot fold a record skips it.

## Dependency rules

- Depends on `companion-host` (index substrate, thread metadata index), redb,
  serde, memchr, blake3, notify and tokio. Depends on no provider crate, not on
  `agent-core`, and never on `companion-core`.
- Names no provider and no record format: every needle, tag, boundary,
  summary and locator encoding comes from the `IndexSource`.

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`
and `cargo fmt --all -- --check`. Behavior over a real format is covered by
the adapters' tests (`crates/agent-provider-codex/src/rollout.rs`).
