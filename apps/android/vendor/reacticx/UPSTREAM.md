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
navigation reset. Visuals, thresholds and ordinary-mode motion remain
upstream-owned.

Source files:

- `src/components/organisms/tray/**`
- `src/components/organisms/masked-tab-bar/**`
- `src/utils/create-compound-component/index.ts`

The upstream MIT license is preserved in `LICENSE`. Run
`pnpm sync:reacticx` from `apps/android` to mechanically regenerate the
application artifacts at `src/vendor/reacticx/tray.js` and
`src/vendor/reacticx/masked-tab-bar.js` without modifying generated output.
