# CodeWide chat UX contract

This is the V1 acceptance contract for phone and fold layouts. It favors stable reading and fast navigation over decorative chat chrome.

## Adaptive structure

- Choose layout from the current window width, not a device label.
- Below 840 dp, show one task at a time: thread list or selected thread.
- At 840 dp and above, use list-detail: server rail, thread list, selected thread.
- Preserve selected server, thread, draft, expansion state, and scroll position across window changes.
- Draw backgrounds edge-to-edge; keep controls and scroll content inside system and IME insets.

## Timeline behavior

- A turn is one user bubble plus one agent bubble. Completed internal activity is collapsed by default.
- Streaming updates may follow the bottom only while the reader is already following it.
- Starting a drag immediately enters reading mode. No content-size update may steal the gesture.
- Return to follow mode only after drag or momentum settles at the bottom, or after an explicit jump-to-latest action.
- New content while reading history must not move the viewport. Show one compact jump button with an optional count badge.
- Initial open starts at the bottom. Warm reopen restores the previous distance from the bottom.
- Older turns load only from an intentional upward interaction near the top. Prepending must preserve visible content.
- Expansion state lives outside virtualized rows and is keyed by stable server/thread/turn/block identities.

## Composer and IME

- The one-line composer and its menu/send controls share a 48 dp baseline.
- The field grows with content up to a bounded maximum, then scrolls internally.
- IME appearance resizes the conversation; if the reader was following the bottom, keep the latest turn visible.
- Never stack a second safe-area gap above the keyboard.
- Sending, recording, transcribing, stopping, and failure always have visible state and a non-gesture action.

## Sheets and menus

- Use the native Material bottom sheet for compact-window supporting tasks.
- Open long sheets at a useful partial height; allow expansion to at most 94% so context and dismissal remain clear.
- Sheet content scrolls inside the sheet and includes the navigation-bar inset.
- Frequent actions use recognizable icons plus accessible labels. Destructive actions remain explicit and text-labelled.
- On expanded windows, supporting UI stays bounded and must not become a mostly empty fullscreen canvas.

## Rendering and performance

- Keep stable list keys and memoized heavy turn renderers.
- Do not clip variable-height rich messages on Android; keep enough offscreen window to avoid blank flashes during fast scroll.
- Process streaming updates incrementally and avoid setting React state on every scroll frame.
- Do not announce every streamed token. Announce completed states or accumulated new turns politely.
- Unsupported blocks remain visible with a one-tap action to create a fixing thread.

## Accessibility

- Every action has at least a 48 by 48 dp target, directly or through hit slop.
- Icon-only actions have a meaningful accessibility label and visible pressed feedback.
- Swipe actions always have an equivalent button or menu action.
- Sequential chat updates behave like a polite log: they do not move focus or interrupt reading.
- Text and links remain selectable; images have a private authenticated preview and a useful description.

## Primary references

- Android canonical layouts: https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts
- Android window size classes: https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes
- Android edge-to-edge and insets: https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge
- Android keyboard handling: https://developer.android.com/develop/ui/views/layout/sw-keyboard
- Android accessibility: https://developer.android.com/design/ui/mobile/guides/foundations/accessibility
- React Native FlatList: https://reactnative.dev/docs/flatlist
- React Native list performance: https://reactnative.dev/docs/optimizing-flatlist-configuration
- WAI-ARIA log pattern: https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23
