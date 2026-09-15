# V1 queue

Queue list presentation, reorder/steer intents and list visibility.

Public surfaces: QueueFeature, InlineQueueOverlay, inlineQueueContract, queueVisibility, queueCommands.

The lower delivery owner owns QueuedPrompt. The existing server queue and command ids remain authoritative. Mounted measured cards and Reanimated shared values survive expand/collapse. Failed commands restore animation and expose action errors; queue editor state/upload admission remains the pending M5 composer owner.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; inline-queue-overlay; queue-event; queued-input; v1-request-queue-actions.render. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

`InlineQueueItem` renders one measured card and its action menu; InlineQueueOverlay retains list ordering, existing animation placement and the state hook. The card receives the original owner references and captures optional callbacks before deferred activation.
