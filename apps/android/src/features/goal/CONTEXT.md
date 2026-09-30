# V1 goal

Goal resource selection, explicit editing, and user-owned pause/resume lifecycle control.

Public surfaces: GoalFeature, ThreadGoalChip, LiveTurnPlanMenu, goalResource, goalCommands.

The lower workspace resource database owns the goal row and ThreadGoalInput. The stable resource key and existing async resource cache own loading. Status-only updates preserve the authoritative objective and budget: active goals can be paused, and paused or blocked goals can be resumed. Complete, usage-limited and budget-limited states remain read-only; completion stays evidence-owned rather than becoming an unchecked user transition. The dialog owns validation plus save, lifecycle, clear pending and error behavior.

The composer stop flow receives one narrow pause capability only while the selected goal is active. It must publish `paused` before interrupting the current turn so the idle boundary cannot admit another automatic continuation. If pausing fails, the turn is not interrupted and the real error remains visible.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; goal-editor; thread-goal-chip.render. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
