# Reacticx components

Vendored from `rit3zh/reacticx` commit
`ca19ee82ee4ae29da5892f97452ec0b60549d65a`. The Tray has one Android host
compatibility patch: its React Native `Modal` content owns a nested
`GestureHandlerRootView`, because a modal is a separate native window and the
application root cannot activate gestures inside it. Drag-to-dismiss also
stays enabled when reduced motion is requested; the existing immediate-settle
path removes animation without removing the interaction. Retained callbacks in
the Tray root and navigation hook use CodeWide's `useEvent`, so gesture,
context, native and scheduled callbacks keep a stable identity while reading
the latest render values. An incoming `Tray.View` mounts synchronously when it
becomes active; retained state owns only the outgoing view's exit animation, so
the sheet cannot measure and present a handle-only intermediate layout after a
navigation reset. Presentation starts one committed frame after the initial
measurement, so the UI thread receives the sheet height and off-screen travel
before it starts the entrance spring instead of snapping from provisional
bottom geometry. Closing before the first layout now unmounts immediately,
and a versioned close completion cannot unmount a later presentation. The
full-screen backdrop hit target is independent from the animated scrim, so an
outside press remains actionable throughout presentation. Presentation keeps
the upstream spring, while dismissal uses a bounded 180 ms timing: the native
Modal therefore releases input when the visible exit finishes instead of
waiting for a spring's imperceptible tail. A React Native
`KeyboardAvoidingView` owns keyboard overlap inside the Modal window, keeping
the bottom-anchored tray above the IME without a feature-local keyboard model.
Visuals, thresholds and ordinary-mode motion remain upstream-owned.

Source files:

- `src/components/organisms/tray/**`
- `src/components/organisms/masked-tab-bar/**`
- `src/utils/create-compound-component/index.ts`

The upstream MIT license is preserved in `LICENSE`. Run
`pnpm sync:reacticx` from `apps/android` to mechanically regenerate the
application artifacts at `src/vendor/reacticx/tray.js` and
`src/vendor/reacticx/masked-tab-bar.js` without modifying generated output.
