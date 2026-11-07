# Companion thread list stream

The Companion keeps the Android thread list current through one per-socket,
coalesced stream of complete list rows. A socket that declares the list visible
receives `threadListRows` frames; each frame carries every row that changed
since the previous flush of that socket, so the number of list frames does not
grow with the number of running agents. Pages of `thread/list` carry the same
row shape, and a forced page re-read after reconnect or foreground restores
anything a closed socket missed. There is no per-thread list event, no row
revision, no compatibility flag and no fallback. Companion and the Android APK
ship and roll back as one paired release.

This document owns the list-stream wire contract, the row cursor and page rule,
the flush classes, the device race rule, the server-field versus device-field
split, the visibility and refresh policy, the close and failure reasons, and the
paired release/rollback rule for the stream. Interest delivery of thread content
(which journal events reach which socket) is recorded in
[Companion sync interest](companion-sync-interest.md). Device-side module
ownership is recorded in
[`apps/android/src/data/CONTEXT.md`](../apps/android/src/data/CONTEXT.md) and
[`apps/android/src/features/threadList/CONTEXT.md`](../apps/android/src/features/threadList/CONTEXT.md).
Machine-readable limits live only in `crates/companion-core/contract/v1.json`.

## Vocabulary

- **list row**: the object `thread/list` returns after every Companion
  decoration, with `turns: []`, plus the `codewideList` metadata. Pushed rows and
  page rows have the same shape.
- **server fields**: the row fields owned by the Companion row hub; on the device
  they are replaced as a whole by an accepted row.
- **device fields**: `StoredThreadSummary` fields owned by the device: `unread`,
  `lastSeenCursor`, `firstUnreadAgentTurnId`, `pendingQuestion`,
  `closedQuestionTurnId`, skipped and submitted questions,
  `latestActivityCursor`, `deleteCommandId`, `activeSubagents`. A server row
  never overwrites them.
- **row cursor** (`codewideList.cursor`): a Companion journal cursor, a global
  strictly increasing `u64`. For a pushed row it is the cursor of the last
  journal change applied to the row; for a page row see the page rule below.
- **tombstone**: `{threadId, cursor}` announcing that a row left the list.
- **row hub**: the Companion owner of server fields, `thread_list::rows`.
- **dirty set**: per socket, the thread ids whose rows changed since the last
  flush of that socket.
- **flush**: sending every dirty row of one socket, split into frames.
- **visible**: the per-socket flag set by `hello.listStream` and `listStream`
  frames; rows are sent only while it is `true`.
- **generation**: the device transport generation of one connection; all
  cursor bookkeeping on the device is scoped to `(connectionId, generation)`.

## Wire contract

Client → Companion:

- `hello` carries the required field `"listStream": {"visible": boolean}`.
  Without it the socket is closed with 1008 `list_stream_required`.
- `{"type":"listStream","visible":boolean}` may be sent at any time after
  `hello`; repeating it is harmless. It is applied inline before the next
  incoming frame is read, by the same rule as `interest`. A non-boolean
  `visible` closes the socket with 1008 `invalid_list_stream`.

Companion → client, a frame outside the journal:

```json
{"type":"threadListRows","rows":[ThreadListRow],"removed":[{"threadId":"…","cursor":123}]}
```

- Both arrays are required; they are never both empty.
- At most 100 entries per frame, rows and tombstones together. A larger flush is
  split into several frames of the same flush, in order.
- One `threadId` appears at most once per frame.
- Frames are sent only while `visible` is `true`. `visible:false` removes the
  subscriber and clears its dirty set.
- The frame is not journaled: it takes no part in the `afterCursor` chain, is
  not stored in `native_frames` and is not acknowledged. It is the same class as
  `liveEvent` and `portInventory`. While the socket lives, frame order is
  guaranteed; after a disconnect the device re-reads its pages.

Row metadata `codewideList`:

- `cursor: u64`: the row cursor.
- `archived: bool`: replaces the device inference of archived state from the
  `thread/list` request parameter.
- `liveActivity: LiveActivity | null`: the existing
  `threadProjectionPatch.liveActivity` shape from `contract/v1.json`; `null`
  means no activity. It is no longer delivered as a catalog-topic exception.
- A future revision field is added inside `codewideList` or at frame level
  without breaking either side.

Pages: `thread/list` parameters are unchanged. Every response row carries
`codewideList`, including rows of the native full snapshot sent on
`snapshotRequired`.

## Row membership

The stream carries rows whose `source` is in `rowSourceKinds` (`cli`,
`vscode`), child rows with a non-null `parentThreadId`, and every row of a
non-primary provider (`codewideAgent.primary == false`, whose `source` is
`appServer`), matching the merged `thread/list` membership. The
`rowSourceKinds` literal stays `["cli", "vscode"]`; the non-primary rule is not
a source kind. A row hidden by the catalog filter (`codewideCatalogExcluded`,
the supervisor source) is sent as a tombstone.

## Companion row hub

`thread_list::rows` is the only owner of server fields on the Companion. It holds
at most 4096 rows in memory and applies two inputs:

- **Journal payloads.** Ingest calls `apply(payload, cursor)` after
  `append_replay_batch` has assigned the cursor. A change sets the row cursor to
  the cursor of the event and marks the thread dirty for every visible
  subscriber.
- **Pages.** `observe_page(rows, H)`, where `H` is the journal head taken
  **before** the provider read. For each page row exactly one case holds:
  - the hub knows the row with `cursor > H`: the response carries the hub's
    server fields with the hub cursor; the provider content is discarded and
    must not overwrite the hub row;
  - otherwise the response carries the provider row, after the live-state
    retention rules below, with cursor exactly `H`, and the hub replaces its row
    with it.

  Provider content never receives a cursor above `H`.

The live-state retention rules formerly applied on the device
(`retainLiveCatalogState`: `notLoaded` never overrides `active`, `recencyAt`
never decreases) belong to the hub and apply to both pushes and pages.

Row lifecycle in the hub:

- `Unknown → Seeded`: a page row, or `thread/started` carrying a `Thread`.
- `Unknown → Materializing`: a journal event for an unknown thread.
- `Materializing → Seeded`: one `thread/read` without turns plus decoration.
- `Materializing → Retrying`: the read failed; a telemetry counter grows, the
  failure is logged with the thread id, and no row is pushed. A failure never
  parks the thread: its next journal event reads it again, and up to five timed
  retries follow a doubling delay (2 s up to 60 s).
- `Materializing → Ignored`: the read confirmed the thread has no list row (no
  owning provider, missing, hidden by the catalog, or a continuation); logged
  with the thread id and that reason. Only a lifecycle event of the thread
  (`turn/started`, `turn/completed`, a status change), a page row or
  `thread/started` reads it again, so an ignored but active thread cannot stay
  frozen.
- `Seeded → Seeded`: a journal event changed a field; cursor = event cursor.
- `Seeded → Removed`: `thread/deleted` or exclusion from the catalog; the
  tombstone is sent to subscribers.
- `Seeded → Unknown`: eviction beyond 4096 rows.

Materialization goes through the `RowReader` port of `thread_list::materialize`:
at most one read per thread in flight and at most four reads at once. The port
implementation lives in `sync/list_rows.rs` together with row decoration, so a
pushed row is decorated by the same code as a page row.

Streaming preview text is accumulated by `thread_list::preview`, capped at 2000
characters, and becomes part of the row; there is no preview event.

## Flush classes

One coalescing interval, `coalesceIntervalMs = 1500`.

Immediate flush:

- `thread/status/changed`;
- `turn/started`, and `turn/completed` with any status (completed, failed,
  interrupted);
- a `turnActive` change in `threadInvalidated`;
- user-interaction requests (the five request methods);
- `thread/started`, `thread/deleted`, `thread/archived`, `thread/unarchived`,
  exclusion from the catalog;
- `companion/thread/pin/updated`, `thread/name/updated`;
- a change of a thread in this socket's interest: sent at the end of the ingest
  batch that produced it, at most one frame per 250 ms per socket
  (`interestFlushIntervalMs`). This bound does not limit the other immediate
  reasons. A streaming open chat therefore produces at most four frames and
  four SQLite transactions per second, not one per delta.

An immediate flush sends **all** dirty rows of the socket and resets the
coalescing clock.

Coalesced: preview, `updatedAt`, `recencyAt`, `liveActivity`. When at least
1500 ms passed since the last flush the rows go out at once (leading edge after
quiet); otherwise at `lastFlush + 1500 ms`.

The classification is a pure function (`thread_list::flush`), and the dirty
set, visibility and timers of one socket live in `thread_list::subscriber`,
which receives time from outside so its state machine is testable without a
runtime. `run_session` passes the socket's interest membership to the
subscriber at every flush.

## Device race rule

Within one `(connectionId, generation)`:

1. An incoming row (push or page) replaces the server fields when the thread has
   no cursor-map entry or `incoming.cursor >= entry.cursor`; then
   `entry.cursor = incoming.cursor`.
2. A tombstone removes the row under the same condition and records
   `threadId → cursor`. A page row with `cursor < tombstone.cursor` is dropped.
   The tombstone is forgotten after a page row with `cursor >= tombstone.cursor`;
   at most 1024 tombstones are kept.
3. A generation change clears the map and the tombstones. Frames and page
   responses of an older generation are dropped. Rows in SQLite stay as a cache
   and count as entries without a cursor.
4. A row from `thread/read` (pins) carries no `codewideList` and is applied only
   when no row exists.

A window-head replacement by a page never evicts a row a push updated during the
request.

## Device write ownership

- Server fields are written only by the stream ingress
  (`data/threadListStream.ts`, push) and by `applyCatalogPage` / `applySnapshot`
  (pages). The event projection (`thread-summary-projection.ts`) writes only
  device fields. A second writer of a server field fails review.
- A device field for a thread without a row (the event arrived before the push)
  is held in memory in `pendingOverlay`, at most 256 threads per connection, and
  applied when the server row arrives. Without a row nothing is created in
  SQLite, except the existing `thread/started` shell (`provisionalThread`).
- Server rows are written in one transaction per frame through the existing
  write queue, without `durable` (checkpoint after 250 ms). Device fields such
  as read state and manual marks stay durable.
- The wire row is validated at the boundary by `data/threadListRow.ts`, which
  returns a discriminated `{status:'ok'} | {status:'error'}` result; only
  validated values reach the store. `generation` and `threadId` are branded
  types inside the stream ingress.
- Unread state and async questions stay derived from journal events
  (`turn/completed` with `finalAgentResponse`, `agentMessage`); moving them into
  the server row is out of scope.
- `activeSubagents` of a root is derived from child stream rows and from
  `agentsStates`.

## Visibility and refresh

- `catalog-lifecycle.ts` alone decides visibility and the re-read policy.
- Order is always `listStreamVisible(true)` first, then the forced re-read of
  every loaded window page from the first and every pin. Both calls travel in
  call order through the one connection service, like `engineInterest` before
  `companion/thread/sync`.
- `AppState → background` sends `visible:false`. Destroying the React context
  makes the native side send `visible:false`.
- A new generation (reconnect) triggers a forced re-read after `live`.
- The forced re-read has no throttle; there is no periodic list tick. Catalog
  invalidation by events and event-driven metadata repair (`thread/read` per
  event) are removed: the stream carries membership and rows.
- Cold start shows rows from SQLite before the network; offline, the list is
  built from SQLite with no requests and no errors.
- Interest membership is still decided only by `data/thread-chat-model.ts`; the
  stream never changes it.

## Close reasons and failures

- Companion closes with 1008 `list_stream_required` when `hello` has no
  `listStream`, and with 1008 `invalid_list_stream` when `visible` is not a
  boolean.
- On the device, a `threadListRows` frame that violates the shape or a limit
  resets the transport with `invalid_list_rows`, fail-closed like
  `invalid_event`. A row that fails the adapter invalidates the whole frame.
- Logs on both sides carry sizes, classes and reasons only. Preview text and
  `liveActivity` never reach logs. Opaque thread ids are allowed by the general
  logging policy, but socket close logs carry none, as for `interest`.

## Contract section

`crates/companion-core/contract/v1.json`:

```json
"threadListStream": {
  "frame": "threadListRows",
  "controlFrame": "listStream",
  "helloField": "listStream",
  "rowField": "codewideList",
  "coalesceIntervalMs": 1500,
  "interestFlushIntervalMs": 250,
  "maxRowsPerFrame": 100,
  "maxPreviewChars": 2000,
  "maxTrackedRows": 4096,
  "rowSourceKinds": ["cli","vscode"]
}
```

`apps/companion-linux/tests/v1_contract.rs` checks the section against the Rust
constants. `apps/android/test/sync-interest-contract.test.ts` checks the device
constants and the `NativeListStream.kt` limits against these literals. Checking
`v1.json` against the same literals is part of the paired integration step.

## Ownership

Companion (`crates/companion-core`):

- `src/thread_list/`: `rows` (server fields, page rule, live-state retention),
  `preview` (streaming preview accumulator), `flush` (payload → flush class),
  `subscriber` (dirty set, visibility, coalescing, frame splitting),
  `materialize` (`RowReader` port and read bounds). The module must not import
  `thread_view`, provider crates or `sync::interest`.
- `src/sync/list_rows.rs`: row decoration shared by pages and materialization
  (catalog filter, preview, `codewideAgent`, pins, lineage) and the `RowReader`
  implementation.
- `src/sync/provider_rpc.rs`: takes `H` before the provider read, attaches
  `codewideList`, calls `observe_page`.
- `src/sync.rs`: `hello.listStream`, the inline `listStream` frame, the sender
  branch of the session loop, and `rows.apply` after `append_replay_batch`.

Android native (`apps/android/android/app/src/main/java/dev/codewide/app/remote/`):

- `NativeListStream.kt`: frame limit checks and per-connection in-memory
  visibility.
- `NativeProtocolEngine.kt`: `hello.listStream`, the `threadListRows` frame,
  `listStream` sending, generation in state.
- `CodexConnectionService.kt` routes visibility and exposes the transport
  generation; `CodeWideModule.kt` is only the bridge and resets visibility when
  the React context is destroyed.

Android JS (`apps/android/src/`):

- `native/native-engine.native.ts`: the `threadListRows` engine event,
  `listStreamVisible`, generation.
- `data/threadListStream.ts`: the single device ingress of row frames, the
  session cursor map and tombstones.
- `data/threadListRow.ts`: the wire-row adapter.
- `data/thread-summary-database.native.ts`: `applyServerRows`, the race rule in
  `applyCatalogPage`, deferred device fields.
- `data/catalog-lifecycle.ts`, `data/catalog-runtime.ts`,
  `data/thread-sync-reconnect.ts`: visibility and forced re-read.
- `features/threadList` reads the summary store and must not import the stream
  ingress.

## Paired release and rollback

Companion and APK publish only together through `Release Affected Products`;
until both lines are merged neither side is published. An old client against a
new Companion is closed with `list_stream_required`; there is no capability
discovery, flag or fallback for an unpaired pair.

Rollback is also one paired release of both slice sets; neither side
understands the other's old mode, so there is no partial rollback.

Rollback triggers after release:

- `list_stream_required` closes in Companion logs (an unpaired release);
- server fields diverging from a `thread/list` re-read after returning to the
  foreground;
- an active thread that does not appear in the list without a manual refresh;
- missing Kotlin turn-completion notifications;
- growth of `invalid_list_rows` in device telemetry.

## Verification

- Companion: ten threads changing in one interval produce one frame with ten
  rows; an immediate event with pending coalesced changes produces one frame with
  every dirty row; 150 dirty rows produce frames of 100 and 50 in order; an
  interest thread's preview goes out without the 1500 ms wait, and ten seconds
  of its deltas produce at most 41 frames while a status change goes out at once;
  `visible:false` produces no frames until `visible:true`; a hub update at
  `H+3` during a page read yields the hub's fields with cursor `H+3`; a
  non-primary provider row is pushed live;
  `hello` without `listStream` closes with `list_stream_required`.
  Gates: `pnpm test:companion`,
  `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all --check`.
- Android: a push with `cursor = H+5` that arrives before a page with `H`
  survives; a tombstone above `H` keeps a page row from resurrecting; a new
  generation clears the map and drops old frames; `visible:true` precedes the
  re-read; device fields survive pushes and pages; a frame violating a limit
  resets with `invalid_list_rows`. Gates:
  `pnpm exec vitest run apps/android/test` from the repository root,
  `pnpm validate:android:v1`, `pnpm --filter @codewide/android compile:android`,
  and the Gradle unit tests of the `remote` module.
- Integration after both lines merge: new APK against new Companion, at least 8
  running threads, no open chat, 10 minutes; `threadListRows` at most one frame
  per 1500 ms per socket plus immediate frames, and every server field matches a
  `thread/list` re-read.
