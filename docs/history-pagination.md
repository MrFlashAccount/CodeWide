# Conversation history pagination

The Companion owns canonical logical history, including rollback and interrupted
turns. SQLite stores a sparse cache. A cached minimum or maximum is not proof of
the beginning or end of canonical history.

## Semantic pages

- `companion/thread/history/after`: `{threadId, afterTurnId, limit, sourceWitness?}`.
- `companion/thread/history/before`: `{threadId, beforeTurnId, limit, sourceWitness?}`.
- Both return `{data, hasMore, sourceWitness}`. `data` is chronological, excludes
  the anchor, and contains the nearest surviving terminal turns in the requested
  direction. The mutable head is supplied by thread sync, not pagination.
- `hasMore` refers to that direction at the response's source checkpoint. It is
  not a permanent statement about future history. A page with `hasMore: true`
  must contain at least one turn. IDs within a page must be unique.
- `sourceWitness` is opaque. An older witness may remain valid across ordinary
  appends even if the next response returns a different token. Clients must not
  infer source replacement from token inequality.
- A missing anchor or incompatible source returns RPC error `-32021`. The client
  performs authoritative thread sync and replaces an invalid traversal. It does
  not convert that error into exhaustion. Other failures remain retryable.

Witness validation covers ordinary append, replacement and truncation. It does
not prove the absence of arbitrary interior rewrites combined with growth and
unchanged sampled bytes; that requires stronger source-owned revision authority.
Resolving a cold distant anchor may scan a large rollout once. Persisted coverage
and the per-rollout indexing lane let subsequent requests reuse that work.

## Client publication

The committed resident range and durable lookup facts have separate membership.
Only the contiguous adjacent part of a SQLite page may extend a range. A gap
triggers a semantic request at the last contiguous boundary in either direction;
cached islands do not advance that boundary. Overlapping server pages reconcile
by turn ID. Historical pages cannot reposition an unrelated mutable head.

Every network read captures its database, connection session and connection
authority. Persistence rechecks that authority inside the serialized write lane.
History epoch changes supersede pending range writes. Reconnect, snapshots and
authoritative invalidation expire cached exhaustion.
A semantic read captures its requested witness before sending. When an old cache
has no witness, only the first still-unqualified page may establish one; another
concurrent unqualified response is discarded. A retry uses the known witness.

Short measured content requests a bounded sequence of pages through model-owned
viewport intent. It stops on sufficient height, no progress, exhaustion, failure,
supersession or its per-intent page budget. The list retains scroll anchoring;
fetching is not scheduled from React effects.

## Deployment and compatibility

Release Companion before the OTA that uses these semantic methods. Older
Companions do not implement them. Whole-content-backed metadata-only turn
projections remain valid and are normalized as unloaded content by Conversation.
The V2 protocol is independent of this V1 Conversation contract.
