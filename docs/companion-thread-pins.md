# Companion-owned pinned chats

Pinned chats belong to the Companion instance, shared by its connected devices.
The authoritative `thread_pins` table lives in the Companion state database
`state.redb`. It survives replay retention and derived rollout-index rebuilds.
Android SQLite retains a display/offline copy only.

On upgrade, Android captures retired local pins in a pending SQLite import table
before clearing their old display flags, in the same transaction. Thread metadata,
drafts and unread state remain intact. The pending table survives catalog eviction
and is scoped by connection. At the first successful connection, Android imports
that server's batch before refreshing pin membership. It clears only the batch
covered by a validated durable acknowledgement. Disconnects, invalid responses and
process restarts leave the batch available for retry.

`companion/thread/pins/import` accepts `{ threadIds }` and acknowledges `{ cursor }`.
The ordered writer atomically establishes previously unknown pins and their replay
events. Existing server decisions, including explicit unpins and deletion
tombstones, win over legacy flags. Duplicate imports are safe even when a commit's
acknowledgement was lost and another device subsequently unpinned a chat.

Pins already erased by an earlier hard-cut build cannot be recovered from this
cache. Migration applies only to legacy flags still present on upgrade. There is
no fallback to device-owned pin mutations. Deploy Companion before Android OTA;
no new Android native API is required.

## Mutation and synchronization

`companion/thread/pin/set` accepts `{ threadId, pinned }` with an explicit boolean.
The existing ordered ingest owner commits the state and its replay event in one
transaction, then acknowledges `{ threadId, pinned, pinCursor }`. Repeating the
same desired state cannot accidentally toggle it. Changes require a connection;
a failed request leaves the last confirmed display state intact.

`companion/thread/pin/updated` carries `{ threadId, pinned, pinCursor }` and a
`threadPinned` semantic patch. Pin changes affect neither unread nor recency.
Thread deletion records an unpinned tombstone in the same transaction as the
deletion event, so a delayed legacy import cannot resurrect the pin.

Thread shells and catalog pages carry
`codewide.threadPin: { version: 1, pinned, cursor }`. Consumers validate metadata
and preserve a newer pin through an older shell or replay event.

`companion/thread/pins/list` returns `{ cursor, threadIds, archivedThreadIds }`.
Its pin membership and replay head come from one read transaction. Archive
membership follows canonical rollout roots. Android loads missing thread metadata
without turns, then applies the complete pin set to that connection. This restores
pins outside recent pagination on a fresh device and clears removed pins after
reconnect. A snapshot cannot overwrite a row with a newer pin cursor.

## Verification

Tests cover explicit input validation, durable acknowledgement and publication,
two connected clients, repeated unpin, server isolation, restart, replay pruning,
index rebuild, deletion, legacy import retries and server precedence, preserved unread state, stale
snapshot/event ordering, fresh-device metadata recovery and malformed responses.
Physical Android interaction remains a separate device check.
