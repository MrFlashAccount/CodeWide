# V1 turnActions

Qualified thread mutation intents and header/rename presentation.

Public surfaces: ThreadActions, ThreadRenameDialog, threadRename, turnActions, turnActionCapabilities.

Header and list call the same lower mutation authority. Selection cleanup follows successful mutations; fork publishes the returned qualified id. Copy feedback and rename pending/error behavior retain their original lifetime.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; thread-fork; thread-rename-dialog.render; native-app-config. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
