# Android bug batch — 2026-08-12

This is the durable implementation and verification checklist for the current
device-test batch. An item is complete only after the implementation is covered
by an automated check where practical and the relevant release/runtime has been
published for device verification.

## P0 — connection, input and server isolation

- [x] Let `turn/interrupt` bypass an accepted `turn/start` in the same thread
  delivery lane; after Stop, reconcile that lane immediately so a follow-up
  cannot remain queued forever behind the turn it just stopped.
- [x] Keep the post-Stop follow-up visible through the short JS-to-native
  handoff, then let the Kotlin outbox projection own queued, uncertain and
  failed delivery state.
- [x] Scope queued prompts by connection and thread; clear the visible queue
  synchronously when either scope changes.
- [x] Verify queued prompts from server A never remain visible or actionable
  after switching to server B.
- [x] Bound credential and socket connection attempts; recover a stale native
  `connecting` state on app foreground instead of waiting indefinitely.
- [ ] Verify cold start, force-stop start, background/foreground and server
  switch all reach `live` or an actionable error without a permanent spinner.
- [x] Remove the remaining `Connection did not recover within 30 seconds` path
  as a normal user-visible failure; reconnection must continue in background and
  expose the current attempt/error diagnostics.
- [x] Make IME layout follow the real window/visual viewport in full-screen,
  split-screen, Samsung freeform and focus transfer to another window.
- [x] When the keyboard disappears because another window receives focus, return
  the composer to its closed position without requiring another focus cycle.
- [x] Keep the composer one line after the first glyph; grow only when measured
  content actually wraps or contains a newline.
- [x] Disable Send when the draft and attachment list are empty; keep Stop
  visibly enabled while a turn is running.

## P0 — timeline and expanded tool content

- [x] Keep inline image blobs out of summary, pagination, activity and live
  event frames. Project trusted Codex attachment paths as authenticated
  `localImage` references; never send multi-megabyte data URLs through Hermes
  and the TanStack SQLite UI cache.
- [x] Reset the poisoned v2 thread-detail cache on the next JS release so an
  already-persisted inline blob cannot freeze the UI before the repaired host
  page replaces it.
- [ ] Verify on the affected Samsung thread that the formerly 2.39 MB turn
  paginates as a compact private-image reference and the UI stays interactive.
- [x] Expanded tool calls must invalidate the virtual row measurement exactly
  once and never overlap or cover adjacent turns.
- [x] Diff cards must have bounded height and width inside a turn; expanding,
  collapsing and streaming updates must not produce a one-frame size jump.
- [x] Remove accidental horizontal gesture capture from diffs; long lines must
  wrap or clip within the diff viewport without fighting the chat scroll.
- [x] Keep activity counts correct while details are lazy: collapsed activity
  must never say `0 activities` merely because item bodies were not fetched.
- [x] Do not render a late copy button inside expanded reasoning/tool headers;
  expansion must not shift the title.
- [x] Copyable text blocks size to content up to their max height; they must not
  reserve a fixed 400 px or escape the agent bubble.
- [x] Expanded tool results cap at about 400 px and use one internal vertical
  scroll surface.

## P1 — file changes and paths

- [x] Display changed-file paths relative to the thread cwd when the path is
  inside that cwd; do not rewrite unrelated absolute paths.
- [x] File paths are always one line with middle ellipsis and a visible basename.
- [x] Diff headers keep kind/add/delete counters stable and never wrap to an
  incomplete second line.

## P0 — dictation

- [x] Remove the 1 MiB curl stdout failure that causes
  `ChatGPT transcription response is too large` for long recordings.
- [x] Support at least 30 minutes, target 60 minutes, without holding duplicate
  PCM, WAV and multipart copies in memory.
- [x] Store long recording chunks in a private temporary file, stream the upload,
  and remove it on finish, cancel, disconnect, timeout and shutdown.
- [x] Scale transcription timeout to recording/upload size while retaining a
  finite failure bound and cancellation.
- [x] Add regression tests for large transcript responses and long recordings.

## P1 — bottom sheets and nested navigation

- [x] A partially expanded sheet scrolls only its visible content viewport.
- [x] A fully expanded sheet has exactly one bottom safe-area inset and one
  vertical scroll owner; remove the double-scroll and bottom beard.
- [x] Opening Files, Queue, Goal, Review, Terminal, Tunnel or Fork from Controls
  navigates within the same sheet surface instead of destroying one modal and
  creating another.
- [x] Every nested sheet page has a consistent back arrow; close always
  dismisses the entire stack.
- [x] Add a short deterministic horizontal page transition that does not change
  measured sheet height or reintroduce the previous wobble/content jump.

## P1 — thread actions and icons

- [x] Use the native anchored menu beside the thread header for Rename, Pin or
  Unpin, Archive or Unarchive and Delete; do not open the current action sheet.
- [x] Rename opens a focused rename input flow and returns to the thread after a
  successful update.
- [x] Use a pushpin/thumbtack icon everywhere; never use a map-location pin.
- [x] Remove the duplicate direct header pin affordance; Pin or Unpin lives in
  the anchored thread menu and reflects the current state.

## P1 — previews and hidden Codex metadata

- [x] Thread-list subtitle is a plain-text rendering of the latest message, not
  raw Markdown and not the first message.
- [x] Reuse the latest-message summary/cache when opening the last page without
  replaying stale messages one by one.
- [x] Replace unread count badges with a compact unread dot that cannot cause
  title truncation.
- [x] Hide transport-only sections such as `Files mentioned by the user`,
  `My request for Codex` wrappers and ambient in-app-browser context.
- [x] Preserve the actual user request and render legitimate attachments in the
  message attachment grid after removing the transport wrapper.

## P1 — rich content

- [x] Give Markdown tables a useful minimum width on phones and allow horizontal
  table scrolling without shrinking columns below readability.
- [x] Confirm Mermaid support from the actual AST/renderer path.
- [x] If Mermaid is unsupported, add a deliberate diagram block with a private,
  offline rendering path or an explicit unsupported/fix action; never send
  private diagram source to a public rendering service.

## P1 — calm running motion

- [x] Replace the active tool-card spinner/status glyph with a slow light wave
  across the current activity title; keep `Reasoning` terminology unchanged.
- [x] Replace the native fast thread-list spinner with a compact 3.2 second
  custom rotation that uses the muted text color.
- [x] Replace the static `Running` footer dot with the same quiet spinner at a
  smaller size and a 3 second rotation.
- [x] Respect Android reduced-motion preference and leave a static muted
  indicator instead of running either animation.

## Release and hostile verification

- [x] Re-run the complete phone/fold/tablet interaction suite after the
  structural state refactor; prior UI fixes are regression gates, not unchecked
  historical checklist claims.
- [x] Add focused unit/static tests for every pure normalization/layout helper.
- [x] Run Android typecheck and full test suite.
- [x] Run hostile phone/fold screenshots for the renderer matrix, nested sheets,
  metadata messages, wide content and unsupported Mermaid fallback.
- [ ] Run the remaining physical-device gates: Samsung freeform keyboard focus
  transfer, partially expanded native-sheet scrolling and a real 30–60 minute
  dictation.
- [x] Re-evaluate APK compatibility: the native outbox lane fix requires the
  new `0.2.3-native-16` APK; an OTA cannot replace this Kotlin behavior.
- [ ] Publish OTA/release artifacts only after the new APK passes the device
  Stop → follow-up and lifecycle gates.
