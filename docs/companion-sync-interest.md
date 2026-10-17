# Companion sync interest

Interest-filtered delivery is the only delivery mode of the Companion sync
WebSocket (`protocolVersion` 1, `/v1/*` paths unchanged). Every device socket
declares the set of threads whose content it wants; the Companion delivers
catalog-grade events for all threads and high-frequency thread content only for
threads in that set. There is no unfiltered mode, no compatibility flag and no
fallback on either side. Companion and the Android APK ship and roll back as one
paired release.

This document owns the wire contract, the socket position rules, the ordering
rules between interest and `companion/thread/sync`, the thread preview
semantics, the close reasons and limits, and the paired release/rollback rule.
Device-side ownership (interest membership, residency) is recorded in
[`apps/android/src/data/CONTEXT.md`](../apps/android/src/data/CONTEXT.md);
the incremental thread-list projection and the `turn/started` catalog guard are
recorded in
[`apps/android/src/features/threadList/CONTEXT.md`](../apps/android/src/features/threadList/CONTEXT.md).
Machine-readable limits live only in `crates/companion-core/contract/v1.json`.

## Vocabulary

- **interest**: the set of `threadId` values whose content a specific device
  socket subscribes to. Per socket, not per device or per Companion.
- **catalog topic**: every journal event that is not a thread topic. Always
  delivered to every socket.
- **thread topic**: the eight high-frequency `codewideThreadPatch.operation.kind`
  values `itemTextDelta`, `reasoningDelta`, `reasoningPart`, `turnPlan`,
  `turnDiff`, `fileChanges`, `mcpProgress`, `tokenUsage`. Delivered only for
  threads in the socket's interest.
- **socket position**: the last cursor the Companion considers accepted by this
  socket. The `afterCursor` of every sent frame equals the position before the
  send.
- **advance**: a frame without payload that closes a trailing run of skipped
  journal entries at the end of a replay page.
- **thread preview**: a synthetic catalog-topic event carrying the current text
  of a streaming answer, published at most once per interval.
- **residency**: membership of a thread in the device `ThreadDetailSource`, the
  target of the live transcript projection.
- **window**: a chat window owned by `data/thread-chat-model.ts`; mounted means
  a positive retain count or the resident resource scope.

## Wire contract

Direction, fields and timing of every frame touched by interest delivery:

| Frame      | Direction          | Fields                                                    | When                                                                   |
| ---------- | ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hello`    | client → Companion | existing fields plus `interest: string[]` (required, may be empty) | first frame of the session                                     |
| `interest` | client → Companion | `add?: string[]`, `remove?: string[]`                     | any time after `hello`; idempotent                                     |
| `event`    | Companion → client | `cursor`, `afterCursor`, `payload`                        | always; `afterCursor` is required on every event                       |
| `advance`  | Companion → client | `cursor`, `afterCursor`                                   | a replay page ended with skipped entries                               |
| `caughtUp` | Companion → client | `cursor`                                                  | unchanged; an `advance` for the same page precedes it                  |

The `hello` answer, `status`, `snapshotRequired`/`snapshotApplied` and the RPC
envelope are unchanged. The `interest` frame and the close reasons are literal
discriminated unions on both sides; `afterCursor` is optional only at the
parsing boundary, never inside the device store.

Contract sections in `crates/companion-core/contract/v1.json`:

- `syncInterest`: `threadTopicKinds` (the eight kinds above, the single source
  the Rust predicate and the device `HIGH_FREQUENCY_SUMMARY_PATCHES` set must
  equal), `maxInterestThreads: 64`, `helloInterestRequired: true`.
- `threadPreview`: `method: companion/thread/preview/updated`,
  `kind: threadPreview`, `publishIntervalMs: 1500`, `maxTextChars: 2000`.
- `threadProjectionPatch.operations` gains the `threadPreview` operation.

Extending `threadTopicKinds` is a contract change verified by
`apps/companion-linux/tests/v1_contract.rs`, never a local edit on one side.
Wire fixtures stay with the sync-wire owners (`contract/v1.json`, the Rust
contract and transport tests, Android literal vectors); nothing is added to
`packages/agent-protocol`.

## Delivery predicate

The journal is not filtered and not changed: it remains the single unfiltered
at-least-once source and the replay window for every socket (2048 entries,
4 MiB; the `delivered_cursor` window math is unchanged). The decision is taken
at send time from the already attached `codewideThreadPatch`:

1. No `codewideThreadPatch`: catalog topic, deliver.
2. `operation.kind` not in `threadTopicKinds`: catalog topic, deliver.
3. `operation.liveActivity` present: catalog topic, deliver. A reasoning title
   or plan step therefore reaches an unsubscribed row.
4. Otherwise deliver only when `threadId` is in the socket's interest; a
   skipped entry does not move the socket position.

`itemUpsert` (`item/started`, `item/completed`), `turn/*`, thread status,
`liveActivity`, pins, pending requests and every `companion/thread/*` event are
never filtered. A predicate that drops any of them fails review.

The predicate and the position are one owner, `crates/companion-core/src/sync/interest.rs`
(`SocketInterest`, `SocketPosition`, `ReplayDelivery`), shared by the three
send sites: initial `accept_hello` replay, post-`snapshotApplied` replay and the
live replay task. `SocketInterest` is created once from `hello.interest` and
changes only through `interest` frames. The module does not import
`thread_view` or provider crates.

## Socket position rules

- Initial position is `hello.cursor` when it is not null.
- With `hello.cursor = null` the Companion requires a snapshot, sends no event
  before `snapshotApplied`, and the position is defined only after it: position
  equals the accepted snapshot cursor.
- For every sent `event` or `advance`: `afterCursor == position`, then
  `position = cursor`; always `afterCursor < cursor`.
- A skipped entry does not move the position. When a replay page has been
  filtered and `position < head` of that page, exactly one
  `advance { cursor: head }` is sent before `caughtUp`.
- Reconnect inside the window: replay starts with the first frame whose
  `afterCursor` equals `hello.cursor`. Reconnect outside the window:
  `snapshotRequired` as today, then filtered replay from the accepted snapshot
  cursor.

## Ordering rules

- **Interest inline before the next frame.** `run_session` applies an
  `interest` frame to `SocketInterest` before reading the next incoming frame.
  RPC frames are still spawned as tasks after that point, so an `interest add`
  that precedes `companion/thread/sync` on the same socket is in effect before
  the sync fence is taken.
- **Page first, interest snapshot second.** The live replay task reads a journal
  page and then takes its interest snapshot. An `add` applied before the
  snapshot covers the whole page; an `add` applied after it has a sync fence
  `F >= head` of that page, so the skipped entries of that page are covered by
  the `companion/thread/sync` answer. No catch-up signal is needed.
- **Device awaits interest before sync.** Window hydration awaits the native
  `engineInterest` declaration containing the thread before issuing `companion/thread/sync`. Both
  native calls travel in call order through the one connection service to the
  protocol engine. If the socket is closed, the interest set is already
  persisted and goes out in the next `hello`; the RPC is deferred until the
  session is live, which is after that `hello`.
- Every delta of a subscribed thread is covered exactly once: `cursor <= F` by
  the sync answer, `cursor > F` by a delivered frame applied above the
  projection cursor behind the existing `beginProjectionSnapshot` gate.

## Device acceptance

Native ingress (`NativeFrameStore.appendEvents`, cursor `C` from
`native_sync_state`) accepts a batch entry by these rules, in this order:

- `cursor <= C`: duplicate, skip (as today).
- `afterCursor` absent or not a number: the frame is invalid;
  `resetTransport("invalid_event")`, or `invalid_advance` for an `advance`.
- `afterCursor == C` is required. `C == null` accepts any `afterCursor` and can
  only occur before the first snapshot. Any other value is a real chain break:
  `NON_CONTIGUOUS` → `non_contiguous_sync_cursor`, fail-closed, never softened
  into catch-up.
- An `advance` follows the same rule and then sets `C = cursor` without a
  `native_frames` row. Batch entries are a sealed `Event | Advance` pair; arrival
  order is preserved inside a batch.

`native_frames` is unchanged; no `after_cursor` column is stored. The JS drain
accepts strictly increasing cursors, and an empty committed page with
`headCursor > readCursor` is a closed skipped range that moves the read cursor
and acknowledges it.

Interest persistence: `native_sync_state.interest_json` (`TEXT NOT NULL
DEFAULT '[]'`, added through the existing `ensureColumn`, no
`PROJECTION_SCHEMA_VERSION` change). `engineInterest(connectionId,
threadIdsJson)` carries the full desired set: the native engine diffs it against
the persisted set, persists the new set first, then sends only the difference
as `interest { add, remove }` on an open socket (the wire contract is
unchanged). The persisted set is read on socket open for `hello.interest`.
`attachRuntime` never touches interest: it also runs on foreground repair,
projection recovery and home reconnect of a live runtime, whose mounted windows
must stay subscribed. Instead each JS engine session declares its full set once
when the native session first reports state; a fresh runtime declares an empty
set, which overwrites interest persisted by its predecessor. `engineInterest`
is a required method of the native engine contract; the device never checks the
Companion version and never feature-detects the method.

## Thread preview

A thread preview is a Companion-side catalog event, published while a thread
streams text so that an unsubscribed list row keeps a current preview:

- Event `companion/thread/preview/updated`, patch kind `threadPreview`,
  `operation.summary = { activity: true, conversationMessage: false, finalAgentResponse: false, previewText }`.
- Published on arrival of a text delta when at least 1500 ms passed since the
  last publication for that thread; no Companion timer. The tail of the stream
  is covered by `item/completed`, which carries the full text as today.
- `ThreadPreviewTracker` (`crates/companion-core/src/thread_preview.rs`) keeps
  per thread the `itemId`, the accumulated text capped at 2000 characters and
  the last publication time, for at most 4096 threads (the `LiveActivityTracker`
  bound). It is cleared on `item/completed` of the same item, `turn/completed`
  and `thread/deleted`. Observation happens 1:1 in `project_journal_payload`
  before content projection; the synthetic event is appended by
  `ingest_payload_batch` directly after the delta that produced it, after
  stream-text coalescing and before serialization.
- On the device the detail projection treats the unknown kind as a no-op. The
  summary projection applies the ordinary `previewText` branch: the preview
  bumps `updatedAt` and `latestActivityCursor`, carries no `recencyAt` and does
  not touch `unread`, so rows that already have a `recencyAt` keep their order.
- The acceptance comparison between a streaming thread's summary and a
  `thread/list` re-read compares every `StoredThreadSummary` field except
  `updatedAt`.
- The preview text is a subset of already journaled delta text; it is never
  written to logs on either side.

## Close reasons and limits

All closes use code 1008 like the neighbouring control-frame errors:

- `interest_required`: `hello` without the `interest` key.
- `invalid_interest`: `interest` is not an array of strings, an element is empty
  or longer than 256 characters, or a frame carries more than 64 elements.
- `interest_limit_exceeded`: the socket's set would exceed 64 threads.

Companion close logs carry the reason and the sizes involved, never a `threadId`
from the frame and never preview text. The device reconnects under its normal
policy. The device structurally produces only a handful of mounted scopes
(sidebar, conversation, search, subagent), so the limit is a safety bound, not a
working range.

## Ownership

- `crates/companion-core/src/sync.rs`: `accept_hello` requires `interest`,
  `run_session` applies `interest` frames inline, the three send sites go
  through `ReplayDelivery`, ingest calls the preview tracker.
- `crates/companion-core/src/sync/interest.rs`: interest parsing and limits,
  delivery predicate, `afterCursor` chain, `event`/`advance` frame assembly.
- `crates/companion-core/src/thread_preview.rs`: preview rate and shape; a
  separate owner from `thread_activity.rs` because its reason to change differs.
- `crates/companion-core/src/thread_patch.rs`: compiles
  `companion/thread/preview/updated` into the `threadPreview` operation.
- Android native: `NativeProtocolEngine` owns `hello.interest`, `interest`,
  `advance` and persistence; `NativeFrameStore` owns the acceptance rule and the
  column; `CodeWideModule` is only the bridge.
- Android JS: see [`data/CONTEXT.md`](../apps/android/src/data/CONTEXT.md).
- `packages/sync-client`: the former JS wire client (`SyncSession`,
  `MultiConnectionSupervisor`) is deleted; it had no application consumer and
  would be closed with `interest_required`. `RpcResponseError` lives in
  `src/rpc-error.ts` with its unchanged `index.ts` export. `thread-events.ts`
  stays the owner of pure projections where an unknown kind is a no-op. The
  package does not import `packages/agent-protocol`.

## Paired release and rollback

Companion (contract and filter) and the APK (native acceptance and JS interest
ownership) publish only together through `Release Affected Products`. Until both
lines are merged, neither side is published.

- An old client against the new Companion is closed with `interest_required`.
- A new APK against an old Companion resets its transport with `invalid_event`
  on the first event without `afterCursor`.
- Neither failure is silent degradation: the connection does not work until the
  pair is updated.

Rollback is also paired: reverting the Companion slices and the APK slices is
one release, because neither side understands the other's old mode. The thread
list projection slice does not touch the wire and rolls back independently.

Rollback triggers after release: growth of `non_contiguous_sync_cursor` or
`invalid_event` in native telemetry; `interest_required` closes in Companion
logs (an unpaired update); summary fields diverging from `thread/list` in the
acceptance check; a window that stays frozen after returning to it (a lost
subscription).

## Verification

- Companion: `hello` without interest closes; `afterCursor` chain and `advance`
  before `caughtUp`; `interest add` followed by `companion/thread/sync` with
  deltas journaled in between loses no delta; an `add` arriving during a page
  send is covered by the fence; preview rate, cap and clearing; reasoning
  `liveActivity` reaches an unsubscribed socket. Gates: `pnpm test:companion`,
  `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all --check`.
- Android: Robolectric acceptance test of `event(afterCursor)`, `advance`,
  duplicates, a chain break (`non_contiguous_sync_cursor`) and a frame without
  `afterCursor` (`invalid_event`); JS drain of pages with gaps and empty pages
  with a moved head; window hydration awaits interest before sync; repair never
  touches interest or residency. Gates: `pnpm validate:android:v1`,
  `pnpm --filter @codewide/android compile:android`, Gradle unit tests of the
  `remote` module.
- Integration after both lines merge: new APK against new Companion, at least 8
  running threads, zero chat windows, 10 minutes; the native
  `sync.ingress_window.eventCount` per minute follows the lifecycle, live
  activity and preview rate rather than the delta rate, and every
  `StoredThreadSummary` field matches a `thread/list` re-read.
