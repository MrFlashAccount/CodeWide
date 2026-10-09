# V1 goal

Goal resource selection, explicit editing, and user-owned pause/resume lifecycle control.

Public surfaces: GoalFeature, ThreadGoalMenu, ThreadGoalChip, LiveTurnPlanMenu, goalResource, goalCommands.

The compact Goal/status chip is first in the composer's shared context row. Its anchored native popover shows the full objective immediately. The reader follows measured content height, capped only for long text; an explicit adaptive viewport preserves the Compose/RN sizing boundary. Objective text is ordinary non-selectable reading content so Android does not turn it into a keyboard-focus target with default focus chrome; text selection and editing belong to composer. There is no disclosure or reserved empty reader. Status and authoritative accumulated time share one quiet line; the existing status shimmers while a lifecycle command is pending. The header uses the title typography role and icon-only Pause/Resume, Edit and destructive Stop actions with 48dp square touch targets, centered feature-local vector glyphs and accessible labels. There is no footer action bar or duplicate close action: native Back, outside dismissal and the trigger close the popover. Edit closes the popover and loads the objective into the resident composer with the removable Goal attachment. Send updates the existing goal, preserving lifecycle status and budget; it does not create a user turn or imply Resume. The old route-owned form is not the chip's editing path.

Pause publishes `paused` before interrupting the captured current turn and retains the goal for Resume. Stop performs the same pause/interruption before clearing the goal. A failed pause or interruption preserves the goal and surfaces its error in the popover; a failed clear leaves the paused goal available for retry. Every multi-step action captures connection/thread-qualified goal commands and the exact turn before awaiting. The popover owns its transient Legend interaction state; goal data remains in the lower resource database. The compact trigger has a numeric window-width bound and no percentage sizing inside Compose's intrinsic measurement.

The lower workspace resource database owns the goal row and ThreadGoalInput. The stable resource key and existing async resource cache own loading. Status-only updates preserve the authoritative objective and budget: active goals can be paused, and paused or blocked goals can be resumed. Complete, usage-limited and budget-limited states remain read-only for lifecycle controls; completion stays evidence-owned rather than becoming an unchecked user transition. Composer owns goal drafting, cancellation, submission recovery and edit errors; popover owns lifecycle controls.

The composer stop flow receives one narrow pause capability only while the selected goal is active. It must publish `paused` before interrupting the current turn so the idle boundary cannot admit another automatic continuation. If pausing fails, the turn is not interrupted and the real error remains visible.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; goal-editor; thread-goal-chip.render. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
