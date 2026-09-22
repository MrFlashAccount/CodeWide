# V1 global-supervisor feature ownership

Status: **implemented source contract; physical-device WebRTC proof is pending**.

## Purpose and public surface

This folder owns the V1 Global Voice Mode interaction contract. A process-lifetime `GlobalVoiceActivation` talks to one durable supervisor App Server thread on a selected home `connectionId`. The App Server owns transcript/history; this feature owns only activation state, transient active transcript/activity projection, user actions and typed recovery.

The feature exports only:

- its composition factory;
- one stable model-owned render resource;
- one `toggle` action for the app-level control plus internal `enter`, `start`, `stop` and typed recovery actions, all shaped as `() => void | Promise<void>`.

Every cross-chat target is a validated `QualifiedChatRef` containing both `connectionId` and `threadId`. The hidden thread retains the ordinary App Server Codex capability set: built-in tools, skills, MCP servers, plugins and the normal approval policy available on its home Companion. CodeWide adds six supervisor-specific dynamic tools—`createChat`, `listChats`, `readChat`, `followChat`, `sendText` and `unfollowChat`—without replacing that standard toolset. Those tools never accept a bare thread id, infer authority from current navigation or export arbitrary RPC/native access.

The hidden thread is a control plane rather than the default execution workspace. It may complete brief actions directly, but proactively delegates long-running, multi-step, noisy, specialized or parallelizable work into separate visible top-level chats, coordinates follow-ups and retains only concise progress and results in the supervisor context. It prefers an already relevant CodeWide chat when one exists. Ordinary subagents remain appropriate only for bounded internal detail; the durable supervisor/worker relation is not a subagent runtime relation.

The device-wide Voice Assistant personality is a settings/data contract, not feature state. The runtime reads one bounded character/communication-style/rules snapshot for each explicit activation and adds it to `realtimeStartInstructions`; hidden-thread creation uses the same instruction composer. Synthesized voice selection remains an independent audio contract. Neither setting is cached in `GlobalVoiceActivation`, and changing either one affects the next activation rather than mutating an active realtime session.

## Internal owners

| Owner                               | Responsibility                                                                                                    | Excluded responsibility                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| feature model                       | binding/capability/activation discriminated state, stable render resource, action settlement and recovery mapping | persistence, RPC, native calls, connection discovery         |
| `WorkspaceRouteComposition` adapter | select the active toggle projection and bind the stable app-level action                                          | model construction, transport subscription, route navigation |
| `GlobalVoiceEntryAction`            | render the selected orb start/stop control and durable attention count in the persistent thread-list header       | activation policy, transport, recovery                       |
| feature capability adapters         | convert between feature contracts and injected lower ports                                                        | owning lower session/database/delivery/media state machines  |

There is no Global Voice route or dedicated screen. The persistent thread-list header contains the foreground start/stop interaction. On Android, an explicit start first requests the app-specific system-overlay grant. A granted activation exposes the selected Nebula or Particles renderer in a draggable `TYPE_APPLICATION_OVERLAY` window, so the companion remains reachable while CodeWide is backgrounded. A tap opens circular native Stop and More icon controls. Drag follows the pointer through bounded overscroll inside current inset-safe bounds; release inside a narrow edge zone continues the gesture velocity into a spring snap, release outside safe bounds springs back, and release elsewhere persists a normalized free position. Rotation and inset changes restore that normalized placement into the new safe bounds. Revoking or withholding the separate overlay grant never changes microphone foreground-service ownership or the media cleanup contract. The underlying model distinguishes unbound, activating, creating, ready, starting, listening, reconnecting, thinking, speaking, tool activity, stopping and failed states. Recovery actions remain mutually exclusive and typed; the toggle applies the current recovery before retrying activation. Expected capability, home and media failures use fixed copy in the application notice surface and never replace the workspace with the global crash-recovery UI.

The transient transcript region shows only live user/supervisor text from the active realtime resource. It is not an App Server history mirror. Activity and target regions expose bounded status and a qualified source/target identity without raw tool arguments, results or target content. The nearest activation owns action pending and duplicate suppression until the returned Promise settles and surfaces rejection.

## State and lifetime

`GlobalVoiceActivation` has one process-lifetime state machine: idle, starting, active, stopping or failed. The active variant contains one activation id, exact qualified home, live home-session generation, realtime-session identity and native audio lease. It contains no durable transcript or tool-result history.

Entering is explicit, and ordinary navigation or app backgrounding does not end the activation. When biometric app lock closes, its security lifecycle pauses the transport while retaining the same logical activation and resumes it only after successful foreground authentication. One logical activation owns at most one device WebRTC peer plus one Android microphone foreground-service token. A transport terminal caused by a route change is non-terminal for that activation: the transport owner publishes reconnecting, closes the old peer/channel, applies one bounded backoff policy and recreates transport against the same qualified supervisor thread. It never retains unbounded audio or command queues. Policy exhaustion publishes a recoverable failure. Explicit Stop remains terminal, cancels waits and replacements, then releases the foreground and logical microphone leases. Unrecoverable protocol/session ambiguity still converges on the same bounded cleanup.

Interactive Android WebRTC does not acquire global communication-audio mode or force a communication device. The system-selected media output remains authoritative before, during and after Global Voice, including wired, USB, Bluetooth and BLE routes. The native ADM explicitly uses voice-communication capture, media speech playback attributes and its hardware AEC/NS policy; this scopes processing to ADM without taking over the device-wide route. Raw V1 PCM capture separately owns Android session effects, including supported AEC on its exact `audioSessionId`; no software echo canceller is layered on either path. V2 `VOICE_RECOGNITION` capture has a separate non-full-duplex lifecycle and remains unchanged.

The foreground service owns the orb's two independent audio envelopes for the exact lifetime of an interactive Global Voice overlay. The ADM samples callback reduces microphone PCM synchronously to a bounded input level and discards the frame, so listening remains responsive while the Activity is backgrounded without another capture or wake lock. The same callback advances a content-free native capture-health timestamp. When the explicit personal-voice experiment is enabled, the callback also feeds a bounded rolling window to a background spectral matcher. The WebRTC microphone track opens optimistically as soon as the local VAD sees a new voice segment, then the matcher either admits that segment or closes it after a bounded confirmation window. A rejected continuous source stays closed until silence resets the segment, while a later profile match over the 120-160 ms rolling window may reopen it. This removes the previous 800-1000 ms admission delay. A clean new segment can still lose the local VAD and bridge scheduling prefix, and speech beginning over a continuous rejected source can lose the short match window; the tradeoff is that a rejected speaker can send a brief prefix before confirmation. Disabling the track does not stop local AudioRecord capture. Only the embedding is persisted, raw enrollment and rolling PCM are discarded, and the filter is scoped to Global Voice rather than the shared ADM contract. While an unmuted listening/thinking/speaking phase expects capture, a bounded sample gap changes the native overlay to connecting and terminates only the current WebRTC transport; the existing reconnect owner retains the activation, supervisor thread, foreground token and logical microphone lease. Android screen on/off, ADM start/stop/error, sample age, peer connection state and outbound RTP byte/packet counters are logged without PCM or transcript text. A transient WebRTC `disconnected` state receives a grace period; sustained disconnection enters the same reconnect path. The existing peer stats poll reads only inbound remote-audio level and forwards it as playback level. `listening` selects input, explicit `thinking` ignores both levels and runs its autonomous motion, and `speaking` selects playback; real playback onset publishes the semantic speaking phase.

The Android overlay has a separate native presentation projection for the same live WebRTC peer.
`VoiceCaptureForegroundService` owns `GlobalVoiceWebRtcObserver`; a narrow RN WebRTC patch
observes the existing peer's events and stats without replacing its JS observer. Native VAD,
response/output-buffer edges and inbound audio stats continue with a stopped Activity and without
JS timer execution. The JS stats callback remains the feature speech/delivery projection; its
legacy playback bridge cannot overwrite the native envelope while a peer is observed.

The native arbiter gates ordinary presentation behind connection health and explicit Stop/error.
Within a connected session, confirmed user VAD selects listening and the ADM input envelope,
then actual output playback selects speaking, then a pending response or home activity selects
thinking. Barge-in clears the previous playback hold; samples during user speech do not rearm
that hold. A newly observed output-buffer start or subsequent audio can establish playback again.
Response completion alone does not mean output audio has drained. Native connection recovery
opens a connecting gate; error/Stop requires a new peer owner. Muting clears user VAD without
suppressing assistant playback. Removing the peer observer fences queued events and in-flight
stats before the async media cleanup; the last foreground lease also closes observation.

Backdrop geometry belongs to each renderer: Nebula uses its shader disc radius; Particles uses
the outermost projected dot including its radius. The backdrop adds 3dp and follows with a
180ms time constant (static/reduced-motion snapshots snap). Its drawing may extend beyond the
66dp child, while the 76dp overlay window and gesture geometry remain unchanged. The independent
handoff transform scales both visuals together.

Existing dictation and Global Voice Mode share one neutral, generation-fenced V1 microphone arbiter below both consumers. Its explicit states are idle, assistant-owned, handoff-to-dictation, dictation-owned and handoff-back. Dictation may suspend the active assistant transport, but it does not release the logical activation, supervisor thread, foreground overlay or context. The arbiter grants the dictation token only after the assistant transport has stopped; finishing, cancelling or failing dictation starts the reverse handoff and recreates transport on the same activation/thread. A second input remains busy, repeated acquisition of the same pending input is deduplicated, and exact-token release prevents a stale completion from stopping a newer capture. Explicit assistant Stop removes the suspended resume right, so later dictation cleanup cannot resurrect it. The feature and dictation controller meet only through this narrow injected contract; neither imports the other.

Worker relations and replay tombstones exist independently of voice activation, but notification delivery does not. The attention owner serializes an explicit activation boundary: events observed while Global Voice is off are stored acknowledged, enabling first acknowledges any legacy backlog, and disabling acknowledges the remaining live queue before transport cleanup. Only events admitted after enable and before disable can reach the active session. Stable ids and persisted acknowledgements deduplicate replay; concurrent active-session events remain separate and ordered. The feature observes only the active pending count. An active voice session receives one event only while speech is idle and waits for the resulting assistant utterance before admitting the next. Full chat content remains behind explicit `readChat`; there is no polling or inactive transcript mirror. Supervisor-specific tool calls are admitted only through the active runtime gate; Stop closes that gate before cleanup awaits in-flight work.

## Allowed dependencies

- Route composition may import the feature public surface and inject already-created capabilities.
- Feature code may depend on narrow project contracts for binding, visibility, live home session, realtime, system-tool routing, catalog/history, durable delivery, event observation and native media.
- The feature may use existing CodeWide `View`, `Pressable`, `ActivityIndicator`, `AppText`, header/back/action primitives, theme spacing/colors and safe-area/layout owners.
- Escaping event handlers use `useEvent`; render-local helpers remain ordinary functions.
- The app-level toggle derives presentation and the seven-state orb contract from the same stable model-owned resource. Startup and cleanup show disabled progress; the selected orb remains the stable identity and only a live activation offers Stop. Navigation and ordinary app-state effects do not own activation lifetime; biometric lock owns only the reversible privacy suspension.

## Forbidden dependencies and moves

- No import of raw native modules, SQLite implementations, transport implementations, Expo Router, `apps/android/src/v2/**`, `@codewide/sync-client/v2`, V2 storage or another feature's private internals.
- No second transcript/history authority, pending-request database, delivery outbox/result store, connection cache, generic event bus, general dynamic-tool framework or disposable voice-only conversation object.
- No direct provider socket, fallback supervisor thread, lock-screen start/recovery, wake word, notification controls or separate voice-only approval system. Background continuation after an explicit foreground start is allowed. Standard Codex actions and approval requests keep their existing App Server and user-interaction owners.
- No title/content heuristic for the hidden thread. Binding/visibility logic stays in lower data owners and consumes the exact durable binding.
- No server projection or pending/delivery state mirrored into component-local state; no optimistic server item.
- No `useCallback`, `useMemo`, effect-triggered loading, floating action Promise, product-local copy of `GlobalSupervisorLimitsV1`, general clone or broad lint/type suppression.

## Lower contracts consumed

The feature treats every binding row, App Server response/event/request and native callback as external input. Lower adapters validate and convert them before they enter feature state. `crates/companion-core/contract/v1.json` is the only machine-readable owner of the 17-field `globalSupervisorLimitsV1`; this feature consumes generated/shared TypeScript/Kotlin values and does not restate them.

The realtime control adapter is live-only and channel/thread/sequence fenced. SDP, transcript and lifecycle notifications bypass Companion replay and Android `NativeFrameStore`; microphone and generated speech stay on WebRTC media tracks and never enter Companion JSON. The feature cannot request catch-up or replay. Pending requests arrive as a closed classification: five existing approval/input methods remain `userInteraction`, and only `item/tool/call` is `systemDynamicTool`. The feature receives only bound-home system requests from the purpose-specific router and never reads the approval database.

`listChats` and `readChat` consume authoritative catalog/history adapters, apply the exact supervisor visibility policy and return bounded semantic pages with opaque continuation. `createChat` creates an ordinary visible top-level chat after persisting its creation relation; `followChat`, `sendText` and `unfollowChat` maintain the durable relation explicitly. `sendText` uses the separately named caller-idempotent entry on the existing durable command-delivery owner, then the existing durable server-response path. Reconnect/restart recovery must reuse the same content-free request-derived command identities.

## App-level composition

Global Voice has no Expo Router destination. `WorkspaceRouteComposition` obtains the already-created contract from `createWorkspaceFeatures`, derives the toggle presentation state and passes one stable control into both responsive thread-list headers. Navigation, Back, route unmount and ordinary app backgrounding do not stop an activation. Biometric lock may pause and resume its transport without ending it. Only the same active toggle, a terminal failure or runtime teardown may stop it.

The bound thread remains excluded from ordinary catalog/search/project/count/default-selection surfaces by Companion. The explicitly requested fifth overlay action publishes the current qualified home to Android and opens its ordinary conversation route for inspection. It does not change catalog membership or create a separate transcript authority. An incomplete home or stopping activation clears the shortcut; home replacement updates it. Other App Server clients may still display the thread.

## Required verification

- Model tests cover every binding/capability/activation and recovery variant, duplicate suppression, stale home generation and every terminal cleanup path.
- Model and render tests cover toggle start/stop, automatic initial binding recovery, active accessibility state, absence of a Global Voice route and navigation-independent lifetime.
- Integration tests prove exact hidden-thread exclusion, qualified targets, bounded list/read pages, malformed/unknown tool failure, disconnect/restart replay safety and exactly one target send/response.
- Request-class tests prove `item/tool/call` reaches only the system router while all five existing user methods reach only the unchanged request database/UI and both disappear on resolution.
- Realtime tests prove channel/thread/sequence fencing, overflow/timeout teardown and zero transcript/audio/realtime bytes in Companion replay, `IndexStore`, `NativeFrameStore`, checkpoints and inactive delivery.
- Lease/runtime tests prove the complete assistant-to-dictation-to-assistant handoff, no overlapping capture, duplicate suppression, permission/start failure recovery, Stop during handoff and stale-token fencing. Physical-device evidence covers WebRTC offer/answer negotiation, permission denial, headset/Bluetooth change, interruption, background continuation and composer/review-input dictation parity.
- Reconnect tests use VPN route replacement as the primary regression: the logical activation, supervisor thread and foreground overlay survive, transitions show reconnecting, only one transport exists and Stop cancels pending retries. Network handoff, repeated flaps and policy exhaustion are covered separately.
- Lock lifecycle tests prove foreground -> screen-off -> foreground capture remains healthy while ADM samples continue, a real sample stall produces one reconnect signal, fresh samples recover native health, and muted/connecting/released lifetimes cannot create a second transport. Physical lock/Doze behavior remains a required device check because OEM power policy cannot be established by source tests.
- Overlay tests prove permission routing, Global Voice-only token ownership, free placement, velocity-preserving animated snap, tap/drag separation, normalized rotation/inset restore, native Stop routing, separate input/playback sources, explicit listening -> thinking -> speaking mapping, malformed WebRTC stats rejection, bounded PCM energy and attack/release smoothing. Physical-device evidence additionally covers overlay grant/revocation, gestures, controls, background input response, assistant playback response and representative OEM background restrictions.
- The disposable-thread proof covers exact dynamic tools, resume after restart, live voice probe, V3 WebRTC audio, transcript/interruption/stop/close/reconnect and readable ordinary history afterward.
- Run focused owner tests and `pnpm validate:android:v1`; do not update the hygiene baseline or bypass a failed gate.

Publishing is not part of this feature implementation contract. V2 is unchanged.
