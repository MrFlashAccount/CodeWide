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
| 4 | Live turns in Rust over stream-json: spawn, `initialize`, `can_use_tool`, `interrupt`, `set_permission_mode`; client tools as an in-process MCP server (`type: "sdk"`) answered over the control protocol (`mcp_message`); `openElsewhere` from `claude agents --json`; host, SDK download, bun build and install lock removed | the host's recorded stream fixtures replay to the committed neutral golden files |
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
  Claude index logic version 6.
- 2026-10-14: Stage 3b (Claude turns as byte ranges on the shared core)
  deferred. A full read of the largest local session (18 MB, 75 turns, 7
  sub-agents) takes 164 ms in a release build, and Claude Code itself keeps a
  session in memory and skips everything before the last compaction above
  5 MiB on load, so multi-gigabyte Claude sessions do not occur in practice;
  the gigabyte case is Codex's, which the shared core already serves. Revisit
  when a Claude session read exceeds ~1 s (`time_the_largest_local_session_read`).
  The host's `nativeSession.*` operations go with the host in stage 4.
- 2026-10-14: Stage 4a done: `src/cli/` drives `claude` without the SDK.
  `command.rs` builds the SDK's streamed-query command line per permission
  profile; `protocol.rs` classifies and writes the stream-json control
  envelopes; `process.rs` runs one process (requests `codewide-<n>` with
  answers, Claude's requests and messages as ordered events, stderr tail,
  close with a kill after a grace period); `mcp.rs` serves the client tools
  as the in-process `codewide` MCP server. Tested against a fake `claude`
  shell script; no live turn has run yet. Next: the session lifecycle
  (`host/src/session.ts`, `service.ts`) on top of it.
- 2026-10-14: Stage 4 done: live turns run in Rust. `src/cli/` drives
  `claude`; `src/session/` runs one actor per live thread (state, query,
  active turn); `src/threads/` is the thread service (create, fork, read,
  list, turns, update, compact, turn operations, startup); `src/state/` owns
  `state.json` (ThreadState v2) and `active-turn.json` in the host's format,
  so existing threads keep their ids; `src/native/write.rs` writes Claude's
  store (rename, removal, fork); `src/runtime/` probes account, models and
  usage and reads `claude agents --json` for `openElsewhere`. All 35 recorded
  transcripts (`fixtures/replay/*.ndjson`) replay to the host's golden
  events (`fixtures/golden/*.neutral.jsonl`; time fields blanked;
  `thread.updated` checked separately for `simple` and `multi_turn`). The host
  package, the Bun build, binary embedding, the SDK download and the CI Bun
  setup are removed; `legacy_install.rs` deletes the former host's files on
  start. A smoke run against a real `claude` 2.1.296 passes (initialize,
  catalog, thread start, read, interrupt, sync; no model call). No paid live
  turn has run yet.
- 2026-10-14: Stage 4 deviations from the host: the proxy environment comes
  from the user's `settings.json` `env` only; the managed policy tier is left
  to `claude`, which loads it at every start (an inference, not verified
  against Claude Code source). A fork looks a session up in its working
  directory's project, else in every project, instead of probing git
  worktrees. Client tools are global (the companion's `ClientToolHost`), not
  per thread; the `clientTools` params are not used.
- 2026-10-14: Live wire check against a real `claude` 2.1.296 on a Claude
  login: the same 12 scenarios (turns, approval accept and decline, a client
  tool, interrupt mid-tool, steer, permission switch, user input,
  compaction, restart with resume, background sub-agent) ran through the
  former host over the Agent SDK 0.3.295 and through the Rust provider, with
  a recorder in front of `claude`. All pass on both; command lines,
  `initialize`, the lines written to stdin and the control traffic match.
  Fixed after it: user messages no longer carry `session_id: ""`, and a
  companion shutdown closes every session and waits for `claude` to exit on
  its own (it was killed with the runtime). Remaining deviations: the Rust
  provider does not set `CLAUDE_CODE_SDK_READS_SESSION_STATE` or
  `CLAUDE_AGENT_SDK_VERSION` (without the first, `claude` emits no
  `session_state_changed`, which only the SDK's own run bookkeeping read),
  and the client-tool MCP server answers its handshake live instead of the
  SDK's `sdkMcpServerManifests` in `initialize`. The check is kept as
  `pnpm claude:live` (`scripts/claude-live/`), run on request only.
- 2026-11-05: Stage 3b done: Claude turns are byte ranges of Claude's own
  session files and sub-agent transcripts on the shared index. The deferral
  criterion of 2026-10-14 (read time) ignored memory and how often the read
  repeated: the running companion re-read whole sessions (12–57 MB) on every
  file change, every 30 s for sessions with a running sub-agent and after
  every finished turn, held every turn as a `serde_json::Value` tree and
  rewrote copies of all turns (`claude_session_turns`,
  `claude_subagent_turns`; `state.redb` grew to 4 GB), with spikes to
  1.1–2.95 GB. What changed:
  - `crates/agent-index` gained segmented scans (`segment.rs`,
    `segment_store.rs`) for formats whose boundaries depend on earlier
    records: a source state persisted with every checkpoint and every turn
    start, turns that start at an earlier record (wakes before the first
    message), renamed turns, rollback to a keyed record (a rewind tombstones
    the turns after the record's turn and ends that turn after it), record
    keys, facts merged per group of files, and a bounded rescan from the
    turn before a record. Codex's `IndexSource` path, tables, encodings,
    cursors, witnesses and `ROLLOUT_LOGIC_VERSION` are unchanged (one
    shared write step was factored out; a turn rewritten under another id
    loses its former id, which a rollout never does).
  - `crates/agent-provider-claude/src/index/`: `ClaudeSource` decides
    boundaries with `transcript::segments::decide`, the one rule turn reads
    share; a turn read replays its range from its start state. Only the
    records after a file's checkpoint are scanned, only turns whose range
    moved are read back (their digest: preview, person's turn, sub-agent
    launches, resources), and search documents are written per turn
    (`agent_search::documents::replace_turns`). Pages, search windows and
    child threads read their own turns' ranges; resources come from
    digests. Sub-agent and background command states are settled at read
    time from facts (any transcript of the session) and the activity the
    last pass saw. Rows are scanned through borrowed raw fields
    (`index/line.rs`), never whole `Value` trees.
  - Hint contract: prompt uuids reach `state.json` before `claude` gets the
    prompt; a provider turn's first frame is recorded after Claude reports
    it, so each pass compares the turn index hints with those the file was
    scanned with and rescans from the turn before the earliest record a
    changed hint names.
  - Claude index logic version 17; the turn copy tables are dropped and the
    index rebuilds from the files once.
  - Parity (`native/parity_tests.rs`, ignored; old and new reads of a
    snapshot of the 176 local sessions, activity stopped): 155 identical.
    The 21 others differ in four classes, each a deliberate change:
    (1) compaction: rows a compaction preserved stay where Claude wrote
    them, before the compaction item, as the live turn showed them (the
    former read moved them after the summary: 7 final answers in 6 sessions
    left their own turn for the compaction turn, 11 turns reordered, and in
    4 sessions the relink produced turns out of time order or two turns
    with one id — the former reads held 2 duplicate turn ids, the new
    none); (2) the rows of one response (parallel tool calls) stay in write
    order instead of timestamp order beside the parent chain; (3) one forked
    session (`forkedFrom` rows whose copy restarts with a parentless row)
    keeps its 110 earlier turns, as Stage 3a keeps the history before a
    compaction (597 → 707 turns); (4) 19 background commands of sub-agents
    in one session are `completed`/`failed` instead of `unknown`, settled by
    the reports Claude queued into the sub-agent. Rewinds: none in the local
    sessions; covered by contract tests.
  - Memory (`examples/index_memory.rs`, peak resident memory a step adds, own
    process each, release build, a copy of the largest local session,
    60 MB): appending its last 1.8 MB costs +9.8 MB and 74 ms (8 turns read
    back); an unchanged pass +6.2 MB, 36 ms; the newest page of 20 turns
    +13 MB, 48 ms; the first full index of 58.6 MB +26 MB, 1.7 s (once per
    logic version); the former whole read of the same file +222 MB, 457 ms.
    The index of all 176 local sessions (1.4 GB of files) is built from
    scratch in 22 s and takes 93 MB (digests 20 MB, record keys 9 MB, no
    turn copies).
  - Still reading whole sessions: the thread service's own history read
    (`threads/history.rs`, used while a turn runs or the index is behind,
    for fork cuts and a replacement session's history prefix).
- 2026-11-05: Stage 3b follow-up: no Claude read takes a session whole.
  - The thread service reads through the index (`SessionIndex`, shared with
    the indexer, one pass per session at a time): a read while a turn runs
    or the index lags catches the index up (appended records only) and
    reads its own turns' ranges; the fork cut finds the boundary turn by id
    and reads only that turn's last message; a replacement session's
    history prefix reads newest pages until 16 KiB of lines; a discovered
    session's recorded model is kept with its file's checkpoint. Without
    host storage the index is kept in memory. Removed: `files::rows`, the
    thread service's whole-branch reads (`session_messages`,
    `session_values`, `stored_turns`) and the message-based `fork_cut`.
  - Remaining whole-file work, each deliberate: a fork writes a full copy
    of the source session (`native/write.rs`, user-initiated; the SDK's
    fork rebuilds the branch to remap uuids, so the source rows are read
    once); the first index of a file after a logic version change (once,
    streamed, about 26 MB peak for 58 MB); a session whose file was
    rewritten or truncated is indexed again from byte 0. Listings read the
    first and last 64 KiB of each session file. `background_task_facts`
    pages a thread newest first until the launching call (a task the
    thread never launched walks every page).
  - `state.redb`: the companion compacts it while it opens it alone, after
    the derived migrations (Claude's schema now migrates there too) and
    before sharing it, when at least half of the file and 256 MiB are free.
    On a consistent copy of the live 4.29 GB file: migration 82–122 ms,
    compaction 2.6–2.9 s, 4 294 971 392 → 898 224 128 bytes, the rows of
    all 70 tables unchanged, `check_integrity` clean, 25 MB peak resident
    memory; a compaction killed after about 1 s reopened in 0.5 s and
    finished on the next open with the same result.
  - Rewinds: a real one written by `claude` 2.1.310 (`--resume <session>
    --resume-session-at <first answer>`: the new prompt is appended to the
    same file with `parentUuid` = that answer) is a sanitized fixture
    (`fixtures/raw/rewind-resume-session-at.jsonl`); the index and Claude's
    own branch rule keep the same turns.
  - A prompt Claude queued while no turn with messages was open is decided
    by the next reply (delivered: it takes its place) or the person's next
    message (dropped), as Claude's branch decides it; a still-undecided one
    at the file's end shows once the next row arrives.
  - Facts from rows on a branch the person rewound past still count: a task
    report states that a process ended, and a rewind returns the
    conversation, not the background agent or command.
  - Search: the position each session of a thread was indexed at is kept;
    a session that joins its chain before earlier-indexed ones rewrites
    that thread's documents once.
  - Parity and memory re-run: unchanged (155 identical of 176, the same 21
    in the same four classes, byte-identical to the previous run); a 1.8 MB
    append to the 60 MB session +9.7 MB peak, 102 ms; the former whole read
    +222 MB.
