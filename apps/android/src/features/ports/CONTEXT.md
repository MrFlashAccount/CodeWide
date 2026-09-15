# V1 ports and browser

Public surfaces: PortsFeature selects native forwarding or the explicit legacy tunnel; ComposerPortContextChip displays retained profiles; nativeForwardingAdapter binds the existing native store; browserNavigation owns qualified loopback intents and workspace browser visibility. ForwardedLoopbackBrowser presents that workspace surface. Browser feedback context, destinations and delivery have narrow capabilities; the old workspace facade is absent.

Port list projection, profile action pending/errors and manual form admission have private owners. Runtime profiles remain in native-port-forwarding-store; no chat-owned sessions are constructed. Browser navigation retains the WebView reference through address changes. browserDevTools is the sole feature owner of the existing native DevTools bridge lifecycle for inspection and screenshots; feedback selection and pane layout consume narrow capabilities. Existing native CDP, HTTP authentication and opaque tunnel contracts remain authoritative.

M4 ports/browser: V1 native/web/compatibility typing, ESLint and dependency gate passed (2224 modules, 7840 dependencies). 67 focused tests and seven render cases passed, including port exclusion/error recovery and native navigation-reference retention. Actual Android forwarding, WebView/CDP inspection, screenshot capture and same-device behavior remain unverified.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

`browser/BrowserDevToolsPane.native` renders the existing retained DevTools WebView through a private render factory. InternalBrowser keeps hook lifetimes, navigation and target WebView; the split adds no mount boundary and preserves original keys and ref handles.
