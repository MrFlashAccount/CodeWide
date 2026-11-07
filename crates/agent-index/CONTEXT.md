# Agent index

## Purpose and owner

The shared offset index of agent transcripts: the part of indexing an
append-mostly JSONL transcript that no record format owns. Provider adapters
plug their format in through `IndexSource` (stateless boundaries: Codex
rollouts) or `SegmentSource` (boundaries that depend on earlier records:
Claude session files) and read their turns back as byte ranges of their own
files. Code owner: backend. This document: architect.
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
- `segment.rs` — segmented scans for formats whose turn boundaries depend
  on the records before them: `SegmentSource` (a state carried across
  records; `SegmentBoundary::Started` at the record or at an earlier offset
  no boundary followed, `Renamed`, `Ended`, `RolledBackTo` a keyed record),
  the forward scan from a file's checkpoint (`index_segments`, appended
  records only; a file whose indexed bytes changed is indexed again from
  byte 0), the bounded rescan from the turn before a record
  (`reindex_segments_from`), and the reads of a turn's start state and of
  the state at the checkpoint. `SegmentReport` names the turns that are new
  or changed and the turns that are gone.
- `segment_store.rs` — `SegmentTables` and `SegmentStore`: the shared
  offset index tables plus the scan cursor per file, the cursor each turn
  starts from, the span of each keyed record, and facts merged per group of
  files (the source's `merge_fact`).

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
- Segmented files: always indexed from byte 0 (no tail bootstrap or prefix
  backfill); a scan reads only the durable records after the checkpoint,
  and a partial last record waits for its newline. The cursor persisted
  with each checkpoint and each turn start makes observing the records from
  there reproduce the same turns, so `reindex_segments_from` reads only the
  turns from the restart on. A `RolledBackTo` tombstones every turn after
  the one holding the keyed record and ends that turn after the record;
  tombstones at or after a rescan's restart are derived again. Keys and
  facts are a pure function of the records they come from: a rescan
  rewrites equal rows (`merge_fact` must keep a fact observed twice), so
  neither is deleted by a rescan; a file reset drops its keys, and facts
  stay with their group until `remove_group`.
- The rows of a segmented index hold offsets, ids, scan states and facts,
  never the records themselves; a reader reads turn ranges through a file
  handle whose checkpoint `current_checkpoint` validated.

## Dependency rules

- Depends on `companion-host` (index substrate, thread metadata index), redb,
  serde, memchr, blake3, notify and tokio. Depends on no provider crate, not on
  `agent-core`, and never on `companion-core`.
- Names no provider and no record format: every needle, tag, boundary,
  summary and locator encoding comes from the `IndexSource`.

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`
and `cargo fmt --all -- --check`. Behavior over a real format is covered by
the adapters' tests (`crates/agent-provider-codex/src/rollout.rs`; Claude's
segmented files in `crates/agent-provider-claude/src/index/tests.rs`); the
segmented scan's own contract is tested over a toy format
(`src/segment/tests.rs`).
