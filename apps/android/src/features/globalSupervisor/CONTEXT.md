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

| Owner                                 | Responsibility                                                                                                    | Excluded responsibility                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| feature model                         | binding/capability/activation discriminated state, stable render resource, action settlement and recovery mapping | persistence, RPC, native calls, connection discovery         |
| `V1WorkspaceRouteComposition` adapter | select the active toggle projection and bind the stable app-level action                                          | model construction, transport subscription, route navigation |
| `GlobalVoiceEntryAction`              | render the selected orb start/stop control and durable attention count in the persistent thread-list header       | activation policy, transport, recovery                       |
| feature capability adapters           | convert between feature contracts and injected lower ports                                                        | owning lower session/database/delivery/media state machines  |

There is no Global Voice route or dedicated screen. The persistent thread-list header contains the foreground start/stop interaction. On Android, an explicit start first requests the app-specific system-overlay grant. A granted activation exposes the selected Nebula or Particles renderer in a draggable `TYPE_APPLICATION_OVERLAY` window, so the companion remains reachable while CodeWide is backgrounded. A tap opens circular native Stop and More icon controls. Drag follows the pointer through bounded overscroll inside current inset-safe bounds; release inside a narrow edge zone continues the gesture velocity into a spring snap, release outside safe bounds springs back, and release elsewhere persists a normalized free position. Rotation and inset changes restore that normalized placement into the new safe bounds. Revoking or withholding the separate overlay grant never changes microphone foreground-service ownership or the media cleanup contract. The underlying model distinguishes unbound, activating, creating, ready, starting, listening, reconnecting, thinking, speaking, tool activity, stopping and failed states. Recovery actions remain mutually exclusive and typed; the toggle applies the current recovery before retrying activation. Expected capability, home and media failures use fixed copy in the application notice surface and never replace the workspace with the global crash-recovery UI.

The transient transcript region shows only live user/supervisor text from the active realtime resource. It is not an App Server history mirror. Activity and target regions expose bounded status and a qualified source/target identity without raw tool arguments, results or target content. The nearest activation owns action pending and duplicate suppression until the returned Promise settles and surfaces rejection.

## State and lifetime

`GlobalVoiceActivation` has one process-lifetime state machine: idle, starting, active, stopping or failed. The active variant contains one activation id, exact qualified home, live home-session generation, realtime-session identity and native audio lease. It contains no durable transcript or tool-result history.

Entering is explicit, and ordinary navigation or app backgrounding does not end the activation. When biometric app lock closes, its security lifecycle pauses the transport while retaining the same logical activation and resumes it only after successful foreground authentication. One logical activation owns at most one device WebRTC peer plus one Android microphone foreground-service token. A transport terminal caused by a route change is non-terminal for that activation: the transport owner publishes reconnecting, closes the old peer/channel, applies one bounded backoff policy and recreates transport against the same qualified supervisor thread. It never retains unbounded audio or command queues. Policy exhaustion publishes a recoverable failure. Explicit Stop remains terminal, cancels waits and replacements, then releases the foreground and logical microphone leases. Unrecoverable protocol/session ambiguity still converges on the same bounded cleanup.

Each interactive Android WebRTC peer also owns one scoped communication-audio lease acquired before peer creation and released on stop, startup failure or context cancellation. The native ADM explicitly uses voice-communication capture, speech communication playback attributes and its hardware AEC/NS policy. Preview peers do not acquire that lease. With no external route, the lease selects the built-in speaker instead of Android's default communication earpiece and restores the previous device on release. Wired, USB, Bluetooth and BLE communication devices remain system-owned: their availability clears the scoped speaker request, while their removal reapplies the built-in-speaker default. Raw V1 PCM capture separately owns Android session effects, including supported AEC on its exact `audioSessionId`; no software echo canceller is layered on either path. V2 `VOICE_RECOGNITION` capture has a separate non-full-duplex lifecycle and remains unchanged.

The foreground orb level is sampled from the interactive WebRTC microphone track stats and forwarded through the foreground lease. This visual sampling does not own or retain audio frames and does not affect media transport lifecycle.

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

The feature treats every binding row, App Server response/event/request and native callback as external input. Lower adapters validate and convert them before they enter feature state. `apps/companion/contract/v1.json` is the only machine-readable owner of the 17-field `globalSupervisorLimitsV1`; this feature consumes generated/shared TypeScript/Kotlin values and does not restate them.

The realtime control adapter is live-only and channel/thread/sequence fenced. SDP, transcript and lifecycle notifications bypass Companion replay and Android `NativeFrameStore`; microphone and generated speech stay on WebRTC media tracks and never enter Companion JSON. The feature cannot request catch-up or replay. Pending requests arrive as a closed classification: five existing approval/input methods remain `userInteraction`, and only `item/tool/call` is `systemDynamicTool`. The feature receives only bound-home system requests from the purpose-specific router and never reads the approval database.

`listChats` and `readChat` consume authoritative catalog/history adapters, apply the exact supervisor visibility policy and return bounded semantic pages with opaque continuation. `createChat` creates an ordinary visible top-level chat after persisting its creation relation; `followChat`, `sendText` and `unfollowChat` maintain the durable relation explicitly. `sendText` uses the separately named caller-idempotent entry on the existing durable command-delivery owner, then the existing durable server-response path. Reconnect/restart recovery must reuse the same content-free request-derived command identities.

## App-level composition

Global Voice has no Expo Router destination. `V1WorkspaceRouteComposition` obtains the already-created contract from `createWorkspaceFeatures`, derives the toggle presentation state and passes one stable control into both responsive thread-list headers. Navigation, Back, route unmount and ordinary app backgrounding do not stop an activation. Biometric lock may pause and resume its transport without ending it. Only the same active toggle, a terminal failure or runtime teardown may stop it.

The bound thread is never exposed as an ordinary CodeWide conversation route. Exact lower visibility and route-admission policy excludes it from active, archived, search, project, aggregate-count, default-selection and direct-route surfaces. Other App Server clients may still display it.

## Required verification

- Model tests cover every binding/capability/activation and recovery variant, duplicate suppression, stale home generation and every terminal cleanup path.
- Model and render tests cover toggle start/stop, automatic initial binding recovery, active accessibility state, absence of a Global Voice route and navigation-independent lifetime.
- Integration tests prove exact hidden-thread exclusion, qualified targets, bounded list/read pages, malformed/unknown tool failure, disconnect/restart replay safety and exactly one target send/response.
- Request-class tests prove `item/tool/call` reaches only the system router while all five existing user methods reach only the unchanged request database/UI and both disappear on resolution.
- Realtime tests prove channel/thread/sequence fencing, overflow/timeout teardown and zero transcript/audio/realtime bytes in Companion replay, `IndexStore`, `NativeFrameStore`, checkpoints and inactive delivery.
- Lease/runtime tests prove the complete assistant-to-dictation-to-assistant handoff, no overlapping capture, duplicate suppression, permission/start failure recovery, Stop during handoff and stale-token fencing. Physical-device evidence covers WebRTC offer/answer negotiation, permission denial, headset/Bluetooth change, interruption, background continuation and composer/review-input dictation parity.
- Reconnect tests use VPN route replacement as the primary regression: the logical activation, supervisor thread and foreground overlay survive, transitions show reconnecting, only one transport exists and Stop cancels pending retries. Network handoff, repeated flaps and policy exhaustion are covered separately.
- Overlay tests prove permission routing, Global Voice-only token ownership, free placement, velocity-preserving animated snap, tap/drag separation, normalized rotation/inset restore, native Stop routing, malformed WebRTC stats rejection, bounded microphone energy and attack/release smoothing. Physical-device evidence additionally covers overlay grant/revocation, gestures, controls, background rendering and representative OEM background restrictions.
- The disposable-thread proof covers exact dynamic tools, resume after restart, live voice probe, V3 WebRTC audio, transcript/interruption/stop/close/reconnect and readable ordinary history afterward.
- Run focused owner tests and `pnpm validate:android:v1`; do not update the hygiene baseline or bypass a failed gate.

Publishing is not part of this feature implementation contract. V2 is unchanged.
