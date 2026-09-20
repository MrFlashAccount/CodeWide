# Historical turn file review

Status: proposed contract; source-provider implementation is unresolved.

## User-visible contract

Changes beneath a message compares the file immediately before that turn's
recorded edits with the file after those edits. Unified and Split include
unchanged content; File opens the complete after version. Deleted files retain
the complete before version for review. Later turns, external edits, reconnects,
and restarts must not change a completed turn's result.

The baseline is the state before the selected turn, including changes already
present from earlier turns. It is not HEAD or today's working tree. Unrelated
edits between turns must not silently become attributed to the selected turn.

## Verified boundary

- `TurnChangesRoute` uses `recordedTurnChangeDiff`, which supplies `source: ""`.
- Recorded change resources use `availability: "unavailable"`, disabling live
  file preview. The review loader treats the empty source as authoritative.
- The native editor already supports complete before/after file rendering, but
  falls back to recorded hunks when it cannot reconstruct the before version.
- Companion's `threadChange/read` selects Session/LastTurn/VCS scope. It does not
  accept an exact historical turn identity or provide historical file versions.
- The inspected local Codex source has `TurnDiffTracker.baseline_by_path` and
  `current_by_path`; `get_unified_diff` publishes only a patch with three lines
  of context. Its public `TurnDiffEvent` contains only `unified_diff`.
- The inspected recent rollout contains file-change patches, not full update
  preimages/postimages. No historical snapshot source was established.

The OpenAI App Server documentation likewise specifies
`turn/diff/updated {threadId, turnId, diff}` and
`fileChange {id, changes: [{path, kind, diff}], status}`:
<https://developers.openai.com/codex/app-server>.

These findings establish the missing data boundary, not a guarantee about every
Codex version. A source integration must verify the deployed version's capability.

## Proposed ownership

The mutation owner captures committed before/after contents while applying an
edit. It already knows which bytes changed and whether the edit succeeded.
Version capture must not race a later filesystem read or depend on Android
remaining connected. Multiple edits to a path in one turn retain the first
before version and the last committed after version; failed/declined edits do
not enter the result. Rename and destination-overwrite cases preserve both path
identities and actual overwritten contents.

Durable version storage is outside model conversation history, so context
compaction does not erase it. The source publishes references only after the
contents are durable. Thread rollback removes the reverted turns from the
visible timeline without substituting the current workspace. Deletion and
retention policy belongs to the source storage owner.

Companion exposes an exact-turn read with validated `threadId`, `turnId`, and
path; it authorizes against that thread's recorded changes and resolves the
source's immutable version references. Android does not execute VCS commands.
The existing current-changes RPC remains unchanged for all its consumers.

The result is a discriminated contract:

- `complete`: exact turn identity, revision, change kind, and before/after file
  references (each side is either absent or a complete text file).
- `patchOnly`: exact turn identity and recorded patches, with an explicit reason
  such as historical versions unavailable or unsupported source capability.

An absent file, an empty file, an unavailable version, and a truncated preview
are distinct states. Large text uses bounded version-qualified reads; continuation
cannot silently switch to another revision. Binary files retain their binary
presentation. No complete result is synthesized from current file contents.

Android requests the exact turn and supplies both file versions to the editor
instead of reverse-applying patches to an unqualified source. File mode displays
the requested complete version. Patch-only history remains inspectable and
explicitly states why complete-file view is unavailable.

## Acceptance evidence required

1. Start with a file containing unchanged content outside patch context. Change
   it in turn A, then differently in turn B. Opening A after B returns A's full
   before/after versions and highlights only A's changes.
2. Modify the workspace outside the chat, restart both services, and reopen A.
   Its version contents and diff remain unchanged.
3. Replay multiple edits, additions, deletions, empty files, renames, rejected
   edits, rollback, and compaction. Verify the corresponding version semantics.
4. Assert exact-turn identities and complete content at the Companion RPC
   boundary, including a wrong thread/path and version-qualified continuation.
5. Render the real Android editor browser bundle. Verify unchanged distant lines,
   change highlighting, File mode, and line-comment coordinates in Unified/Split.
6. Verify old patch-only history and an older source provider remain usable and
   never present current contents as historical contents.
7. Run source-provider tests, Companion boundary tests, browser tests, and the
   full `pnpm validate:android:v1` gate after implementation.

## Implementation decision still needed

The current CodeWide checkout cannot make Codex's in-memory versions durable by
adding a read RPC alone. The preferred next step is an explicitly scoped Codex
runtime integration exporting durable committed file versions. That changes a
different checkout and source contract; it has not been implemented or deployed.

A CodeWide-only capture mechanism is an alternative project, not an equivalent
RPC adapter: it must prove capture ordering for external CLI turns, concurrent
writers, arbitrary tool mutations, and disconnected periods. Unverified reads at
turn completion cannot satisfy the historical-content contract.

For existing turns whose unchanged bytes were never retained, complete historical
files cannot in general be recovered from patches alone. No migration can promise
otherwise; any recovery source needs independent version evidence.
