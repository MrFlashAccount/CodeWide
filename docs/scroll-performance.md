# Android scroll diagnostics

Conversation diagnostics are automatic and do not require the Data for geeks HUD.
`nativeTimelineScroll` v2 observes native scroll/layout/gesture events and draw-time
geometry, and reuses the existing Activity FrameMetrics listener for detailed
timings. It sends no per-frame events to JS, requests no frames, and does not walk
message trees. The separate JS journal observes existing callbacks and commands.

`frameReport.windows` is a different, older collector: `WindowFrameMonitor` is
currently enabled only during an explicitly armed navigation/Hermes profile.
It discovers Activity/Compose windows with focus notifications and a one-second
fallback, using bounded sheet labels. An empty `frameReport.windows` is **not**
evidence of smooth scrolling. Use `nativeTimelineScroll.trace` for ordinary chat
reproductions, including with profiling and the HUD disabled.

## Retrieve a report

In Settings, open Advanced / Data for geeks and tap **Copy scroll report**.
The HUD can remain off. The JSON includes `nativeTimelineScroll` with the APK
version/build, density, collection coverage, native incidents and detailed trace.
It also contains `timelineScroll` (JS commands/policy), `streaming` (operational
counters/timings), and the optional `frameReport` and HUD snapshot.

For a stuck conversation, reproduce the problem, press the jump-to-latest button
once, try a manual scroll, then copy this report **before restarting the app**.
Opening Settings does not clear either journal or the retained incident captures.
Detailed evidence is process-local and lost on restart. No background file writes
or automatic uploads were added. The legacy frame journal has persistence helpers,
but the current monitoring lifetime does not schedule them; do not rely on it to
retain a reproduction across process death.

## Interpret optional aggregate measurements

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

The aggregate window collector stores no text, paths, URLs, coordinates, view trees,
screenshots, or stacks. The separate timeline recorder does store scroll geometry
and allowlisted framework stacks, as described below.
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
- `library-command`: actual LegendList native dispatch/retry, its requested offset,
  current logical offset, initial-position status, tail-follow/native-correction
  flags and numeric geometry. The opt-in dependency observer runs before native
  dispatch, receives no rows/keys/text, and cannot cancel a command even if it throws.
  A mount `contentOffset` seed can settle without an imperative dispatch. Keyboard
  worklet commands bypass this observer; absence of a matching entry is not proof
  that no native command occurred.
- `native-view`: binds the JS recorder session to the native `viewTag`, so parallel
  lists and rapid chat switches are not correlated by timestamp alone.
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

An unread response known during initial positioning uses
`initialScrollIndex={{ index, viewPosition: 0, viewOffset }}` without extra trailing space.
The explicit top alignment matters: LegendList 3.4.0 bottom-aligns a numeric last
index. The natural scroll range clamps short responses to the tail, so an already
visible start is not forced against the header. Bootstrap alone owns this initial position;
readiness never issues
an additional command, including after `onLoad` retires the bootstrap props.
An early imperative command would supersede bootstrap and reveal unsettled rows.

Responses arriving after initial positioning (`lateUnread` in the journal) and
streaming completion retain a response-scoped, one-shot readiness callback. It measures
the rendered row against the native viewport, including list headers, padding and
underflow alignment. If the start is visible between the header and composer, no
scroll command is issued, even when the rest of the response extends below the viewport.
Otherwise it calls `scrollToIndex({ viewPosition: 0 })`. The `anchoredEndSpace` readiness
gate uses a window-height offset (an upper bound on the viewport height), requiring
zero synthetic trailing space. Completion is projected before the list commits,
without a positioning effect. The callback belongs to that request, so a child's
early layout callback cannot observe a parent's previous `useEvent` implementation.
Subsequent size notifications cannot pull the user back, and a manual drag revokes
even an in-flight visibility measurement or retained readiness callback. Completion does not reintroduce
`initialScrollIndex` into an already positioned list.

The response-positioning browser experiment samples the first 20 actually visible
list frames, checking natural tail placement for short unread responses and start
visibility for long unread last rows and sliced responses. It also checks that completing
a visible short response changes neither its position nor the scroll range, and that
initial unread positioning emits no
imperative response command. It exercises the real list and response owner with DOM
layout, not Android Fabric. The V1 render gate separately checks the native entry's
initial offset for an unread last row and the production viewport's initial/late
hydration contracts. Handset confirmation is still required for Android frame order.

### Completion without replacing displayed text

A completion flicker can occur without any scroll command: removing the streaming
wrapper remounts the entire Markdown group, even when the response key and a short
paragraph are unchanged. Switching the reveal host from its native component to a
plain `View` when animation stops has the same effect.

Virtualized Markdown now retains `StreamingRevealSurface` through completion. Its
host depends only on native-adapter availability; completion and reduced motion
change paint flags, not the mounted text hierarchy. The native adapter clears its
reveal spans when disabled and skips subsequent document traversal. Links, text
selection, and the existing text layout remain owned by the same native view.
The rich-content reveal signal becomes null while animation is disabled, so a
retained wrapper does not make completed or recovered HTML tables animate.

`v1-streaming-reveal.render.test.tsx` reproduces the short-answer transition through
the actual timeline projection and turn body; the Markdown renderer is a test
double. `streaming-reveal-native.render.test.tsx` checks host identity, action
continuity, reduced motion, and recovered-to-live updates with an Android-host
adapter. The fallback test covers an APK without that native adapter. These tests
check component lifetime, not handset frame presentation. Long-response slicing,
external-content loading, and actual Fabric frame ordering remain separate cases.

`NativeStreamingRevealViewTest` runs the real Android view and `ReactTextView` in
Robolectric. A live append must first produce reveal paint. Completion or reduced
motion then removes only that paint, preserving the text object, line layout,
selection, links and styles; later pre-draws must not walk the document. The fixture
supplies the foreground-window event normally delivered by Android's window manager.
Run it without starting the application:

```sh
pnpm android:gradle :app:testDebugUnitTest --tests 'dev.codewide.app.rendering.NativeStreamingRevealViewTest' --tests 'dev.codewide.app.rendering.StreamingReveal*Test'
```

### Native initial-offset lifetime

The APK 0.2.204 incident report exposed a separate reset below the response anchor:
the native list reached its end, then `ReactScrollView.setContentOffset(null)`
executed `scrollTo(0, 0)` from a Fabric property update. Reapplying null also resets
the native position; a resolved imperative scroll cannot prevent the next reset.

LegendList 3.4.0 recomputed its native `initialContentOffset` when bootstrap ownership
changed. If an imperative scroll had already cleared the initial target, removing
the bootstrap props removed `contentOffset` too. The pinned dependency patch keeps
this native mount seed in owner-held state for the lifetime of the mounted list.
It does not retain the bootstrap policy, reapply an anchor, add a positioning effect,
or change the later `scrollTo` commands. A new list mount computes its own seed.
Both native CommonJS and ESM entrypoints are patched; browser entrypoints are unchanged.

The V1 render gate includes a regression against the **real installed native
LegendList**, bypassing the ordinary presentation double. It verifies the native
property contract while bootstrap props are released after an imperative scroll.
The dedicated Chromium experiment runs both native entrypoints with Android/Fabric
branches enabled, real DOM layout, and a model of Android's content-offset setter.
It covers cached/delayed history, tail/unread bootstrap, repeated commits, manual
scrolling, and a new conversation mount. Without the patch, the modeled native
position returns to zero; with it, the requested position survives. This is a
device-free reproduction of the property contract, not a full Fabric runtime or
proof from an Android handset.

### History reprojection during initial positioning

The APK 0.2.207 opening report contains a different transition: the unread target
moves from physical index 54 to 49 as the row count changes from 55 to 50, before
the first-load callback. Content height also changes during and after opening.
No application scroll commands are recorded. The sampled native events do not
establish the exact ordering of every visible Fabric frame.

LegendList's active bootstrap target retained the old index even when the caller
published a new `initialScrollIndex` with the changed data. A stale index can
resolve to another item, or to offset zero when it is beyond the new data length.
The ordinary `initialScrollAtEnd` path already retargets after data changes. A
device-free regression reproduces the unread-only failure with fixed row sizes,
so this particular failure does not require a Markdown measurement race.

The native dependency patch now accepts an updated index only while the initial
positioning is unfinished and the data changes. It cancels an obsolete in-flight
initial dispatch and re-enters the existing measurement/readiness gate. Finished
positioning, manual/imperative scroll ownership, and offset-based initialization
are not re-armed. The app still publishes cached history immediately; this adds
no hydration barrier, timer-based reveal delay, remount, or positioning effect.

`test:legend-list-opening-settlement` exercises both native module formats with
web/Android platform branches. It checks removal/insertion before the target,
updates before and during native dispatch, short/long/sliced answers, an estimated
size case, and manual scrolling followed by jump-to-end. Assertions cover the
first visible frames: short answers stay at the natural tail; long answer starts
stay visible without changing position between frames. Fixed-size fixtures isolate
target identity from native measurement scheduling.

The DOM adapter models the native `contentOffset` mount seed and the frame-delta
contract of React Native's `MaintainVisibleScrollPositionHelper`; React Native Web
does not implement the latter. It is not a Fabric scheduler. Broader late-height
reflows and device frame order still require handset validation. To compare a
different native package snapshot without changing installed dependencies, set
`CODEWIDE_LEGEND_PROBE_PACKAGE` to its unpacked package directory.

### Resident data changes during an active scroll

The APK build 224 report includes a 51-to-47-row update after initial positioning,
followed by content height collapsing to the viewport height, offset zero, and a
return to the tail. A device-free reproduction isolates a matching LegendList
defect: an unfinished end command retains index 50 after the data shrinks. MVCP
asks for that absent item's size; its null key reaches `addTotalSize`, where null
means replacing the whole list size. This overwrites the transcript height with
one estimated row height. The handset report does not contain that internal call
stack, so the reproduction establishes the defect, not every device jump's cause.

The native-entry patch captures each indexed command's item key. During data
changes, a non-bootstrap command follows that key, while `scrollToEnd` follows
the new last row. Removing the target or emptying the list settles the obsolete
request and releases its ownership. After positions are rebuilt, the active
command's offset, size, completion target and pinned render range are refreshed.
An absent target cannot enter item-size accounting. Bootstrap keeps its separate
owner; finished commands and manual scrolling are not reactivated.

The end-clamp calculation also includes the target row's own height change.
Otherwise replacing a tail row and measuring it smaller than its estimate can
apply the same shrink twice: once through the native scroll-range clamp, then
through MVCP, pulling the viewport above the tail.

`test:legend-list-opening-settlement` checks content-length notifications and
rendered frames during active commands, not just the final position. Cases cover
history removal/insertion, appending or replacing the tail, stable keyed item
targets, removed targets, empty/refilled data, and hydration after `onLoad`.
The 51-to-47 case fails against the preceding package patch and preserves the
visible short answer with the updated patch. Both module formats and web/Android
branches run without an Android application. Actual Fabric frames still require
handset confirmation. No application effect, reload barrier, or delayed scroll
was added.

### Measured-height contraction after opening

The September 27 08:44 report (APK 224; OTA identity is not recorded) separates
this failure from late transcript hydration. For the last opening, native scroll
first reached the shortened end, then `MaintainVisibleScrollPositionHelper`
applied another negative adjustment of about 649 and 693 dp at +125 and +157 ms.
The row projection changed from 60 to 71 only at +197 ms. No application scroll
command or user drag occurred between the initial positioning and these shifts.
The later visible range ended before the requested response-start index.

LegendList's item-size path advances logical scroll by the whole anchor delta
and moves its zero-sized native MVCP sentinel by that delta. Android Fabric
clamps the physical scroll range during mounting before applying the sentinel
delta. Thus a contraction crossing the old offset was counted twice. The
existing pending-data compensation does not own these item-size updates;
extending it to sizes also loses consecutive measurement adjustments.

The patched `ScrollAdjust` projects the logical adjustment into a native sentinel
delta once per committed render. For accumulated adjustment `D`, logical offset
`S`, and new maximum `M`, the pre-adjustment offset is `S - D`; the already-applied
native contraction is `min(0, M - (S - D))`. The sentinel subtracts that contraction
from `D`. Batching is essential: several measurements can reach one native mount.
A layout effect only acknowledges the committed sentinel snapshot, with no
scroll command, timer, target retention, loading gate, or additional render.
The existing pending-data owner remains exclusive. This is Android/Fabric-only;
web/iOS behavior and application unread policy are unchanged.

The opening-settlement browser suite includes measured-height reflow followed
by 60-to-71 hydration, repeated measurements during hydration, both native module
formats, and manual drag followed by reflow/hydration and a working end button.
It observes every animation frame after the first reveal, including hidden or
missing responses. The preceding patch fails the large-contraction fixture:
the response start moves from 62 to 2480 px, outside the usable viewport.
With this correction, the response start stays fixed and visible. This is a
synthetic reproduction of the native clamp/MVCP contract using real LegendList,
not a recording of Android Fabric or a replay of the user's message contents.

Manual acceptance after an approved OTA on APK 224:

1. Leave a long chat before its response completes. Wait elsewhere until the
   response is final/unread, then reopen it. Repeat with both cached and freshly
   loaded history; do not touch the screen for the first two seconds.
2. The start of that final response must be visible from the first content frame
   and remain visible while history settles. It must not jump to an earlier turn.
   A short response that already fits must stay at the natural tail.
3. Repeat, but immediately drag into older history while it loads. Loading must
   not take control back. Drag down and use the end button; neither may rebound.
4. Reopen the now-read chat and check normal end positioning. If any jump remains,
   save the Scroll Report immediately and record which OTA was applied.

This fix changes only the dependency's JS entrypoints and is OTA-compatible.
Device validation and publication are separate, explicitly authorized steps.

### Response completion and unread observation retain mounted content

The September 27 10:32 report contains a `completedResponse` transition followed
86 ms later by `lateUnread`. At completion, row count changes from 68 to 64 and
content height decreases by about 992 dp; the offset decreases by approximately
the same amount, keeping the viewport at the end. There is no application
response-start scroll command or timeline unmount at that transition. The native
frames for this moment had already been evicted, so the report cannot establish
whether a particular frame was blank.

Component-level reproduction identifies two independent lifetime defects in the
virtualized turn renderer. Enabling unread observation inserts a native parent
around the existing response; acknowledging it removes that parent. Either
operation remounts the text. Separately, splitting a completed full-width answer
changes its leading slice from `single` to `start`. Including that presentation
value in error-boundary reset keys remounts the whole leading bubble despite a
stable LegendList row key.

`VirtualizedTurnTimelineItem` now keeps the measurement parent mounted and only
attaches/detaches its unread callbacks. Both local error boundaries follow turn
identity, while LegendList's physical row key continues to own slice identity.
Corner/footer changes do not reset content. Shared error-boundary behavior,
Markdown splitting, scroll commands and positioning policy are unchanged; this
adds no effect, timer or imperative correction.

`v1-turn-completion-identity.render.test.tsx` renders all projected response rows
through the complete bubble and real error boundaries. It verifies text/native
view identity through completion, late unread observation, acknowledgement and
splitting, plus working measurement callbacks and genuine turn replacement.
Four lifetime cases fail before the fix; the two control cases already pass.
These tests establish React mount preservation, not Android frame scheduling.

After an approved OTA, manually check a short streamed response and a full-width
response containing a heading/code block. Let each finish while following the
tail: displayed text must not disappear when completion/unread state changes.
Reopen an unread answer and let it become read without touching the screen; it
must not blink on acknowledgement. Finally, scroll into older history before a
response finishes and check that completion does not take over manual scrolling.

### APK 227 opening: hydration and retargeted end measurements

The September 27 16:48 report confirms several physical reversals during the
last unread opening, before the first drag at +1102 ms. Projection grows from
84 to 97 rows at +179 ms, keeping the requested response at index 83. At +223 ms,
after native range clamps, `MaintainVisibleScrollPositionHelper` applies another
-2848 physical pixels (about -1218 dp). An end command then moves the offset
forward by 3293 physical pixels at +302 ms, followed by another adjustment and
an end retry. The captured list remains attached, shown and opaque throughout;
these observations do not establish the lifetime of an individual text view.
The local APK 227 Hermes bytecode contains the earlier `ScrollAdjust` clamp
compensation. The report does not record the installed OTA identity.

A focused reproduction finds an additional, independently proven reversal:
an active end command changes its target to the newly appended last row, but
the MVCP calculation compares that row's height with the former last row's
height. The 84-to-97 short-response fixture moves the response start from 560
to 710 px before returning to 170 px. Those are different measurement owners,
not a resize of one row. On data changes, an active end target now derives its
adjustment from the change in the whole scroll range. Item-target positioning
and subsequent same-row measurement retain their existing ownership. This
adds no timer, effect or corrective scroll command.

The opening-settlement suite now covers short/long responses with 84-to-97
hydration, per-frame start visibility and absence of a backwards excursion,
manual scrolling during reflow/hydration, and a working end button. Its native
DOM adapter emits per-frame scroll events instead of RN Web's throttle=0
first/trailing-only behavior. Existing target replacement/removal cases remain
required. The short-response case fails against the preceding package patch.

**Remaining evidence gap:** this reproduction proves the retargeting defect,
not the source of the earlier -1218 dp adjustment in the device trace. That
trace does not include the corresponding JS MVCP request/sentinel calculation.
Do not describe this narrow correction as proof that all APK 227 opening jumps
are resolved. Device verification and any publication remain separate steps.

The local `library-adjustment` event now captures each committed sentinel
calculation: requested delta, clamp compensation, resulting sentinel delta,
logical offset, last observed native offset, pending data-owner compensation,
content/viewport size and row count. `phase=react-commit` is explicitly not a
native mount acknowledgement. Values are validated at the adapter boundary;
message contents and arbitrary callback fields are excluded. These events use
the existing bounded journal without telemetry uploads or new listeners,
timers, scroll commands or effects. A failing observer cannot abort the commit.

After an approved OTA, reopen an unread short answer and then an unread long
answer without touching the screen for two seconds. If a jump occurs, copy the
report immediately so the new calculation events can be aligned with the native
capture. Then repeat while dragging into older history during hydration; loading
must not reclaim scrolling, and the end button must still work without rebound.

### Native jump observation

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
`worklet-scroll` describes a stack involving Reanimated, which may merely be
flushing queued Fabric commands; it does not conclusively identify the JS issuer.
Narrow R8 rules preserve the visible-content adjustment helper and scroll entrypoints
so release minification cannot turn that known source into an opaque class name.
Old v1 native reports remain readable; unsupported APKs and the web report `null`.
The v2 measurements require a new native APK, not an OTA alone.

### Detailed native trace (v2)

- `appVersion`, `appBuild`, and `density` exist even with no incidents or frame
  samples. Geometry is in physical pixels; JS geometry is in RN layout units.
  A zero density means no timeline view has been observed yet.
- `trace.entries` retains 240 native callbacks. `kind=geometry` includes scroll,
  layout, drag/momentum, attach/detach and `phase=draw`, with view tag, offset,
  content/viewport heights, direct content-child count, shown/alpha state and
  keyboard inset. Unknown measurements are `-1`, not an invented zero.
- `kind=frame` contains Activity frame start time, total/deadline, layout, draw,
  GPU and UI-delay durations and dropped FrameMetrics callback count. Recording
  uses the existing listener while timeline observations are recent (two-second
  tail), independently of HUD/CPU/memory/Hermes sampling. Frames are Activity-wide,
  not a measurement of one bubble, and callbacks may arrive after newer geometry.
- `trace.captures` keeps four incident windows: up to 64 entries through the trigger
  and 96 following callbacks. A burst shares one capture, so repeated rebounds
  cannot extend storage unboundedly. Subsequent navigation cannot overwrite a
  finished capture; `evictedCaptures` reports replacement by newer incidents.
- `listening`, `trackedViews`, `geometryCount`, `drawCount`, `frameCount`, and
  `evicted` explicitly report coverage/retention. Zero frame samples means unknown
  performance. Native sequence is callback order; use `unixMs` for JS correlation
  and `uptimeMs` for native elapsed time, not sequence order as display order.
  Frame `unixMs` is the intended frame start; its `uptimeMs` is callback arrival.
  Use the supplied duration fields, not the gap between callback arrivals, for jank.

Draw-time offsets distinguish movement between callbacks from positions present
when Android begins drawing. These are not screenshots or proof of compositor
presentation; text disappearance inside a stable container can require a video
or system trace. No text, URLs, row keys, error messages or view trees are exported.
No renderer, scroll policy, keyboard behavior or gesture ownership is changed.

Run the recorder contract tests, adapter/export tests, and the real LegendList
Chromium experiment:

```sh
pnpm exec vitest run apps/android/test/timeline-scroll-diagnostics.test.ts
pnpm exec vitest run apps/android/test/native-timeline-scroll-report.test.ts
pnpm exec vitest run apps/android/test/timeline-jump-visibility.test.ts
pnpm --filter @codewide/android test:v1:render --runTestsByPath test/v1-jump-visibility.render.test.tsx
pnpm --filter @codewide/android test:v1:render --runTestsByPath test/v1-scroll-diagnostics.render.test.tsx test/v1-jump-to-latest.render.test.tsx
pnpm --filter @codewide/android test:v1:render --runTestsByPath test/v1-legend-native-offset.render.test.tsx
pnpm --filter @codewide/android test:legend-list-response-positioning
pnpm --filter @codewide/android test:legend-list-native-offset
pnpm --filter @codewide/android test:legend-list-opening-settlement
pnpm android:gradle :app:testDebugUnitTest --tests 'dev.codewide.app.performance.Timeline*'
```

The browser fault-injection scenario deliberately reapplies an anchor after
reaching the real list end and verifies that the production recorder captures
the return. It proves observation coverage, not the root cause of the Android
report. Use an actual device trace to distinguish app commands, LegendList/native
position correction and changing layout.
