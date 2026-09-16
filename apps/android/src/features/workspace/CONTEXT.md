# V1 workspace composition

`app/v1/V1WorkspaceRouteComposition.tsx` owns the top-level composition of existing V1 feature capabilities. `V1WorkspaceShell` preserves desktop/mobile layout and the persistent thread-list chrome while Expo Router owns destination history. `WorkspaceConversationProviders` preserves the native conversation shell. Private views add no transport or persistence policy.

`createWorkspaceFeatures.ts` constructs feature adapters once and returns stable owner-qualified references. It contains no command algorithms or reactive aggregate. `useWorkspaceRuntime.ts` subscribes to the existing runtime snapshot; it does not start, fetch, hydrate or dispose resources. Public peer entrypoints are `WorkspaceConversationProviders`, `workspaceListBindings`, `workspaceProjectBindings`, `useV1WorkspaceDeepLinks`, and `useWindowLayout`. Adapter factories may be imported only by the exact workspace composition factory or their own feature.

The module import chain preserves JS singleton startup. Boot controls the separate native handle; feature unmount and native stop do not dispose databases/controllers or clear shared caches. Main-chat navigation publishes cached content or a local skeleton immediately, composer restoration precedes editing, and history fills progressively. Subagent selection retains its Transition.

M7/M8 verification includes native/web/compatibility typing, the full Vitest run, runtime/command/history semantic contracts, negative dependency probes and Expo exports. Native camera, sign-in, biometrics, microphone, gestures, retained native view behavior and same-device performance remain unverified; there is no release or claimed performance gain.

`workspaceListBindings` and `workspaceProjectBindings` preserve existing hook order and bind list/project owners through `workspaceBindingContract`. `V1WorkspaceRouteComposition` retains runtime/native handles and navigation lifetime; `V1WorkspaceShell` owns only shell layout and destination placement.
