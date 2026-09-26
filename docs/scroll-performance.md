# Android scroll diagnostics

Collection is automatic while the app is foregrounded. It does not require the
optional Data for geeks HUD. `WindowFrameMonitor` discovers the Activity window
and Compose dialog windows, including nested Material sheets. It attaches Android
FrameMetrics and native scroll observers; this native collector does not forward
per-frame or per-scroll events to JS. The separate timeline position journal below
observes the JS scroll callbacks already used by the conversation.
Window discovery is triggered by focus changes, with a one-second fallback.
The beginning of a newly opened window can therefore precede observation.

Each shared sheet has a content-free native marker. Projects, folders, ports,
skills and settings use explicit bounded labels; other sheets use `sheet`.
Native windows without a public Compose window provider are counted as
`unobservedWindows`, not silently claimed as covered.

## Retrieve a report

In Settings, open Advanced / Data for geeks and tap **Copy scroll report**.
The HUD can remain off. The JSON includes `frameReport.windows`, with the native
APK build for each sample, its surface, activity and numeric measurements.
The same JSON contains `timelineScroll` (position evidence) and `streaming`
(operational counters and timing percentiles).

For a stuck conversation, reproduce the problem, press the jump-to-latest button
once, try a manual scroll, then copy this report **before restarting the app**.
Opening Settings does not clear the position journal. The native frame history
is persisted; the JS position journal is process-local and is lost on restart.

The native private file `window-frame-report-v1.json` retains up to 600 sample
windows. It is atomically persisted off the UI/frame threads every five seconds
and on backgrounding. A force kill may lose the last unpersisted tail. Restored
samples remain available for local export, but are not replayed to the server.
`evictedWindows` counts retention evictions in the current process.

The existing legacy telemetry channel sends `ui.scroll_window` for scroll samples
and `ui.frame_incident` for other janky frames. It retains its existing bounded
queue, retry and selected-server routing. No server selection means no automatic
upload; the native local report still works. A JS stall delays upload, not native
collection. JS scheduling delay remains a separate `ui.js_scheduling_delay` event.

## Interpret measurements

- Group by `appBuild`, `surface` and `activity`. The APK build does not identify an OTA.
- Compute jank percentage as `100 * sum(jankFrameCount) / sum(frameCount)`;
  do not average percentages. Healthy scroll windows are retained too.
- Compare `maxFrameMs`, `maxUiDelayMs`, `maxLayoutMs`, `maxDrawMs`, `maxGpuMs`
  and `overrunTotalMs`. These narrow the expensive stage, not its code-level cause.
- `missedVsyncEstimate` is an estimate, distinct from `droppedMetricReports`
  (Android could not deliver measurement callbacks) and report-queue overflow.
- `activity=scroll` means a native scroll notification within an interval with
  a 50 ms lead and 250 ms tail. This accommodates frame callback delay and fling
  updates; it is not an exact finger-down/finger-up trace. Sheet dragging without
  content scrolling is measured as `other` when janky.
- Sampling windows are not exact gesture durations or display FPS. No percentile
  can be reconstructed from these aggregates. Use an explicit system trace for
  deeper analysis after finding a reproducible surface/build regression.

The native frame collector stores no text, paths, URLs, coordinates, view trees,
screenshots, or stacks.
Discovery inspects at most 64 views for a new window/marker, tracks at most 16
windows, and reports missing coverage. Per-frame accumulation uses primitive
counters; serialization and file writes run on the collector executor.

## Timeline position journal

This observer never changes scroll policy or issues a corrective scroll. It runs
with the HUD off and records these `chat.scroll.*` events:

- `command`: app-issued end/index/offset commands, their source (`jump-end`,
  `jump-unread`, `response-start`, `search-result`, `search-restore`), numeric
  target, command ID and issued/resolved/rejected phases. A resolved Promise is
  **not** evidence of physically reaching the target.
- `sample` and `list-state`: actual scroll offset, content/viewport heights and
  distance to the end, alongside LegendList's logical position, visible indices
  and end flags. Unknown measurements use `-1`; `listAvailable=0` means the
  issuing list is absent or was replaced, not that a new chat reached the target.
- `policy`, `anchor-ready`, `layout`, `end-threshold`, `visible-row`, `lifecycle`:
  committed positioning switches, callback acceptance/repeated application,
  viewport/content/inset changes, cache invalidation and mount/unmount.
- `jump`: button admission, blocked/loading outcome and executor completion;
  `covered`, `pending` and `inFlight` explain admission. Executor completion does
  not imply the native end was reached.
- `gesture`: drag/momentum boundaries, maximum and net travel. Returning near
  the start after meaningful travel is evidence, not a diagnosis of a lock;
  normal back-and-forth dragging can do this too.
- `rebound`: an end command was followed by a physical end observation, then an
  upward movement greater than half a viewport (at least 64 layout units), within
  1500 ms and without a user drag or content/viewport size change. It includes the
  arrival command and most recent command IDs/source. This is a candidate trace,
  not automatic proof of a bug: an intentional search/anchor can also move up.

The journal retains 512 events, plus a separate 32-event context ending at the
last rebound. `evictedEvents` makes truncation explicit. Routine physical samples
are limited to four per second; rebound detection inspects every existing JS
scroll callback, including events suppressed from routine sampling. Native event
coalescing or a stalled JS thread can still hide a one-frame excursion.

Commands, policy, gesture boundaries, anchor readiness and jump outcomes use the
existing operational telemetry transport even with the HUD off. The shared
budget is 12 ordinary events plus 2 rebound events per second; `suppressedUploads`
counts excess uploads, while local recording continues. No connection/thread
identity means local-only recording. Server evidence is filtered by
`chat.scroll.*`, connection/thread IDs and `requestId` (recorder session), then
ordered by `values.sequence`. Sequence gaps can reflect local-only events or
upload suppression; the copied report is the complete retained context.

Local counters are `timeline_scroll_commands`, `timeline_scroll_command_failures`,
`timeline_scroll_anchor_reapplications`, `timeline_scroll_gesture_returns` and
`timeline_scroll_rebounds`. `timeline_scroll_command_ms` measures Promise latency;
`timeline_scroll_rebound_ms` measures observed time from end arrival to return.
Their P50/P95 values describe those events, **not** frame performance or the
probability of a stuck scroll.

The position journal contains numeric geometry, closed diagnostic labels and
opaque connection/thread/recorder IDs only. It does not retain message text,
search queries, item keys, URLs, screenshots, raw list state or error strings.

## Device-free verification

The jump-to-latest button uses its own presentation policy: it appears only after
remaining more than 12 React Native layout units (dp) from the bottom for 200 ms,
and hides immediately inside that edge zone. Repeated scroll samples do not
restart the delay; returning to the edge cancels it. An older paged window still
offers the absolute tail even at its local bottom. This does not change the
2-percent tail-follow threshold or response positioning. Only the button
subscribes to the Legend visibility value, and leaving a chat clears its timer.

Response positioning is event-driven: a response-scoped, one-shot readiness
callback calls `scrollToIndex({ viewPosition: 0 })`. Completion is projected before
the list commits, without a positioning effect. The callback belongs to that
request, so a child's early layout callback cannot observe a parent's previous
`useEvent` implementation. Subsequent size notifications cannot pull the user
back, and a manual drag revokes even a retained readiness callback. Completion
does not reintroduce `initialScrollIndex` into an already positioned list.

`nativeTimelineScroll` complements the JS journal on supported APKs. An always-on
native listener observes only the `conversation-timeline` ScrollView, with no
per-event bridge traffic. A backward jump of at least half a viewport within
300 ms, at unchanged content/viewport size, captures the synchronous Android
stack. Collection does not require an earlier app command and also covers flings.
Only approved framework class/method names and line numbers are exported; no
exception messages, content, arbitrary tags or URLs are captured. Retention is
12 incidents and 16 view baselines. A jump is evidence, not automatically a bug.
The source label identifies a known native call path or remains `unknown`; it
does not recover a JS stack for an asynchronously dispatched native command.
Older APKs and the web report `null`. This addition requires a new native APK.

Run the recorder contract tests, adapter/export tests, and the real LegendList
Chromium experiment:

```sh
pnpm exec vitest run apps/android/test/timeline-scroll-diagnostics.test.ts
pnpm exec vitest run apps/android/test/native-timeline-scroll-report.test.ts
pnpm exec vitest run apps/android/test/timeline-jump-visibility.test.ts
pnpm --filter @codewide/android test:v1:render --runTestsByPath test/v1-jump-visibility.render.test.tsx
pnpm --filter @codewide/android test:v1:render --runTestsByPath test/v1-scroll-diagnostics.render.test.tsx test/v1-jump-to-latest.render.test.tsx
pnpm --filter @codewide/android test:legend-list-response-positioning
pnpm android:gradle :app:testDebugUnitTest --tests dev.codewide.app.performance.TimelineScrollIncidentsTest
```

The browser fault-injection scenario deliberately reapplies an anchor after
reaching the real list end and verifies that the production recorder captures
the return. It proves observation coverage, not the root cause of the Android
report. Use an actual device trace to distinguish app commands, LegendList/native
position correction and changing layout.
