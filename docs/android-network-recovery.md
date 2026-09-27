# Android network recovery

Status: APK 226 regression correction released as `0.2.214 (227)`; no device installation.
The incompatible deployed contracts below are confirmed. Their exact contribution to the reported
handset outage remains unproven without a correlated projection/UI trace from that phone.

## Decision and evidence

The selected structural change stays inside Android. It separates Android default-route facts,
Companion/App Server readiness, event-driven presentation and Global Voice media recovery.
There is no shared boolean meaning both "internet works" and "the server is reachable".

The hands-free contract supersedes the initially implemented 60-second cutoff: an already enabled
Global Voice activation does not expire during network/service interruption. It waits and retries
until recovery or explicit Stop, subject to the separate authorization/session-safety boundaries.

Code mechanisms identified in the prior implementation:

- `CodexConnectionService.Session` reset its retry count at WebSocket open, before RPC was
  usable, and capped retries at one second. An accept/close loop therefore stayed aggressive.
- `globalSupervisorReconnectOwner` spent a cumulative four-attempt budget and opened replacements
  without a bound-home readiness port. Short offline periods could consume recovery attempts.
- `connectionPresentation`, `ConversationHistoryStatus` and `SidebarListFeedback` exposed raw
  transport/sync changes as transient progress, including replacing a completed empty list.
- `NativeProtocolEngine` deferred realtime start/stop/append RPCs while offline. Those commands
  are generation-local, so replaying an old stop can affect a newer session on the same thread.
- Android validation, WebSocket reachability and App Server readiness were not separately exposed
  to presentation. An error alone cannot establish absence of internet.

These mechanisms are source-confirmed, not proof that all occurred during the user's outage.

| Candidate | Falsification and verdict |
| --- | --- |
| Incremental: increase retry count and debounce text | FAIL as the complete solution: attempts still run offline, socket-open still resets backoff, old live controls can replay. Useful only as isolated components. |
| Structural: independent facts and owner-local policies | PASS for implementation. It addresses each demonstrated mechanism without changing Companion, Relay, shared sync-client or dictation storage. Device effectiveness remains CONDITIONAL. |
| Radical: native foreground-owned voice session, including signaling and recovery | CONDITIONAL. Could remove JS timer/lifecycle dependence; would move the whole realtime/media orchestration boundary and duplicate or migrate binding, delivery and tool lifetimes. High cost, reversible only behind a parallel adapter. Cheapest discriminator: screen-off/Doze trace showing JS recovery stalls while native route and peer evidence remain healthy. Do not migrate without that evidence. |
| Radical: resumable server session plus buffered offline speech | FAIL for the current contract: requires new protocol/acknowledgement and privacy semantics, cannot restore audio never received, and risks stale speech/actions. A disposable protocol proof would be required before any product integration. |

## Owners and facts

| Owner | Contract | Not its responsibility |
| --- | --- | --- |
| `DefaultNetworkState` + service default callback | `unknown`, `noDefaultNetwork`, `unvalidated`, `captivePortal`, `validated`, `blocked`; route epoch; ignore stale callbacks for replaced routes | Server probing, media teardown, declaring all internet unavailable |
| `CodexConnectionService.Session` + `TransportRetryPolicy` | One Companion socket and retry schedule per saved connection; generation-fenced asynchronous callbacks | Voice retries or UI grace periods |
| `NativeProtocolEngine` | Companion transport state, independent upstream App Server state and immediate `rpcAvailable`; preserve existing cursor/replay owner | Delayed display state or audio buffering |
| `connectionPath` | Validate the additive native envelope into project types; missing older-binary evidence is unknown | Infer network facts from error text |
| `connection-state-model` + `connectionHealth` | Raw readiness plus a pure, immediate presentation projection | Admission of RPCs or transport attempts; timers/polling |
| `thread-sync-reconnect` | One repair after each stable RPC recovery; invalidate reads on actual RPC loss | Reacting to OS capabilities or projection progress |
| `globalSupervisorConnectionReadiness` | Bound home is `ready`, `waiting`, or `blocked`; disabled/deleted/auth-required is blocked | Consume delayed health or Android validation |
| `globalSupervisorReconnectOwner` + recovery episode | One logical activation, one current/starting replacement, cancellation and bounded retry rate without an outage deadline | Own WebSocket, microphone hardware or history sync |
| `globalSupervisorRecoveryNotice` | One coalesced, live-only spoken recovery request for the current transport; cancelled with that transport | Initial greeting, durable attention, offline speech or transport retries |
| `globalSupervisorWebRtcSession.native` | SDP, peer, capture/playback gate, ICE-disconnect grace, idempotent local cleanup | Decide default-route or server availability |
| Audio-route runtime + foreground service | Report actual capture admission separately from explicit Mute; honest native presentation/notification | Start another peer or consume raw PCM as a queue |

`ConnectionPath` couples App Server state only to a connected Companion link. The link is otherwise
`connecting | waitingForNetwork | backoff | authRequired`. Android network evidence is independent.
Successful RPC is stronger evidence for this service than Android internet validation; working
LAN/VPN connections remain usable without a validated public internet route.

Path observations are private input to the health presentation owner. They must not enter
`ConnectionStateRow` or notify its runtime subscribers: those subscribers invalidate in-flight
history authority and schedule reconnect repairs. Repeated native state envelopes do not create
a new RPC-readiness transition. A real route replacement belongs to the socket owner.

## Regression correction

### APK 226 delivery failure

The actual release APK is version `0.2.213 (226)`, runtime `0.2.213-native-226`, SHA-256
`1b92517e049eaa440131797f241bd30431c622a58b95a772c01634765046c9a4`.
Its embedded Hermes bundle matches the generated release bundle byte-for-byte. Its matching
source map contains the v4-only `parseThreadSyncResponse` parser and unconditional history-read
invalidation in `thread-sync-reconnect`.

The running Companion process started on September 25. Its executable SHA-256 is
`18aecd9640a118679a5da4bdd0736ee9bd9aa834192736c36397856f62628912`.
Read-only disassembly of `ThreadViewService::sync` shows the `readModelVersion` key loaded from
`0x246990` at `0x9a6031`, followed by the serde positive-number value `3` at `0x9a606f`.
This confirms the running binary emits v3; it is not an authenticated capture of the phone's RPC.

Incoming path: WebSocket event → native durable journal → `NativeEngineSession` ordered projection
→ `thread-detail-database.native` detects a missing turn/item → authoritative thread repair →
v3 response rejected by the v4-only parser. Repair failure rejects the ordered projection batch;
later events cannot pass it, even when WebSocket reception continues. Reconnect replays the same
unrepairable batch. A v3 fixture failed before the adapter fix and now renders through real SQL,
shared models and the React chat selector/projection; a subsequent delta and reopening retain it.

The adapter now accepts deployed v3 and current v4. v3 cannot establish Fast/settings, so those
remain unknown; v4 retains strict execution-settings validation. No Companion deployment is
required. The parallel Fast/settings implementation is preserved.

Separate cancellation defect: every raw connection-row update previously invalidated history,
including `syncing`/`live` and diagnostics while RPC remained usable. Now only usable→unusable
invalidates; usable recovery coalesces for one second before one repair. Capability events never
trigger history work. This timer coordinates RPC recovery, not network presentation.

Separate handoff defect: `networkAvailable()` returned while an old socket remained open. If the
new default arrived before old-route loss, stale loss was correctly ignored but the old socket
survived until its heartbeat/close. A route-generation owner now replaces that socket once; repeated
capabilities or availability for the same route do not replace it. This code defect is reproduced
at the native protocol/journal seam, not on a physical Wi-Fi/cellular handoff.

Outgoing acknowledgements are distinct: local queue staging is not host acceptance. Native
`queue/put` success marks host delivery, while canonical/app-server receipts confirm execution.
An interrupted outstanding RPC fails/enters existing uncertain-command reconciliation rather
than being accepted locally. Native incoming ACK follows durable journal commit; JS projection ACK
follows successful store publication. The two ACKs do not mean the UI has displayed a frame.
Local optimistic row refresh no longer clears a real history error: successful authoritative
refresh/commit owns that transition.

### Earlier corrections retained

The first implementation incorrectly added path objects to raw connection rows and compared them
by reference. Every parsed native envelope created another object. `setPath` then notified
`thread-sync-reconnect` before publication of the actual transport state, invalidating healthy
history reads or briefly publishing the old `live` state during loss. The native-session/model
integration tests failed on both cases before the correction. Path evidence now only updates
health; genuine RPC loss/recovery still reaches raw consumers immediately.

The added immediate `onSocketClosed` call in native transport reset also exposed an existing
snapshot-cancellation defect: rejecting an in-flight catalog RPC called `snapshotFailed`, which
requested another transport reset. An App Server reconnect during snapshot loading likewise
reset the otherwise healthy Companion socket. Native tests reproduced both unwanted resets.
Each snapshot load now has its own identity, invalidated before cancellation callbacks run.
Superseded replies cannot reset the transport, acknowledge or contaminate a replacement snapshot,
even when both attempts have the same head cursor. Genuine current-snapshot failure still resets
once; active and archived catalog hydration, journal acknowledgement and ordinary RPCs keep
their existing contracts.

These reproductions establish code defects, not the precise reset reason on the user's phone.
The crossed-cloud history warning remains separate from OS facts and preserves real errors.
The unrequested `Syncing history` and `History sync failed` connection-health states are removed;
the preexisting mandatory history synchronization itself is retained.

## Reconnect and event-driven presentation

- Android `noDefaultNetwork` or `blocked`: invalidate native RPC immediately, cancel the socket and
  retry timer, then wait for a route callback. Other OS states permit connection attempts.
- New usable default route: one immediate wake of a waiting/backoff attempt. An open or connecting
  socket on the previous route is replaced exactly once per observed route generation. Capabilities
  updates are not repeated manual retries. Ordinary foreground/reattach does not defeat backoff.
- WebSocket failures: full jitter in `[0, ceiling)`, with ceilings 0.5/1/2/4/8/16/30 seconds.
  Reset only after ten seconds of native live + upstream RPC readiness, or explicit user reconnect.
  Authentication failures (HTTP 401/403 or close 4003) wait for explicit repair. Existing connection
  watchdog and credential/TLS owners remain authoritative.
- UI has no loss grace, recovery delay, polling or status timers. Current default-route loss shows
  `Нет подключения` immediately; stale old-route loss is ignored. Working RPC overrides unvalidated
  Android internet evidence, preserving VPN/private-network operation. `VALIDATED` alone establishes
  neither CodeWide reachability nor service failure: actual transport/backoff/upstream facts do.
- History repair waits for one second of continuous RPC usability; further raw state/OS callbacks
  do not restart its timer. Real loss cancels that pending repair and supersedes old reads; the next
  recovery schedules one repair. This does not delay incoming journal projection or RPC admission.
- Raw readiness is never delayed. Cached rows/history and a completed empty query stay visible;
  unresolved loading and actual query errors retain their own states. Server/folder text stays
  stable with shimmer while reconnecting; actual errors remain visible without a new history status.

## Global Voice and microphone

1. An explicit successful activation retains its supervisor thread, logical microphone lease and
   foreground lifetime across replacement transports. Initial activation failure remains an error,
   removes its readiness subscription and cannot be resurrected by later network callbacks.
2. Loss of bound-home RPC stops the current transport and parks recovery without opening peers.
   Local capture is closed before remote stop, delivery drain or subscription cleanup waits.
3. WebRTC-only `disconnected` immediately gates capture and remote tracks but retains that peer for
   three seconds. A connected peer may resume during this grace; failed/closed/expired grace replaces
   it. Native capture-stall detection still enters the same terminal/replacement path.
4. Replacement starts use full-jitter exponential delays with the same 0.5–30 second ceilings, only
   while bound-home RPC is ready. Offline waiting has no retry timer, deadline or attempt limit.
   Failed service/media starts keep retrying at that bounded rate; ten stable connected seconds
   reset backoff. Neither a minute-long outage nor repeated short-lived replacements disables
   hands-free mode. The retained subscription wakes recovery when the bound connection is ready.
5. Offer creation starts with capture closed. Capture opens only after accepted SDP, connected media
   and completed realtime startup, subject to the latest explicit Mute intent. Mute survives retries.
   Disconnect/Stop releases local tracks; no application PCM queue or offline transcript is created.
   Speech during the gap is lost and must be repeated. Already-sent remote speech/actions cannot be
   retracted; WebRTC may contain its ordinary bounded transport/jitter buffers.
6. Stop cancels waits, startup and late-result installation; late callbacks cannot reopen the mic.
   Pause for dictation/biometric privacy intentionally closes the transport and recovery episode;
   resume uses the existing logical activation only if Stop has not revoked it.
7. Realtime start/stop/append and interrupt are live-only: offline or failed send rejects immediately,
   never entering the generic deferred-RPC queue. Ordinary resource reads retain that queue. A
   failed cleanup of an obtained transport stops automatic replacement rather than racing another
   start. Already-dispatched RPCs have no server cancellation token; startup remote cleanup remains
   best-effort and this change is not a claim of cross-server exactly-once execution.
8. Successful replacement sends a short recovery acknowledgement through the live agent before
   releasing queued worker attention. A disconnected peer that reconnects within its ICE grace
   also requests an acknowledgement, once for that recovery edge. Repeated `connected` callbacks
   and failed connection attempts do not each send a greeting. Initial activation keeps its normal
   greeting; dictation/privacy resume alone is not a network recovery. Explicit microphone Mute
   remains independent from hearing the agent's recovery acknowledgement.
9. The instruction asks for one short sentence in the user's language, such as "Я снова на связи",
   at a natural pause, without restarting the conversation, repeating actions or claiming to have
   heard gap speech. Duplicate in-flight requests coalesce and Stop cancels undispatched notices.
   A live append acknowledgement proves request acceptance, not audible delivery or exact wording;
   a lost acknowledgement can have an ambiguous remote outcome. There is no new replay/outbox.

Automatic recovery still belongs to the current process/JS owner. A stalled JS runtime, process
death and OEM power restrictions remain device risks; this does not add silent activation after
process restart. Authorization loss, deleted/disabled home and unsafe session/cleanup ambiguity
remain terminal, unlike ordinary network interruption. The foreground lifetime and existing CPU
wake-lock policy remain active while waiting, so long outages can cost battery; device measurement
is required before changing that lifecycle independently of hands-free recovery.
Native notification/capture admission avoids presenting intentional pause as a stuck microphone.

## UX copy

| Evidence/state | Message |
| --- | --- |
| No default route / blocked / unvalidated path with no working service | `Нет подключения` |
| Working RPC despite unvalidated Android path | `Live` |
| Route available, transport connecting, no failure evidence | Existing reconnecting presentation |
| Transport backoff on validated route, or connected Companion reports upstream reconnecting | `Server unavailable` (not proof of global internet failure) |
| Auth / real projection error | `Access required` / `Connection error`; preserve the owning error |
| Native voice pause | `Connecting voice. Microphone paused; offline speech is not sent.` |
| Explicit Mute | `Voice session active. Microphone off.` |
| Recovered voice | One short spoken acknowledgement, e.g. `Я снова на связи`, in the user's language |

## Blast radius and verification boundary

Current regression-fix files (other preexisting dirty changes are preserved):

- `src/data/thread-cursor-sync.ts`: v3/v4 validated response adapter.
- `src/data/thread-sync-reconnect.ts`, `workspace-runtime.ts`: lifecycle-owned coalesced recovery.
- `src/data/thread-chat-model.ts`, `thread-sync-runtime.ts`: authoritative error clearance.
- `src/data/connectionHealth.ts`, `connection-state-model.ts`,
  `src/features/connections/connectionPresentation.ts`: immediate minimal presentation.
- Native `CodexConnectionService.kt`, `TransportRouteRecovery.kt`: route-generation replacement.
- Regressions: `thread-cursor-sync.test.ts`, `thread-chat-model.test.ts`,
  `connection-health.test.ts`, `v1-connection-health.render.test.tsx`,
  `v1-network-delivery.render.test.tsx`, native `TransportRouteDeliveryTest.kt`.
  The brittle reconnect-call regex in `native-app-contracts/review.contract.ts` moved to the
  executable delivery regression, which checks the actual forced-read arguments and counts.

Changes are Android-local: native route/socket/protocol handling, transient connection projections,
Global Voice media/recovery and their presentation. No shared sync protocol/schema, Companion/Relay,
durable outbox, hidden-thread identity, microphone arbitration or dictation upload contract changes.
Other dirty work in settings/model/personality, icons, conversation rendering and performance is
outside this change. Native additions require an APK, not an OTA-only rollout.

Automated coverage exercises stale route callbacks, validation versus reachability, backoff reset,
immediate raw RPC invalidation and event-driven display, offline live-control rejection/no replay,
peer grace, capture/remote-track gating, explicit Mute, day-long offline waiting, bounded retries
beyond a minute, repeated independent outages, cleanup failure, cancellation during startup/mute
correction, late native leases, and Stop/pause/resume. Recovery-notice tests cover replacement and
same-peer recovery, duplicate callbacks, initial greeting versus recovery, dictation resume, worker
attention ordering and late delivery after Stop. Android V1 validation and bundle compilation are
required gates.

Delivery regressions cover both route-callback orders with an open socket, 100 repeated capability
changes, pending incoming frames across replacement and replay deduplication, interrupted versus
accepted outgoing RPCs, and native durable ACK. The JS/SQL/React regression covers v3 repair,
projection ACK withheld until publication, incoming delta and reopening. It also covers 50
capability/projection-state changes without invalidation, a superseded read after real loss, and
one coalesced repair at 1000 ms (none at 999 ms) following repeated loss/recovery.

These are complementary native and JS seam tests, not a physical-device end-to-end test. Uploaded
0.2.213 telemetry confirms native ingress and successful RPCs during sampled intervals; it does
not prove that the corresponding chat rendered or identify every reported interruption.

### Release verification, September 27

- `pnpm validate:android:v1`: PASS, 441 V1 + 153 shared React tests, all three typechecks,
  formatting, hygiene without baseline changes, dead-code and dependency gates.
- `pnpm --filter @codewide/android compile:android`: PASS.
- `sh scripts/android-gradle.sh :app:testDebugUnitTest --tests 'dev.codewide.app.remote.*Test' --console plain -q`:
  PASS, 181 tests in 51 suites, no skips/failures/errors.
- `./scripts/release-apk`: PASS after replacing one implementation-text assertion with the
  executable equivalent. The runner repeated Android gates, then 2021 Vitest tests, 5 OTA tests,
  secret scanning, release native compilation/lint/R8, signature and artifact scanning.
- Public APK download was fetched by the runner and its SHA-256 matched the built artifact.

Released APK: `0.2.214 (227)`, runtime `0.2.214-native-227`, arm64-v8a, 97,766,403 bytes.
SHA-256: `5c203a5891ec8c0677fa6bfad5119fd7bc18f8351ca7392f6bb26aa739e2d976`.
[Download the verified APK](https://codex.garin.dev/download/5c203a5891ec8c0677fa/CodeWide-0.2.214-release-5c203a58.apk).
The release runner alone changed Android version metadata. No commits, pushes, Companion deployment,
OTA publication or device installation were performed.

Next cheapest device experiment (not executed): use one explicitly approved debug APK and one phone,
start Voice, speak before and during a 90-second airplane-mode gap, restore the route, then Stop
during a second gap. Correlate content-free route epoch, socket/RPC state, peer state and native
capture admission. Require no capture during the detected outage, no replay of gap speech, exactly
one replacement, a brief audible recovery acknowledgement, preserved thread/Mute intent, and no
resurrection after Stop. If this passes, add 1/5/10-second and ten-minute gaps, six independent
flaps, Wi-Fi/cellular/VPN handoff, service-only failure, ICE-only
failure, locked-screen/Doze and dictation handoff. Compare against the unchanged build on the same
phone before claiming that the reported user symptom is fixed.
