# V1 projects

This TypeScript/TSX owner handles project catalog selection/order/pinning, directory browsing, new-chat draft choice and project changes before the first message. The lower remote-project model, preference persistence and shared catalog resource remain authoritative. No project feature starts transport or creates a replacement cache.

Public entrypoints are ProjectPickerSheet and its input contract; projectSelection/projectWorkspace, activeProjectSelection and composerProjectSelection; NewThreadServerSheet/NewThreadFloatingButton; and SidebarProjects/sidebarProjects presentation contracts. Router owns the former mounted picker and new-thread destination composition. Picker sessions, row projection, management state, leaf views and styles are private. Peer imports are limited to public connection display and navigation contracts.

Workspace selection and sheet state survive ordinary chat changes. Each picker retains its open/reset behavior, stable home/directory resource keys and errors; directory loads happen through the existing render resource. Project sections retain pinned/recent/other order and expansion. Pending management changes remain owned by that mounted sheet. New chat opens a local draft and counter identity; remote creation still belongs to first submission. Changing an existing empty thread checks both turns and queued messages, selects the replacement before deleting the old thread, and preserves failures.

Composer picker state uses the existing conversation-scope reset and activation owner. A completed change cannot close or clear a replacement activation's picker. Lower workspace support, catalog and directory capabilities retain the same qualified keys and completion behavior.

M2 evidence includes project routing/order/catalog/workspace tests, management render tests, stale project-completion render coverage and the V1 gate. Native folder selection, actual new-chat submission and device back-navigation smoke remain explicitly pending.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

`newChatSubmission.ts` owns first-send orchestration: isolated workspace creation precedes thread admission, and navigation follows successful send admission. Rejection preserves the current draft. `projects-workspace-adapter.test.ts` and `new-chat-submission.test.ts` verify this ordering and identity-preserving current-workspace options.
