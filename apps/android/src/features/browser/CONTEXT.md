# V1 browser

This feature owns the chat browser chip, responsive tab manager/strip, retained full-width sheet,
page navigation/recovery, developer tools and explicit feedback flow. `ComposerBrowserContextChip`
resumes the selected page or local Home in the current `(connectionId, threadId)` catalog through
the injected browser capability. It does not open the tab manager on entry.
It does not attach URLs, titles, page content or screenshots to the composer.

`services/browser/browserTabCatalog.ts` owns process-local catalogs scoped to the exact server/chat
pair. `BrowserTabsModel` owns order/selection; `BrowserTab` owns private destination/last metadata.
No tab URLs, credentials, page content or history are persisted to disk or sent to Companion.
The existing private route registries retain opaque Router session IDs. Unpresented catalogs have
the existing idle expiry; a retained browser host leases every opened chat catalog until teardown.
There is no logical tab-count limit. Native page-memory behaviour requires device validation.

`BrowserWorkspaceHost` lives in the persistent workspace shell, above its destination stack.
Both scene container and browser host retain native View boundaries: clipped scenes use layer 0,
browser uses layer 1, preventing descendant header layers from becoming browser peers through
View flattening. The persistent host retains React ownership; the browser uses a native Expo Material sheet window when its browser-specific native boundary is available.
On phones, navigation/manager row plus grip uses 60dp (48dp controls, 12dp rail), just above the
conversation's 56dp header. Geometry, colors and typography use project tokens.
Router's browser route activates/deactivates `browserPresentation`; dismissing it collapses the
surface and retains mounted chat pages, selection and native history. Switching tabs retains the
other WebViews. Closing a tab unmounts only that page. Workspace teardown clears retained models.
Standalone destinations without a chat identity are transient and disappear on dismissal.

`BrowserSheet` always opens fully, with only a centered grip and no browser-close control.
Expo Material owns native opening, swipe animation and the sheet's corner shape. The body has no
second rounded/clipped surface; the Expo host is bounded to its workspace viewport.
`BrowserSheetContentView` protects the whole
body, including WebView, Home, tab manager, navigation and empty regions: it prevents upstream touch
interception and disables the body RNHost's nested scroll/fling handoff throughout attachment. The
grip has its own RNHost outside this boundary. Other sheets keep their default gestures.
The Expo adapter removes only the Compose window on collapse, retaining React-owned children and
RNHost wrappers. Each opening receives fresh Compose presentation state; native dismissal/Back
events carry an opaque presentation ID so delayed events cannot collapse a newer presentation.
Older APKs without this boundary retain the existing grip-only Reanimated compatibility sheet.
An accessibility action offers collapse without requiring a drag. The transparent Router entry
disables native stack gestures and leaves the previous application screen visible while dragging.
At widths below 600dp, navigation contains a tab counter opening a grid/list manager. Wider layouts
show the tab strip above navigation and expose the manager through the navigation menu, without a duplicate counter. The manager retains the page views and closes tabs explicitly;
closing the last page tab replaces it atomically with a new local Home tab. The sole Home cannot
be closed; additional Home tabs may close. Presentation admits one real Home for an empty catalog,
while explicit workspace teardown may still clear the model.
Explicit new tabs have a local Home source; entering an address creates that tab's first WebView
without replacing its identity. Home is React Native content, not an about:blank document or request.
Every plus entry point uses the workspace's create-and-show-page action. An empty catalog's latent
manager intent must not turn creation from the wide strip into an implicit switch to Tabs.
The initial grid shows title/host cards; actual screenshot thumbnails are not implemented.

`ui/WorkspaceTab`, `WorkspaceTabStrip` and `WorkspaceTabsEmptyState` own shared browser/terminal
tab chrome only. Browser adapters retain selection, closing and catalog scope. Strip, grid and list
share neutral selected surfaces and explicit keyboard focus; close and select are
separate targets. Browser tabs opt into compact chrome with whole-surface press feedback and no
selection underline. Their strip delegates its joined outline and bottom shoulders to the noninteractive
`BrowserTabContour`; the shared tab exposes a render-decoration slot and retains input ownership.
Close glyphs use normalized font padding and line height; terminal geometry remains unchanged. Grid cards reserve a top control row so
titles and hosts retain their full width.
Accessible tab names include title and host to distinguish pages on the same site. Favicon bitmaps come from the loaded Android WebView through a narrow native getter. No extra
favicon requests or page snapshots are introduced. Terminal resource/status policies remain terminal-owned.

The address field shows host and port outside editing, and the complete current URL when focused;
redirects cannot overwrite an in-progress draft. Address editing restores a 240ms width/position layout transition with a zero-duration
reduced-motion path; toolbar height remains fixed. Wide Forward appears only in navigation; the menu contains Forward only on phones. On phones Reload/Stop lives in the Browser menu,
leaving room for the address. Wider layouts retain its direct navigation control. Home preserves
its navigation controls in their disabled state, rather than removing the controls when tabs change.
The browser overflow passes its known 48dp trigger bounds to the native menu host; popup rows cannot
set the toolbar's intrinsic width or height. Other native menus retain content-sized hosts by default. Both entry points
use the existing recovery handler, including renderer recreation.

Ports owns qualification, forwarding and legacy tunnel creation. It invokes injected `openBrowser`
for immediate destinations and `openBrowserInThread` for a captured asynchronous loopback intent.
Browser components never create tunnels or forwards. Composition injects Ports-owned Home content
for the catalog's captured connection. It shows live forwards in a grid/list with the same inventory
categories and service icons as Ports; unmatched manual forwards have their own category. It opens the current
resolved URL in the Home tab and rechecks the profile at tap time. Home handles actionable taps
while the address keyboard is visible. Missing inventory metadata cannot reclassify a discovered
service as a manual forward; known service categories and names remain inventory-owned. It never borrows a mutable
current-chat connection or starts/stops a forward. The Browser chip sits in ConversationTools' actual context row after Ports.

`browserPageSession` validates native navigation and supports HTTP(S) URL popup handoff through
react-native-webview's existing `onOpenWindow`. Unsupported schemes are blocked locally rather than
sent to OS handlers. Popup pages receive no caller headers; explicit navigation keeps those headers
only for their original origin. This wrapper provides URL handoff, not native child adoption:
`opener`, POST-target windows, blank windows populated with document.write and window.close are not
implemented. These require a native WebViewTransport integration, not URL extraction.

Loading uses native WebView progress in a thin track under navigation; no page-loading panel is
rendered. Server response and native error content stay in the WebView, without app-owned network
or HTTP overlays. Action notices remain local to unsupported links/inspection. A lost renderer is
replaced on navigation Reload; events from its discarded native target are ignored. DevTools and
element selection live in the navigation overflow menu.

Native WebView, CDP and screenshot bridges remain lower platform authorities. `BrowserInspectionSession`
fences delayed discovery/capture to the active page; `devToolsLease` shares bridge retention across
inspectors/captures. Switching/collapsing cannot present a delayed result in another tab. Feedback is
still an explicit select/review/send interaction through the existing validated capability.
The DevTools document-start bootstrap connects the late-created frontend host
`InspectorFrontendHost.closeWindow` to a validated close UI message. That message closes only
the owning inspector, releasing its lease and clearing its pane state; reopen remains supported.

Automated model/render checks verify isolation, close/selection, collapse retention, URL popups,
credential separation, scheme blocking, retry/recreation and inspection races. Android WebView
runtime/popups, renderer recovery, keyboard/native stacking and memory pressure are device-unverified.
`test/browser-workspace-layout.browser.test.mjs` verifies full workspace Home/plus transitions and
available content geometry; its sheet boundary is a fixture, not native-window proof.

The Expo UI patch adds opt-in controlled visibility, maximum width and presentation-qualified
events; omitted props preserve the default behavior for other consumers. The community sheet wrapper
is not used because it removes children on hide. Native-sheet gestures, retained AndroidView
reattachment, window stacking and opening animation still require device validation. `BrowserFaviconBridge` reads `WebView.getFavicon()` by the
validated native target on the UI thread, checks the current URL and briefly retries a missing icon
after page completion. The bounded PNG lives only in the owning tab. Navigation, close and renderer
replacement revoke delayed reads; older APKs fall back to a neutral icon. Live changes to a favicon
after this short read window are not subscribed to. Native view lookup/favicon delivery still need
device verification.
