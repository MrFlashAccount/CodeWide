# Chat engineering checklist

This is the executable engineering contract for CodeWide V1. It covers the
protocol, local cache, streaming reducer, timeline, rich rendering, Android
lifecycle, accessibility, performance, and release tests. The UX rules that are
visible to users remain in `chat-ux-guidelines.md`.

`MUST` blocks a V1 release. `SHOULD` can ship only with an explicit issue and a
measured reason. Performance numbers below are product targets, not universal
platform guarantees.

## 1. Event and state model

- [ ] **MUST** use a versioned event envelope with a stable connection id,
  thread id, event type, monotonically increasing cursor, and stable
  turn/item/request ids.
- [ ] **MUST** sync as `local snapshot -> cursor resume -> ordered deltas`.
  When a cursor is outside the replay window, replace from a fresh snapshot.
- [ ] **MUST** reject a gap, malformed cursor, oversized event backlog, or
  incompatible protocol version. Never silently continue with partial state.
- [ ] **MUST** make event application idempotent. Duplicate events at or behind
  the committed cursor are no-ops.
- [ ] **MUST** persist an event batch and its cursor atomically. A cursor cannot
  advance before the corresponding state is durable.
- [ ] **MUST** reconcile terminal `item/completed` and `turn/completed` payloads
  over streamed projections. Terminal payloads are authoritative and flush the
  visible pending state immediately.
- [ ] **MUST** attach provenance to usage, model, effort, permissions, and cost.
  A current composer selection is not evidence of what ran a historical turn;
  omit unknown values instead of estimating from unrelated state.
- [ ] **MUST** tolerate unknown notification and item types without crashing.
  Unknown items remain inspectable and offer a recovery action.
- [ ] **SHOULD** preserve the raw versioned payload beside normalized data until
  the renderer/protocol version that consumed it is known.

Acceptance tests:

- replay the same window twice; state and unread counts do not change;
- reorder or remove one event; the client closes/re-snapshots instead of
  applying later events;
- disconnect after the server accepted a send but before the response; the
  client reconciles by `clientMessageId` and never duplicates the turn;
- inject an unknown event and unknown item; the thread remains usable.

## 2. Streaming pipeline

The hot path is deliberately split:

`socket -> bounded ingress -> ordered reducer -> 16-50 ms UI batch -> row`

- [ ] **MUST** keep ingress and persistence queues bounded by both count and
  bytes. Overflow is a visible recoverable transport failure, never data loss.
- [ ] **MUST** preserve order for text deltas, tool output, transcript chunks,
  terminal events, and cursor acknowledgements.
- [ ] **MUST NOT** set React state for every token or PCM chunk. Coalesce normal
  deltas to at most one visible update per 16-50 ms.
- [ ] **MUST** bypass normal batching for approval requests, errors, and terminal
  state so controls never appear stale.
- [ ] **MUST** render an in-progress answer as selectable plain text. Parse the
  complete rich document after completion; optional intermediate rich parsing
  must be throttled and measured.
- [ ] **MUST** keep completed turn objects referentially stable when unrelated
  live events arrive. Clone only the addressed turn/item.
- [ ] **MUST** expose backpressure. Audio or text cannot be silently dropped
  merely because the network is slow.
- [ ] **SHOULD** track queue count, queue bytes, oldest event age, reducer time,
  and delta-to-visible latency without logging message content.

Acceptance tests:

- replay duplicate, reordered, delayed, and bursty deltas deterministically;
- stream into a 1,000-turn thread and assert completed rows do not rerender;
- inject a slow persistence layer and prove the ingress bound closes the stream;
- inject a slow audio RPC and prove chunks are either delivered in order or a
  visible overflow error stops recording; no silent drop is allowed.

## 3. Local-first reads, sending, and reconnect

- [ ] **MUST** treat the encrypted/local database as the UI source of truth.
  Opening a cached thread does not wait for the network.
- [ ] **MUST** persist drafts, attachments, composer options, expansion state,
  and warm scroll position per `connection/thread` identity.
- [ ] **MUST** enqueue sends durably before network dispatch. Every send has a
  client-generated id and one of `queued`, `pending`, `uncertain`, or `failed`.
- [ ] **MUST** distinguish a definite rejection from an ambiguous lost response.
  An uncertain send is reconciled against authoritative thread state before
  retrying.
- [ ] **MUST** preserve FIFO within a thread. `queue`, `steer`, `fork`, and a new
  turn are distinct commands rather than UI-only labels.
- [ ] **MUST** reconnect after sleep, network change, process recreation, and
  tunnel interruption using the last durable cursor.
- [ ] **MUST** stop automatic retry on authorization failure until credentials
  are refreshed or the user acts.
- [ ] **SHOULD** use exponential backoff with jitter and reset it only after a
  successful handshake/catch-up, not merely after a TCP open.
- [ ] **SHOULD** use connectivity as a wake-up hint, not as proof that the remote
  endpoint is reachable.

Acceptance tests:

- cold process start in airplane mode opens cached threads and drafts;
- process death after enqueue but before send preserves the command;
- sleep/wake and Wi-Fi/mobile handoff resume from the cursor without a full
  30-second polling delay;
- expired/revoked credentials stop the loop and show an actionable auth state.

## 4. Timeline and viewport

- [ ] **MUST** key rows by stable server/thread/turn identities, never by array
  index.
- [ ] **MUST** keep expansion state outside recycled rows. A recycled row cannot
  inherit another row's local state.
- [ ] **MUST** start a first open at the bottom (`distanceFromBottom = 0`). A
  warm reopen restores the saved distance from bottom.
- [ ] **MUST** enter reading mode immediately on a user drag. New content cannot
  move the viewport while reading.
- [ ] **MUST** follow appended content only while already following the bottom.
  The jump-to-latest control is the sole override while reading.
- [ ] **MUST** preserve the visible anchor when older turns are prepended.
- [ ] **MUST** derive bottom state after momentum/overscroll settles. A transient
  negative or elastic offset cannot leave the `New` badge stuck.
- [ ] **MUST** move the followed viewport above the IME without adding a second
  navigation-bar inset.
- [ ] **MUST** have a recovery path when an indexed jump targets an unmeasured
  variable-height row.
- [ ] **SHOULD** give heterogeneous row types to the recycler and memoize all
  props passed into the list.

Acceptance tests:

- fast upward scroll while 100 deltas arrive: viewport anchor does not move;
- fast fling to bottom through overscroll: `New` disappears after settle;
- prepend two pages: the same text remains under the same screen coordinate;
- collapse a tool, recycle its row, return: the tool remains collapsed;
- rotate/fold/unfold with keyboard open and with the reader away from bottom.

## 5. Rich content and private media

- [ ] **MUST** parse rich text into a typed AST/renderer registry. Protocol item
  type, render schema version, and fallback renderer are explicit.
- [ ] **MUST** bound source length, AST work, nesting, JSON preview length,
  decoded image bytes, cache bytes, and concurrent media decodes.
- [ ] **MUST** render raw HTML as text unless a maintained sanitizer and isolated
  execution boundary are deliberately introduced.
- [ ] **MUST** allowlist link and image URI schemes. `javascript:`, local file
  escape paths, credentials in URLs, and implicit intent launches are rejected.
- [ ] **MUST** keep remote images private: authenticated fetch, app-private
  bounded disk cache, no public unauthenticated source URL, and no token in the
  rendered URL.
- [ ] **MUST** reserve image dimensions before decode, show loading/error state,
  decode a bounded thumbnail for the timeline, and load full resolution only in
  preview.
- [ ] **MUST** keep text/code selectable and copyable. Links need an explicit
  press target and failure handling.
- [ ] **MUST** collapse completed tools/activity by default; active tools expose
  progress; failures and approvals remain visible.
- [ ] **SHOULD** parse completed Markdown off the interaction-critical path and
  cache the immutable AST with an explicit byte budget.

Acceptance tests:

- malformed Markdown, 512 KiB text, deep nesting, huge diff, and huge JSON do
  not block scrolling or crash;
- hostile URL schemes and raw HTML cannot execute;
- an expired media session refreshes privately and retries once;
- a 50 MP source never decodes at full size inside a timeline cell.

## 6. Composer, attachments, and voice

- [ ] **MUST** keep the one-line composer and menu/send buttons aligned at 48 dp;
  grow to a bounded height, then scroll internally.
- [ ] **MUST** persist the draft before or with UI acknowledgement and preserve
  it across thread switching and process death.
- [ ] **MUST** model upload as queued/uploading/ready/failed with progress,
  cancellation, byte limits, checksum verification, and resumable retry where
  the server supports it.
- [ ] **MUST** model voice as
  `permission -> starting -> recording -> finishing -> done/error/cancelled`.
  Every terminal path stops capture, removes listeners, and releases the mic.
- [ ] **MUST** validate sample rate/channel/encoding at the capture boundary.
  The current dictation path is mono PCM16 at Android's routed sample rate.
- [ ] **MUST** buffer audio with a duration/byte limit, preserve order, drain on
  finish, and fail visibly on overflow. Never drop a chunk silently.
- [ ] **MUST** handle typed transcript delta, completed transcript, error, and
  closed events separately. A request transcription fallback cannot pretend to
  be live streaming.
- [ ] **MUST** preserve the user's existing draft as a prefix and never send a
  transcript automatically.

Acceptance tests:

- deny permission, revoke mid-session, background during recording, tap finish
  twice, receive a server close, and lose network while draining;
- delay audio RPC acknowledgements for 10 seconds and verify ordered delivery or
  a visible bounded-buffer failure;
- HMR/remount during capture leaves no recorder, listener, or remote session.

## 7. Android lifecycle

- [ ] **MUST** move socket, database, hashing, image decode, and audio work off
  the main thread.
- [ ] **MUST** use a foreground service only while the user reasonably expects a
  persistent connection, with a truthful, private, actionable notification.
- [ ] **MUST** restore enabled connections and durable frames after process death;
  JS attachment is not the connection owner.
- [ ] **MUST** assume Doze can suspend network delivery. On wake, reconcile by
  cursor rather than assuming the socket stayed healthy.
- [ ] **SHOULD** use push/FCM for timely background wake-ups. Without push, the
  product must explicitly accept delayed background delivery under Doze.
- [ ] **SHOULD** use WorkManager for persistent deferred reconciliation, not for
  an always-live streaming socket.

Acceptance tests:

- screen off/on, Doze, force-stop/relaunch, process kill with the service alive,
  network handoff, and notification permission denied;
- no raw prompt, command, token, path, or approval content appears in a lock
  screen notification.

## 8. Accessibility

- [ ] **MUST** expose the timeline as a sequential log and announce completed
  messages/approvals politely; never announce every token.
- [ ] **MUST** provide meaningful labels, roles, states, pressed feedback, and a
  48 by 48 dp target or equivalent hit slop for every action.
- [ ] **MUST** provide a non-swipe alternative to every swipe action.
- [ ] **MUST** keep status understandable without color and keep focus stable
  while streaming.
- [ ] **MUST** work with TalkBack, switch access, 200% font scale, and reduced
  motion. Truncation cannot hide a required action.

## 9. Performance and observability budgets

Measure release/profile builds on the target phone and fold; dev/HMR numbers do
not count.

- [ ] cached thread first useful paint: `<300 ms p50`, `<700 ms p95`;
- [ ] connection-ready cached list: no network dependency;
- [ ] accepted delta to visible text: `<100 ms p95` on a normal local/VPN link;
- [ ] foreground resume to first reconciliation signal: `<1 s p95` when the
  endpoint is reachable;
- [ ] steady streaming: no repeated JS/UI stall over 100 ms and no unbounded
  growth in heap, event queue, AST cache, image cache, or native frame journal;
- [ ] largest sanitized real thread opens, searches, expands, and fast-scrolls
  without blank rows or a crash;
- [ ] record timings for cached-open, network reconcile, TTFT, delta visibility,
  reducer/persistence batch, render commit, image fetch/decode, reconnect, and
  voice start/drain/error stage;
- [ ] record counts for cursor gaps, duplicates, queue overflows, dropped events
  (target zero), reconnect attempts, auth failures, unknown item types, and image
  failures;
- [ ] never record tokens, raw prompts, tool output, audio, private URLs, local
  paths, or capability/session credentials.

## 10. Release gate

- [ ] unit: reducer order/idempotency, outbox ambiguity, renderer registry,
  limits, URL/media validation, expansion store, and audio backpressure;
- [ ] property/fuzz: duplicate/reorder/drop events and malformed rich payloads;
- [ ] integration: snapshot/replay/gap, reconnect, auth expiry, private media,
  upload, voice, queue/steer/fork, and approvals;
- [ ] E2E phone/fold: IME, rotate/fold, scroll/read/follow, search, sheets,
  TalkBack labels, giant thread, images, and every supported protocol block;
- [ ] Android device gate: process death, foreground service, sleep/wake,
  airplane mode, notification actions, and OTA/HMR cleanup;
- [ ] release benchmark: Macrobenchmark/Baseline Profile plus deterministic large-fixture render
  benchmark; compare against the previous accepted build;
- [ ] soak: multiple simultaneous servers, reconnect churn, streaming burst,
  queue drain, and bounded disk/memory growth.

## Current hostile audit (2026-08-11)

### PASS

- Cursor snapshot/replay, contiguous application, atomic SQLite cursor commit,
  duplicate suppression, replay-window fallback, and bounded event ingress.
- Durable outbox with client ids and an explicit uncertain state.
- 50 ms normal-delta UI batching with immediate lifecycle/approval flush,
  addressed-turn cloning, plain-text active answers,
  memoized turn rows, stable row keys, and external expansion state.
- First-open bottom behavior, separate follow/read modes, anchor-preserving older
  page loads, renderer fallback, and bounded Markdown/JSON source previews.
- Native foreground connection owner, durable native frame journal, session
  credentials, routed-rate mono PCM capture, ordered one-second audio network
  batches, a bounded five-second upload buffer with visible overflow, sanitized
  real-thread fixtures, phone and fold E2E
  coverage, corpus benchmarks, sync soak, and baseline profile.
- Per-turn model/effort/permission provenance, omission of unproven historical
  cost, authenticated HTTPS media materialization with redirect SSRF checks,
  and bounded privacy-safe runtime timing/counter aggregates.

### FAIL — release blockers

- The release gate records delta-to-commit, reducer, ingress, image, thread-open,
  and voice aggregates, but it does not yet fail a build from a physical phone's
  exported p95 values. Corpus and Macrobenchmark gates cannot fully explain a
  network-dependent real-device stall.

### CONDITIONAL

- The foreground socket survives ordinary activity/JS death, but Doze cannot
  guarantee timely background delivery. V1 can accept delayed delivery; a
  production "instant in background" claim requires push wake-up plus cursor
  catch-up.
- Reconnect is exponential but has no jitter. Add jitter before fleet/server
  scale makes synchronized reconnect storms relevant.
- Image cells still reserve a fixed 220 dp box and have no explicit
  decoded-pixel budget. Keep for V1 only if device tests cover pathological
  dimensions.
- Rich Markdown source/cache bytes are bounded; AST depth and parse time are not.
  Instrument before adding a broad parser rejection rule.
- Icon labels are broadly present, but the timeline has no verified TalkBack log
  behavior and no device gate at 200% font scale. Treat accessibility as
  unverified, not passed.

## Primary references

- OpenAI Realtime transcription:
  https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI Realtime WebSocket:
  https://developers.openai.com/api/docs/guides/realtime-websocket
- OpenAI streaming responses:
  https://developers.openai.com/api/docs/guides/streaming-responses
- Android offline-first data layer:
  https://developer.android.com/topic/architecture/data-layer/offline-first
- Android Doze and App Standby:
  https://developer.android.com/training/monitoring-device-state/doze-standby
- Android foreground services:
  https://developer.android.com/develop/background-work/services
- Android Paging 3:
  https://developer.android.com/topic/libraries/architecture/paging/v3-overview
- Android Macrobenchmark:
  https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
- React Native FlatList:
  https://reactnative.dev/docs/flatlist
- React Native list optimization:
  https://reactnative.dev/docs/optimizing-flatlist-configuration
- FlashList v2 usage and chat positioning:
  https://shopify.github.io/flash-list/docs/usage/
- FlashList recycling:
  https://shopify.github.io/flash-list/docs/recycling/
- Matrix incremental sync (reference design):
  https://spec.matrix.org/v1.13/client-server-api/
- WebSocket API and `bufferedAmount`:
  https://websockets.spec.whatwg.org/
- WAI-ARIA log pattern:
  https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23
- OWASP XSS prevention:
  https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
