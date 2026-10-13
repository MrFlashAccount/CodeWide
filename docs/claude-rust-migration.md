# Claude provider on Rust: migration plan and ledger

Decision (2026-10-13): the Claude provider leaves the TypeScript host and the
Claude Agent SDK. The companion reads Claude's session files and drives the
`claude` CLI itself, in Rust. Indexing of Claude sessions reaches parity with
Codex rollouts (byte offsets, incremental scans, paged reads of gigabyte
threads) through one shared indexing core both providers plug into.

This document is the working plan of the `rust-claude` integration branch and
its progress ledger. Stage PRs target that branch; the branch merges into
`main` when the host is gone.

## Evidence the plan rests on

- Claude session records keep a stable core (`uuid`, `parentUuid`, `type`,
  `message`, `timestamp`, `cwd`, `sessionId`, `isSidechain`, `version`).
  Monthly SDK type diffs (March to October 2026) only add optional fields.
  Unknown record types (`queue-operation`, `ai-title`, `last-prompt`,
  `cost-state`, `file-history-snapshot`, `pr-link`, ...) are skipped.
- What drifts is the reconstruction: compaction relinks
  (`preservedSegment` → `preservedMessages`), leaf selection, queued-command
  reattachment, delivery dedupe, malformed-row tolerance. The index needs a
  display-grade reconstruction, not Claude's resume semantics; fixtures guard
  it.
- Session files are append-mostly, not append-only: truncation in place
  (2.1.69), rewrites during load (2.1.288) and `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC`
  rewrite whole files. The Codex file witness (device, inode, tail hash,
  modification time) already detects every one of these.
- The SDK reads whole files into memory; it is not a gigabyte reader. Any
  paged reader is our own.
- The SDK is a thin wrapper: it spawns
  `claude -p --output-format stream-json --input-format stream-json
  --permission-prompt-tool=stdio --verbose` and speaks `control_request` /
  `control_response` over stdio. The host uses five of its forty request
  kinds: `initialize`, `can_use_tool`, `interrupt`, `set_permission_mode`,
  `mcp_message`. The SDK's `sdk.d.ts` is the protocol reference.
- The Codex read side (`history_service.rs`) speaks the App Server dialect
  (`thread/turns/list`, `codewideThreadPatch`, summary turns with
  `final_answer`). Claude speaks the neutral `codewide-agent` model. The shared
  core is therefore the file mechanics, not the projection.

## Target shape

```
crates/agent-index            shared indexing core (new)
  file.rs      durable end, file identity, tail hash, witness, line reads
  store.rs     redb tables keyed by file id + offset: files, records, turns,
               turns_by_id, removed_turns, turn_summaries, content (+ by file);
               table names are a per-provider TableSet (Codex keeps rollout_*)
  scan.rs      forward index loop, tail bootstrap, prefix backfill, anchor
               recovery, reverse boundary visitors; generic over IndexSource
  monitor.rs   debounced file watcher over roots → (key, path, archived)

crates/agent-provider-codex   IndexSource for rollouts; unchanged tables,
                              encodings and client cursors; read side unchanged

crates/agent-provider-claude  Rust only
  transcript/  record decode, record classification, turn boundaries,
               rewind detection, frames (stored rows and live stream-json),
               item mapping (TurnBuilder port), summary projection
  index/       IndexSource for session files and sub-agent sidecars; thread
               = CodeWide thread id (host state) or session id; child threads
               <thread>:agent:<id>
  read/        thread.list / thread.read / thread.turns from turn ranges
  cli/         stream-json driver: spawn, control protocol, live turn →
               neutral events, permissions, interrupt
  state/       reader of the host's ThreadState v2 files (thread identity,
               session chains, settings, turn index) for existing threads
```

`IndexSource` (shape; Stage 1 fixes it):

```rust
pub trait IndexSource {
    type Summary: SummaryProjection;
    fn classify(&self, line: &[u8]) -> u8;
    fn boundary(&self, line: &[u8], offset: u64) -> Result<Option<Boundary>, SourceError>;
    fn boundary_needles(&self) -> &[&[u8]];
    fn standalone_turn(&self, line: &[u8]) -> Option<String>;   // Codex realtime items
    fn thread_metadata(&self, path: &Path, modified_at: i64, line: &[u8]) -> Option<IndexedThreadMetadata>;
    fn content(&self, path: &Path, file_id: [u8; 32], record: RecordRef, line: &[u8]) -> Vec<ContentEntry>;
    fn summary(&self, turn_id: String) -> Self::Summary;
}
pub enum Boundary { Started(String), Terminal { turn_id: String, completed: bool }, Rollback(Rollback) }
pub enum Rollback { Turns(u64), AfterRecord(String) }   // Claude rewind: turns after the record's turn
```

Claude turns on this core: a turn is a contiguous byte range in file order,
started by a person's prompt or a wake and ended by the next start. A rewind
(a prompt whose `parentUuid` is not the current leaf) is a rollback that
tombstones the turns after the turn holding that uuid, exactly as Codex
`thread_rolled_back` does. Compaction boundaries are items, not relinks.
Sub-agent sidecars are files of their own with their own turns.

## Stages

| Stage | Deliverable | Gate |
| --- | --- | --- |
| 1 | `crates/agent-index` carved out of the Codex crate; Codex plugs in with identical tables, encodings, cursors and witnesses (no reindex) | every Codex test unchanged; `pnpm test:companion`, clippy, fmt |
| 2 | Claude transcript module in Rust: records, frames, turn builder, segments, summaries; raw-JSONL fixtures from sanitized local sessions; the host's history contract tests ported | fixture parity with the host on the same sessions |
| 3 | Claude index on the core; `thread.list`/`thread.read`/`thread.turns` from turn ranges; sidecars as child threads; host state files read for thread identity; `nativeSession.*` RPC removed from the host | existing Claude index tests ported; paging of a multi-GB synthetic session stays bounded |
| 4 | Live turns in Rust over stream-json: spawn, `initialize`, `can_use_tool`, `interrupt`, `set_permission_mode`; client tools as a stdio MCP server the companion exposes; `openElsewhere` from `claude agents --json`; host, SDK download, bun build and install lock removed | the host's recorded stream fixtures replay to the committed neutral golden files |
| 5 | One full-text index written by the core loop for both providers; `search_routing::merged`, the Codex search worker and `claude-message-search.sqlite` removed | search contract tests of `agent-search` and both providers |
| 6 | Live events for threads held by another process (`companion/thread/progress` / `invalidated`) from the file tail for both providers | externally driven session updates an open conversation |

Stage 4 is a separate decision point only in the sense that Stage 3 ships
value on its own; the destination is fixed.

## Compatibility rules

- Codex tables, `FileState`/`TurnRef` encodings, `codewide-history-v1` cursors
  and `codewide-history-source-v1` witnesses do not change in Stage 1.
- Claude thread ids of CodeWide-created threads come from the host's
  `<state dir>/threads/<id>/state.json`; the Rust provider keeps reading those
  files so no thread changes identity.
- Turn ids: a Claude turn the host drove keeps its recorded id (turn index);
  any other turn's id is the uuid of its first message, as today.
- Item ids stay `{message.id}:{block}`, `tool_use.id`, `{turnId}:user:{n}`,
  `{turnId}:compaction:{n}` so clients' caches survive.

## Ledger

- 2026-10-13: plan written; branch `rust-claude` created from `main`
  (`95345516`).
- 2026-10-13: Stage 1 done (`4acd24c7`): `crates/agent-index` carved out, Codex
  plugged in without a reindex; workspace tests, clippy and fmt green. Draft
  PR #50 tracks the branch.
- 2026-10-13: Stage 2 done: `crates/agent-provider-claude/src/transcript/`
  (records, frames, tools, diffs, sub-agents, outcomes, turn builder, entries,
  segments, turn index, reconstruction). The host's history contract tests
  pass unchanged on the host's session fixtures (`fixtures/sessions`); the
  ignored `raw_local_sessions_rebuild_without_panics` smoke test rebuilt 39
  local raw session files (35 418 rows, 539 turns) with no ordering violation.
  Rewind (dead `parentUuid` branches) is left to the index (Stage 3
  tombstones); reconstruction reads file order.
- 2026-10-14: `main` merged into the branch (#49, #51–#53). The frozen-prefix
  readers #49 added to `rollout.rs` now live in `agent-index` with rollout
  wrappers.
- 2026-10-14: Stage 3a done: the index reads Claude's files itself
  (`src/native/`, `transcript/chain.rs`) instead of the host's
  `nativeSession.*`. Parity with the host's reads on the 39 local sessions:
  33 identical; 4 compacted sessions now keep their history before the
  compaction (the host's read stops there); 2 sessions show a synthetic API
  error message (`rate_limit`, `authentication_failed`) the SDK's read drops.
  Claude index logic version 6. Remaining in stage 3: turns as byte ranges on
  the shared core (paged reads of huge sessions), the host's native-session
  operations removed.
