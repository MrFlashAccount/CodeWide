# Android scroll diagnostics

Collection is automatic while the app is foregrounded. It does not require the
optional Data for geeks HUD. `WindowFrameMonitor` discovers the Activity window
and Compose dialog windows, including nested Material sheets. It attaches Android
FrameMetrics and native scroll observers; no frame or scroll event crosses JS.
Window discovery is triggered by focus changes, with a one-second fallback.
The beginning of a newly opened window can therefore precede observation.

Each shared sheet has a content-free native marker. Projects, folders, ports,
skills and settings use explicit bounded labels; other sheets use `sheet`.
Native windows without a public Compose window provider are counted as
`unobservedWindows`, not silently claimed as covered.

## Retrieve a report

In legacy Settings, open Advanced / Data for geeks and tap **Copy scroll report**.
The HUD can remain off. The JSON includes `frameReport.windows`, with the native
APK build for each sample, its surface, activity and numeric measurements.
Collection also covers V2 sheets; no V1 transport is introduced into V2.

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

No text, paths, URLs, coordinates, view trees, screenshots, or stacks are stored.
Discovery inspects at most 64 views for a new window/marker, tracks at most 16
windows, and reports missing coverage. Per-frame accumulation uses primitive
counters; serialization and file writes run on the collector executor.
