# V1 goal

Goal resource selection and explicit editing.

Public surfaces: GoalFeature, ThreadGoalChip, LiveTurnPlanPopover, goalResource, goalCommands.

The lower workspace resource database owns the goal row and ThreadGoalInput. The stable resource key and existing async resource cache own loading. Dialog key, voice scope, validation, save/clear pending and error behavior remain unchanged.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; goal-editor; thread-goal-chip.render. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
