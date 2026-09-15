# V1 workspace composition

TypeScript/TSX owns the top-level composition of existing V1 feature capabilities. CodeWideScreen remains the stable route export and renders WorkspaceScreen. WorkspaceScreen, WorkspaceThreadList, WorkspaceOverlays and WorkspaceConversationProviders preserve desktop/mobile layout, mounted navigation state and the native conversation shell. Private views add no transport or persistence policy.

`createWorkspaceFeatures.ts` constructs feature adapters once and returns stable owner-qualified references. It contains no command algorithms or reactive aggregate. `useWorkspaceRuntime.ts` subscribes to the existing runtime snapshot; it does not start, fetch, hydrate or dispose resources. Public peer entrypoints are WorkspaceScreen, ComposerMenuComposition and useWindowLayout. Adapter factories may be imported only by this exact composition factory or their own feature.

The module import chain preserves JS singleton startup. Boot controls the separate native handle; feature unmount and native stop do not dispose databases/controllers or clear shared caches. Main-chat navigation publishes cached content or a local skeleton immediately, composer restoration precedes editing, and history fills progressively. Subagent selection retains its Transition.

M7/M8 verification includes native/web/compatibility typing, the full Vitest run, runtime/command/history semantic contracts, negative dependency probes and Expo exports. Native camera, sign-in, biometrics, microphone, gestures, retained native view behavior and same-device performance remain unverified; there is no release or claimed performance gain.

Private `workspaceListBindings` and `workspaceProjectBindings` preserve existing hook order and bind list/project owners. `WorkspaceScreenContent` is a render factory for the existing responsive hierarchy; it adds no React mount boundary. The screen retains runtime/native handles and navigation lifetime. These private modules do not widen peer feature entrypoints.
