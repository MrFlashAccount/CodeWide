# V1 ports

Public surfaces: PortsFeature selects native forwarding or the explicit legacy tunnel; ComposerPortContextChip displays retained profiles; nativeForwardingAdapter binds the existing native store; loopbackNavigation owns qualified loopback intents. The owner receives an `openBrowser` callback and invokes it only after it has resolved a live forward or authenticated tunnel. Ports must not import or mount browser UI, navigation state, feedback or developer-tools implementations.

Port list projection, profile action pending/errors and manual form admission have private owners. Runtime profiles remain in native-port-forwarding-store; no chat-owned sessions are constructed. Existing native forwarding, HTTP authentication and opaque tunnel contracts remain authoritative.

M4 ports/browser: V1 native/web/compatibility typing, ESLint and dependency gate passed (2224 modules, 7840 dependencies). 67 focused tests and seven render cases passed, including port exclusion/error recovery and native navigation-reference retention. Actual Android forwarding, WebView/CDP inspection, screenshot capture and same-device behavior remain unverified.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

Browser rendering and developer tools belong to `features/browser`; ports supplies destinations through the injected capability only.

Native profiles follow the Companion's pushed inventory. Applying an inventory never fails as a whole: each port settles on its own, and default-forwarded ports beyond the phone's profile capacity (64, one listener socket and accept thread each) get no automatic profile and stay in Available to enable by hand. The composer chip counts exactly the sheet's active forwards (neither excluded nor unavailable). An inventory the phone failed to apply stays a scan error until a newer one applies; the Companion resends only on change, so it must never read as a pending scan.
