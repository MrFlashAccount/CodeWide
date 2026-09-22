# V1 terminal

Public surfaces: `app/(workspace)/threads/[connectionId]/[threadId]/terminal.tsx` retains the fullscreen presentation beyond the opening conversation mount; `TerminalWorkspace` renders the route-owned activation; `terminalActions` opens or explicitly creates tabs and closes the captured workspace after successful thread deletion; `backgroundTerminals` presents process resources; `ComposerTerminalContextChip` reads the retained native store.

Private TerminalTab owns native rendering synchronization, PTY offset acknowledgement and fullscreen layout reconciliation. interactive-terminal-store and native session/transport implementations remain authoritative. Minimize never closes tabs or releases the native persistent session. Background termination remains pending through its activation-captured refresh, with an error on failed refresh.

M4 terminal: V1 gate passed (2233 modules, 7880 dependencies), 64 focused tests and one hook render test passed. The full component render attempt could not initialize Expo EventEmitter in Node; the real action hook was exercised separately. Actual Android PTY/WebView, keyboard geometry, tab persistence and minimize/reopen remain unverified device scenarios.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
