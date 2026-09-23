# Table viewport resizing

## Root cause and contract

Without a `RichContentWidthProvider`, Markdown measured its table viewport, then wrote that
measurement back as an explicit width. This retained portrait width in landscape. A transient
narrow parent allocation permanently pinned the viewport to that narrow width. Unmounting via
transcript virtualization discarded the stale local state.

`useTableViewport` now separates the parent allocation from measured scroll-content width.
An explicit pane allocation is respected for document viewers and nested content. Otherwise the
viewport remains parent-relative (`100%`); measurements affect only columns. Minimum readable
column widths and horizontal scrolling remain intact.

HTML tables previously used minimum-width columns whenever pane context was absent. They now
use the same viewport contract; existing cell callbacks reflow row heights. Markdown rows/cells
also use their append-only grid coordinates as keys: the parser can omit their source offsets,
and the prior fallback generated duplicate sibling keys. This remains table-local and preserves
existing rows while the streaming tail grows.

## Coverage

- Completed and streaming Markdown: repeated portrait/landscape and window widths, including a
  transient 4 dp allocation; mounted cell identity survives width changes.
- Nested quote/list and pane-provided widths: preserve insets and update allocation.
- Streaming append with repeated text: no duplicate rows or React key errors.
- HTML with/without pane context: columns and measured row heights grow and shrink.
- `MarkdownDocumentView`: viewport and reader maximum-width changes reach an existing table.

Chat, live replies, response sheets and attachment/document previews share these renderers.
This is not separate end-to-end verification of every enclosing screen. Code blocks, inline
media and diagram viewport owners were inspected for the same measured-width feedback; this
particular feedback was found in Markdown tables. No generic layout/list remount was added.

## Android experiment

An isolated API 35 emulator harness rendered production Bubble, Markdown, HTML table and quote
components with synthetic content. Old Markdown reproduced stale portrait width after rotation.
A 28 dp parent allocation (4 dp content after padding) followed by full-width restoration left a
narrow strip. The fixed mounted table recovered immediately. Markdown, HTML and nested quote
tables were also checked through rotation and window-size changes. This is emulator evidence,
not a physical Samsung/freeform test.

Local artifacts: `/var/tmp/codewide-table-probe`,
`/var/tmp/codewide-table-original-landscape.png`,
`/var/tmp/codewide-table-original-restored.png`,
`/var/tmp/codewide-table-fixed-restored.png`,
`/var/tmp/codewide-table-all-portrait.png`,
`/var/tmp/codewide-table-window-narrow.png`.

## Validation

- `pnpm --filter @codewide/android test:markup --runTestsByPath test/rich-markdown-resize.native.test.tsx`
- `pnpm validate:android:v1`
- `pnpm --filter @codewide/android compile:android`

Full `test:markup` exposes an unrelated existing attachment-grid expectation:
`native-markup.native.test.tsx` expects `alignSelf: center`, while `MessageAttachmentTile.tsx`
uses `flex-start`. Neither that test nor that component was changed.
## OTA publication

Published at Sergey's request on 2026-09-22 through `./scripts/release-ota`:

- Runtime: `0.2.184-native-197`.
- Update: `ea52d31b-8722-6b5c-1e4e-fa30a1a4a7ea`.
- Public manifest, launch-asset hash and no-update response verified by the release runner.
- An isolated checkout preserved the validated table changes and excluded concurrent hands-free
  work. No commit or push was made.

Release validation also replaced the obsolete table source-text assertion with the existing
mounted-render coverage, corrected the release planner's macOS baseline expectation, and made
the OTA server integration test create its own temporary signed fixture instead of requiring
an old published update. All release gates passed; physical Samsung verification remains pending.
