# Message rendering work reduction

## Scope and owners

Three changes reduce work while retaining the existing virtualizer, message content and navigation.

- `TurnChangesFooter` previously parsed every recorded diff while rendering a Changes button.
  It now checks only whether the patch is empty. Opening parses the latest recorded patch and
  passes the existing qualified turn target to the shared Changes capability.
- Each `CostBreakdownMenu` previously mounted a Compose Host and trigger bridge, even though its
  detail body was already lazy. ConversationLayout now installs one accounts-owned provider for
  main and read-only timelines. Rows retain RN Pressables; the selected popup mounts on demand.
  Popup state does not flow through the row context. Active estimates update; row removal,
  dismissal and window/scale changes invalidate selection. Measurement requests and retiring
  popup callbacks are fenced by request identity.
- Timeline slicing and row rendering both called full turn presentation preparation. Content
  preparation is now reused for the same immutable timeline-row snapshot, independently of
  search and action intent. The cache retains at most 64 snapshots, matching the existing turn
  projection working-set budget. Streaming, completion and hydration publish new row snapshots.

The code retains existing lazy activity details, Markdown caches, image previews and animation
policy. No generic popup behavior or lower protocol/cache authority was changed.

## Verified contracts

- Thirty closed cost triggers mount zero Compose hosts; opening or switching owns one popup.
- The open body receives updated estimates. Second tap, native dismissal, source removal and
  window resize close it. Reordered measurements and an old popup dismissal do not restore or
  close a newer selection. Reopening uses newly measured anchor coordinates.
- Changes parses no diff before a press, then opens the latest recorded patch with correct file,
  addition/deletion and target data.
- Thirty slice presentations plus initial preparation perform one source-wide artifact pass.
  Changing search/fork/request intent preserves the shared content preparation. New source
  snapshots update text, completion and hydrated search results. Distinct scopes remain distinct;
  cache eviction and replay preserve the semantic result.

These are render/operation-budget checks, not device frame-time measurements. No FPS or end-to-end
speedup claim follows from them.

## Validation

- `pnpm validate:android:v1`: passed, including 290 V1 and 137 shared render tests.
- `pnpm --filter @codewide/android compile:android`: passed.
- Focused Vitest: 41 tests passed across `turn-presentation-preparation`,
  `turn-item-projection-cache`, `timeline-markdown-rows`, `thread-render-window`, `turn-sequence`.
- `git diff --check`: passed.

Physical Samsung verification remains pending: scroll a tool-heavy history, compare frame time
and JS work, measure first-open latency for a large patch and cost popup, exercise live cost
updates, popup anchoring, rotation, outside tap/Back, and main/subagent navigation. The public
native boundary is mocked in render tests; those tests do not prove Compose popup placement.

## OTA publication

Published at Sergey's request on 2026-09-22 through `./scripts/release-ota`, from an isolated
checkout containing the preceding table release plus these message optimizations. Concurrent
hands-free and composer work was excluded. No commit or push was made.

- Update: `18048785-8ad6-4e92-a856-6932d1151a6d`.
- Runtime: `0.2.184-native-197`.
- Created: `2026-09-22T17:32:35.530Z`.
- All release gates passed: 289 V1 render, 137 shared render and 1872 Vitest tests,
  OTA server checks and security scans.
- The release runner verified the public manifest, downloaded launch-asset hash and
  no-update response for the published ID. Device installation remains unverified.
