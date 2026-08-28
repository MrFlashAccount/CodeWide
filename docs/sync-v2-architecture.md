# Sync API V2 architecture

Status: approved structural contract for the initial V2 implementation.

Sync API V2 is a greenfield semantic product protocol. It gives each connected
client an authoritative bounded view, closes the snapshot-to-live race without
durable event replay, and keeps command retry safety separate from connection
delivery. V1 may remain deployed at `/v1/sync`, but it is not a V2 dependency,
adapter, fallback, or compatibility surface.

## Contract authority

- `apps/companion/contract/v2.json` is the executable wire contract. Rust,
  TypeScript, and Kotlin validators must be generated from it and must reject
  unknown fields and unlisted variants.
- This document owns the structural decisions: boundaries, responsibility,
  lifecycle, dependency direction, rollout rules, and review gates.
- Source readers and App Server APIs are implementation details behind V2
  adapters. Their DTOs, method names, cursors, errors, and state transitions are
  not V2 protocol terms.
- `apps/companion/contract/v1.json` continues to own V1. Neither contract
  imports, extends, or falls back to the other.

Changing a V2 capability requires a contract revision that freezes its semantic
parameters, result, authorization, retry class, errors, and evidence. A generic
RPC or forwarding escape hatch is forbidden.

## Architecture decision

The Companion owns one dedicated V2 App Server session per Companion process.
All V2 connections share that upstream generation through a V2-only subscription
coordinator, while every downstream connection owns an independent epoch,
barrier queue, acknowledgement state, and backpressure budget.

This is the selected structural lane because it combines one bounded upstream
lifecycle with independent downstream state. A V1-labelled adapter was rejected
because it would inherit source and V1 wire semantics. One upstream session per
V2 client remains an experiment, not the approved runtime model; it may be
reconsidered only with capacity and request-ownership evidence.

## Ubiquitous language

Use these terms in code, tests, telemetry, and review:

- **query**: a bounded semantic read with exactly one completed or failed result;
- **command**: a durable, retryable mutation identified by an operation id;
- **action**: generation-bound resolution of an ephemeral pending request;
- **connection epoch**: the lifetime of one authoritative initialization and
  live-delivery sequence for one downstream socket;
- **barrier queue**: an epoch-local, bounded, non-durable queue covering the
  snapshot-to-live seam;
- **snapshot**: a bounded authoritative projection plus its included tail,
  scope, revision, and watermark;
- **change**: a normalized semantic projection change ordered within an epoch;
- **projection generation**: a client durability unit prepared invisibly and
  made visible by one atomic active-generation marker;
- **operation receipt**: the durable admission and terminal record for a command;
- **saved server**: one client-local server record with a stable opaque
  `savedServerId` that owns one independent durable V2 partition;
- **server selection**: a client-local derived-view choice represented as
  `{kind:"selected",savedServerIds:[...]}` for one or an arbitrary explicit set,
  or `{kind:"all"}` for all current saved servers; changing it never changes a
  partition's identity or lifetime;
- **server-qualified identity**: a client aggregate identity whose first
  component is the owning `savedServerId`, so equal entity or operation ids on
  different servers remain distinct;
- **authenticated principal**: the remote identity proven to the Companion for
  server-side authorization and audience routing, never a client cache key;
- **catalog anchor**: structural catalog pagination position, not a sync cursor;
- **history cursor**: a V2-owned, thread- and source-witness-bound pagination
  cursor, never an upstream cursor.

Do not call a source RPC an operation or expose a source method name as a V2
capability.

## Bounded contexts and ownership

| Context | Owner | Owns | Does not own |
| --- | --- | --- | --- |
| V2 server protocol | `apps/companion/src/sync_v2/**` | decoding, semantic records, epoch state, queue accounting, snapshot cut, normalized changes, query dispatch, command lifecycle, action routing | V1 replay or V1 client behavior |
| V2 upstream composition | `apps/companion/src/main.rs` | creation of the dedicated V2 `UpstreamHandle` and injection into the V2 semantic source | V2 policy, event normalization, or subscription routing |
| V2 upstream integration | `sync_v2/production.rs` and `sync_v2/production/source_impl.rs` | `UpstreamSemanticSource`, generation monitoring, source-to-semantic adapters, and production capability dispatch | public wire types or downstream persistence |
| V2 semantic source seam | `sync_v2/source.rs` | `SemanticSource`, V2-only `SubscriptionCoordinator`, recipient intent, audience selection, and routing invalidation | App Server wire decoding or deployment construction |
| Source capabilities | existing Companion catalog, history, rollout, project, workspace, resource, queue, account, auth, and store modules | bounded protocol-neutral reads and mutations | V2 framing or client projection rules |
| Operation ledger | `sync_v2/ledger.rs` in a dedicated durable Companion keyspace | authenticated-principal binding, operation fingerprint, admission, terminal receipt, retention, tombstone | client saved-server partitions, epoch queues, or action retry |
| V2 client transport | `packages/sync-client` V2 modules and Android native V2 layer | endpoint selection, closed frame validation, epoch coordination, semantic facades | V1 engine state or UI rendering policy |
| Client saved-server partition | saved-server store plus V2 projection and operation storage | stable opaque `savedServerId`, atomic snapshot publication, included tail, scope, current thread, pending requests, and client operation state | server authorization, raw frame interpretation in UI, or server-selection policy |
| Client aggregate projection and router | V2 client application layer | one/selected-set/All derived union, server-qualified identities, and routing to the owning saved-server session | partition persistence, cross-server mutation broadcast, or global unqualified targets |
| Deployment composition | server route/configuration layer | independent `/v1/sync` and `/v2/sync` exposure and `sync-v2-mode` selection | protocol-level fallback |

Existing source modules may satisfy narrow V2 capability interfaces only when
their invariants are protocol-neutral. V2-only policy stays in the V2 owner; no
shared abstraction is justified merely because V1 has superficially similar
behavior.

## Structural entities and records

`ConnectionEpoch` is an entity for one socket lifetime. It owns its identifier,
upstream generation, phase, watermark, subscription intent, and barrier queue.
Disconnect or reinitialization ends it; a reconnect creates a new identity.

`CommandOperation` is a durable entity identified by `OperationId`. It owns the
canonical command fingerprint, admission, retained lifecycle, terminal outcome,
and expiry tombstone.

`ProjectionGeneration` is a client durability entity with `prepared`,
`committed`, and `abandoned` states. Readers see only the generation selected by
the active marker.

`SavedServer` is a client-local entity with a stable opaque `savedServerId` and
an explicit deletion lifecycle. Its V2 partition is a client-owned persistence
namespace, not a remote authenticated identity, transport endpoint, or server
selection. `ServerSelection` is a client-owned value, not an entity or storage
key with an independent lifecycle. It is exactly `{kind:"all"}` or
`{kind:"selected",savedServerIds:Array<savedServerId>}`; the selected array is
deduplicated and filtered to current saved servers, and may represent one or an
arbitrary set.

`AggregateProjection` is a read-only derived union over the selected independent
partitions. It stores no merged projection rows. Every aggregate row and handle
retains its owner as a server-qualified identity; at minimum thread identity is
`{savedServerId,threadId}` and operation identity is
`{savedServerId,operationId}`. Other aggregate query rows, pending requests, and
action targets retain the same explicit owner even when their source-local ids
or paths are equal.

The barrier queue, authoritative snapshot, semantic DTOs, cursors, errors,
subscription intent, and operation receipt are owned records. They are not
independent entities. App Server state and canonical rollout files remain the
sources of thread history; the V2 runtime does not become the canonical history
owner.

## Dependency direction

The permitted direction is:

```text
downstream transport
  -> V2 application policy
    -> semantic records and capability interfaces
      <- source adapters

UI -> committed client projection
```

Binding bans:

- `sync_v2/**` must not import V1 sync frames, replay records, client types, or
  cursors;
- V2 application policy must not import generated App Server wire unions;
- source adapters must not import client projection storage;
- UI code must not parse or branch on raw V2 frames;
- V2 client code must not import or invoke the V1 engine as fallback;
- no V2 module may branch on V1 availability;
- barrier queue state must not enter the operation-ledger keyspace;
- source-specific cursors, numeric errors, method names, or initialization
  records must not cross the V2 wire.

The only approved place where `/v1/sync` and `/v2/sync` coexist is deployment
composition.

## Source proof and compatibility

| Concept | Classification and owner | Runtime entrypoint and lifecycle | Durable/schema owner | Forbidden path and negative check | Review gate |
| --- | --- | --- | --- | --- | --- |
| Connection epoch | entity in `sync_v2/**` | `/v2/sync`; created by `open`, destroyed by disconnect or reinitialization | ephemeral server state; frame shape in `contract/v2.json` | no V1 replay/cursor import; dependency scan and reconnect tests | Architect, backend, QA |
| Barrier queue | epoch-owned record in `sync_v2/**` | capture-before-read through ordered drain; dies with epoch | non-durable | no operation-ledger persistence; restart and overflow tests | Backend, QA |
| Semantic records | closed DTOs owned by V2 protocol | snapshot, changes, queries, commands, and actions | `contract/v2.json` | no generated App Server union on the wire; schema and import checks | Architect, backend, frontend |
| Command operation | durable entity in server ledger and client saved-server partition | command admission through exactly one retained terminal outcome and read-only receipt reconciliation | server authenticated-owner binding; client `savedServerId`; ledger fields plus `contract/v2.json` lifecycle | no blind redispatch, lookup state mutation, cross-owner server replay, cross-saved-server client merge, or barrier state; restart/replay/reconciliation/conflict/partition tests | Backend, frontend, privacy, QA |
| Operation receipt | command-owned durable record | written before lifecycle outcome is reported | operation ledger | not a domain entity and not an action receipt; storage and outcome-matrix checks | Architect, backend |
| Projection generation | saved-server-owned client durability entity | prepared, atomically committed, or abandoned | `savedServerId` namespace in the client V2 projection store | no cross-server merge or re-key, raw-frame UI state, or mixed-generation reads; server-switch, deletion, crash, and dependency tests | Frontend, privacy, QA |
| V1 endpoint | separate public compatibility exception owned by deployment composition | `/v1/sync` only, with existing lifecycle unchanged | `contract/v1.json` and existing V1 stores | no V2 adapter, import, automatic fallback, or migration; route and import checks | Architect, backend, frontend |

The V2 server and client source zones are not organizational wrappers: they own
the protocol state machines, policy, and durable boundaries listed above.
Deleting either zone removes V2 behavior and forces its invariants into transport
or UI callers. The upstream integration is a boundary to a volatile external
protocol, not a speculative multi-adapter plugin seam; it owns translation and
generation invalidation that must not leak into V2 policy.

The upstream owner mapping above is binding for this implementation. Moving
dedicated-session construction, generation monitoring, semantic adaptation, or
subscription coordination to another seam requires explicit architecture
approval and a matching update to this document before implementation. File
movement alone must not silently change ownership.

No deprecated V2 export, V1-to-V2 wrapper, alias, or legacy import path is
approved. The existing V1 endpoint is an explicit public exception during
rollout, not a temporary V2 compatibility layer. Its later removal, if any, is a
separate product and deployment decision.

## Epoch lifecycle

The server state machine is:

```text
waitingOpen -> initializing -> awaitingCommit -> draining -> live
      ^                                                  |
      +------------- reinitialize destroys epoch <------+

any non-closed state -- disconnect --> closed
```

1. `open` creates an epoch, registers its recipient, installs V2-only intent,
   starts count/byte accounting, and begins bounded authoritative reads.
2. The snapshot composer records a source witness, cuts the epoch watermark,
   folds a safe ordered queue prefix into the included tail, retains the opaque
   commit revision, and emits the snapshot.
3. The client prepares snapshot-owned rows, included tail, scope, current
   thread, and pending requests under an inactive projection generation.
4. One atomic marker publishes that generation. Only then may the client
   acknowledge the exact epoch, revision, and watermark tuple.
5. The server validates that tuple, drains remaining changes in watermark order,
   emits `live`, and then forwards normalized changes under the epoch's own
   backpressure budget.

No query, command, or action is legal before `live`. Reconnect never supplies a
replay cursor. Queue overflow, snapshot overflow or failure, source gaps, invalid
commit, or V2 upstream-generation change destroys the epoch and returns the
socket to `waitingOpen` through `reinitialize`.

An upstream-generation change also invalidates V2 subscriptions, pending
requests, and source witnesses. The dedicated session reinstalls only V2
subscriptions; every affected connection initializes authoritatively again.

## Semantic capability registry

The initial registry is closed. Exact records and validators live in
`apps/companion/contract/v2.json`.

- Queries: capabilities, models, catalog page, bidirectional history page,
  thread resources, projects, workspace inspection, queue, and accounts.
- Commands: thread create/fork/update/delete/compact/rollback, turn
  submit/steer/interrupt, project add, workspace create, queue mutation, and
  account update.
- Actions: current-generation pending-request resolution only.
- Changes: thread upsert/removal, turn upsert, pending-request open/close, and
  resource, queue, or account invalidation.

Application failures use only the closed V2 error code/recovery registry. Source
numeric errors and open-ended error payloads are not permitted.

Terminal, realtime audio, dictation, arbitrary tool invocation, raw shell
execution, source-protocol initialization, and generic method forwarding are
absent. New capabilities must be added explicitly to the contract rather than
encoded through an open method string or payload bag.

Catalog pagination uses `CatalogAnchor`. History pagination uses a V2 cursor
bound to schema version, thread, direction, anchor, and source witness. Wrong
version, thread, or direction is invalid; a changed or missing witness is stale.
Appending beyond a preserved anchor does not invalidate it. Neither value is an
epoch replay position.

## Command lifecycle

The ledger fingerprints canonical JSON of the complete semantic command before
dispatch. The server ledger binds operation id, fingerprint, kind, admission,
and terminal outcome to the independently verified authenticated principal
before reporting them. The client stores the corresponding operation only in
the originating `savedServerId` partition. `savedServerId` never crosses the V2
wire and server authenticated identity never names a client partition. The legal
lifecycle is exhaustive:

| Situation | Wire lifecycle | Terminal rule |
| --- | --- | --- |
| Invalid, forbidden, unsupported, or conflicting id/fingerprint before admission | `commandRejected` | terminal; never preceded by acceptance |
| Retained tombstone with expired payload result | `commandExpired` | terminal; never preceded by acceptance for that request |
| New or duplicate retained admission | `commandAccepted` | non-terminal |
| Proven success after admission | `commandCompleted` | exactly one terminal outcome |
| Proven non-success after admission | `commandFailed` | exactly one terminal outcome |
| Success or failure cannot be proven | `commandIndeterminate` | exactly one terminal outcome |

The same operation id with the same fingerprint replays the retained lifecycle;
the same id with a different fingerprint is rejected. After admission, adapter
dispatch is never repeated blindly after restart. Reconciliation may derive a
terminal result only from authoritative state; otherwise the operation becomes
indeterminate. Result and error combinations not represented by the contract
are invalid.

Actions are deliberately different: they carry no durable operation id, may
resolve only a pending request in its original upstream generation, and are
never retried across generation loss.

## Boundedness and client isolation

Every initialization read, queue, page, and payload has explicit count and byte
bounds. Initialization must not depend on full catalog traversal, complete
thread materialization, full indexing, or prefix backfill. Cold bounded reads and
background indexing are allowed behind semantic adapters.

Initial canary ceilings are:

| Surface | Ceiling |
| --- | --- |
| Active catalog summaries | 100 |
| Archived catalog summaries | 100 |
| Initial turn window | 36 plus bounded mutable head |
| Catalog or history page | 100 |
| Barrier queue | 2,048 events and 4 MiB |
| Snapshot | hard byte cap supplied in V2 limits |

These are rollout inputs, not permission to omit accounting. Record page and
record counts, source bytes, snapshot bytes, queue high-water marks, and phase
latency. Measured p95/p99 latency, peak memory, and safe multi-client capacity
gate any wider rollout.

Each connection owns its intent, queue, watermark, acknowledgement, overflow,
and live state. One client's slow consumer, invalid commit, overflow,
disconnect, or scope must not advance, discard, disclose, or reinitialize
another client's state. Partial catalog absence never means deletion outside
the declared scope.

## Authentication, audience, and privacy

Reuse protocol-neutral Companion authentication, then authorize every semantic
query, command, and action independently. Subscription intent is not authority.
Cursor or revision modification must not expand scope.

Every normalized change, pending request, command admission/result, and
diagnostic identity requires one explicit authenticated audience before it is
enqueued or emitted to an epoch. Missing, ambiguous, stale-generation, or
conflicting audience evidence fails closed:

- emit no client payload;
- record only content-free diagnostics;
- reinitialize any epoch whose routing proof is no longer valid.

### Client saved-server partitions and server authorization

Client durable V2 state is partitioned by the stable opaque `savedServerId`
owned by each saved-server record. Adding a server always creates a new
`savedServerId` and an empty independent partition, even when another saved
server has the same endpoint, Companion identity, authenticated device, display
name, or credentials.

`ServerSelection` chooses the application view without choosing a storage
owner. `{kind:"selected",savedServerIds:[...]}` derives a view over exactly the
known ids in the explicit set; one id is the single-server case.
`{kind:"all"}` derives a view over every current saved-server record. Adding,
removing, or reordering a selection must not delete, merge, migrate, re-key,
evict, copy, or otherwise mutate any selected or unselected partition. Editing
endpoint, relay, display, credentials, certificate pin, or remote authenticated
identity on an existing saved-server record also does not rename or purge its
partition; the transport performs a fresh authoritative initialization inside
the same client-owned partition.

The aggregate view is derived at read time. Equal source-local ids remain
distinct because the aggregate identity includes `savedServerId`. Every query
is sent to an explicit owning saved-server session. Every command carries a
server-qualified operation identity, and every command or action derived from
an aggregate row routes only to that row's owning session. No aggregate mutation
has an implicit global target or fans out across the selected set. Missing or
ambiguous ownership fails closed before transport dispatch.

Every client projection row, prepared or active generation marker, operation
record, cursor cache, and retained pending-request row is addressed first by
`savedServerId`. State is never copied or merged between saved-server partitions.
`savedServerId` is client-local and never crosses the V2 wire.

The Companion independently authenticates the remote principal and uses that
identity only for server-side authorization, audience derivation, routing, and
operation-ledger ownership. A changed or missing server-side authorization proof
fails closed at the protocol boundary, but it does not define, rename, merge, or
delete a client saved-server partition.

### Retention, minimization, and deletion

Client catalog, projection, and history cache has no 30-day lifecycle. It
remains in its `savedServerId` partition until explicit saved-server deletion or
ordinary bounded cache eviction. Cache eviction is local capacity policy and
must not be triggered by server-selection changes or remote identity changes.

- A projection store retains at most one committed generation and one prepared
  generation per saved-server partition. Abandoned prepared state is deleted
  immediately. After an atomic active-marker switch, the superseded generation
  is deleted. Bounded history and outside-scope catalog cache may remain in that
  same partition under ordinary capacity policy.
- Client and server operation retention are independent. The client deletes the
  semantic command body as soon as acceptance, rejection, or expiry is durably
  recorded. Client-local result or public-error payload is kept only while
  needed for in-flight publication. The
  client may keep minimal content-free receipt or tombstone deduplication
  metadata for at most 30 days, scoped by `savedServerId`; it contains only the
  operation id, canonical fingerprint, command kind, timestamps, and terminal
  or expired class.
- The Companion never retains the raw semantic command body. After a terminal
  outcome it retains the terminal `CommandResult` or public `V2Error` until the
  exact `payloadExpiresAt = terminalAt + 30 days`. At that instant the payload
  is atomically removed and replaced by a content-free tombstone containing
  only the authenticated server-context owner, operation id, terminal state,
  `acceptedAt`, `terminalAt`, and `payloadExpiredAt`. The tombstone remains until
  explicit authenticated server-context purge; it has no independent day-30
  deletion rule.
- The tombstone contains no command, result, public-error message, conversation
  data, attachment, credential, or source diagnostic. Authenticated
  server-context purge deletes the context's server receipts and
  tombstones only after its lifecycle fence has revoked affected sessions and
  drained or cancelled accepted work according to the backend context-purge
  contract.
- Backend receipt retention never defines, evicts, renames, or deletes a client
  partition. Client saved-server deletion has no remote effect and does not
  request or imply authenticated server-context purge.

Explicit deletion first persists a delete intent that blocks session creation,
aggregate reads, and all new access to the target `savedServerId`. It removes
the id from every explicit selected set; `all` remains a mode and its derived
membership loses the deleted record automatically. Deletion then purges every
client-local V2 record for only that `savedServerId`, including projections,
history, catalog, operations, receipts, tombstones, cursors, pending requests,
and prepared or active generation markers. Deletion overrides every cache policy
and client receipt TTL. The saved-server delete is not complete and its intent
is not cleared until the entire partition is unreadable. If any namespace purge
fails or the process restarts, the durable intent keeps the server blocked and
retry resumes cleanup; surviving rows cannot reopen the session or reappear in
an aggregate view.

Telemetry may include phase duration, queue high-water, snapshot size/scope,
source-read work, reinitialization reason, command admission/outcome, and
projection recovery. It must not include conversation content, request answers,
attachments, credentials, tokens, or secrets.

Any cross-client payload or identity disclosure blocks rollout and requires
immediate V2 disablement.

## Rollout and rollback

Backend rollout is controlled by `--sync-v2-mode disabled|canary` and defaults
to `canary`. When disabled, `/v2/sync` rejects the WebSocket upgrade with HTTP
503, content type `application/problem+json`, and this exact body:

```json
{
  "type": "https://codewide.dev/problems/sync-v2-disabled",
  "title": "Sync V2 disabled",
  "status": 503,
  "code": "sync_v2_disabled"
}
```

It emits neither V2 nor V1 frames. Malformed or unknown V2 records close with
WebSocket 1008 without source dispatch, malformed JSON closes with 1007, and
binary frames close with 1003.

Clients use explicit endpoint and rollout configuration. They remain offline
when their selected V2 endpoint is unavailable and never derive `/v1/sync`
automatically. Re-enabling V2 requires no V1 data migration because the two
protocols have no shared replay or projection state.

## Review gates

V2 is not rollout-ready until all mandatory gates pass:

| Gate | Required evidence |
| --- | --- |
| Architect | No V1 compatibility path, source-wire leak, ownerless module, dependency reversal, fake seam, or contract/docs drift |
| Backend | Closed validator parity, epoch/upstream/ledger ownership, every query/command/action pair, exhaustive command outcomes, and disabled-mode behavior |
| Frontend | Closed validator parity, exact commit acknowledgement, crash-atomic projection publication, semantic facade usage, and no UI raw-frame parsing |
| QA | Real-account seam races, two-client isolation, Observer-originated changes, reconnect and generation loss, bounds, pagination, cursor failures, operation replay/conflict/expiry, and disabled mode |
| Privacy | Server audience derivation, client saved-server partition isolation, fail-closed deletion purge, client content-free metadata capped at 30 days, server payload expiry followed by content-free context-lifetime tombstone, generation binding, content-free logging, and fail-closed behavior for every missing or ambiguous routing case |

Privacy review is mandatory because one V2 upstream session routes changes,
pending requests, command ownership, identities, and diagnostics into multiple
downstream recipients. Security review becomes mandatory if implementation adds
new authority, secrets, or a trust boundary beyond this contract.

The real-account harness is the first seam proof. Deterministic fake-source and
wire-contract fixtures follow it; fake green tests cannot overrule a lost event,
duplicate command, mixed projection, unbounded run, or cross-client disclosure.

## Structural invariants

- V2 exposes semantic product records only and has no V1 or App Server wire
  inheritance.
- A client becomes live only after atomic publication and exact commit
  acknowledgement, followed by ordered drain.
- Epoch watermarks order delivery only inside one epoch and are neither global
  sequences nor reconnect cursors.
- Epoch queues die with the socket; operation receipts and client projection
  generations survive their defined durable horizons.
- Every client-local durable V2 key begins with `savedServerId`; server-selection
  or remote-identity changes do not mutate partitions, aggregate identity is
  server-qualified, and saved-server deletion purges only the entire owning
  partition behind a durable fail-closed delete intent.
- Server authenticated-principal ownership is independent of client cache
  identity and lifetime; neither identifier substitutes for the other.
- Server terminal payload expires exactly 30 days after `terminalAt`; its
  content-free tombstone survives until authenticated server-context purge, and
  client saved-server deletion never triggers that remote purge.
- Every capability, payload, loop, and read is bounded and cancellable.
- Independent client state and explicit authenticated audience are preserved at
  every shared-upstream routing point.
- Unprovable synchronization or routing fails closed by reinitializing or
  disabling V2; it never degrades to V1 or guesses.
