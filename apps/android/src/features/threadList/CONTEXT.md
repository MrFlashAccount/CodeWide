# V1 thread list

This TypeScript/TSX owner coordinates catalog rows, independent global/project pages and filters, scroll offsets, row actions and desktop/mobile list presentation. `ThreadListFeature` owns the scoped recovery and Suspense boundaries. Mounted state, query coordination, projections and row equality remain separate modules; rows never subscribe the workspace shell to active-chat materialization.

Public contracts are the feature surface, layout props, thread item/source types, filter/model contracts, list state/workspace/actions, project-page coordination, the summary-to-item projection and the app-level `{ state, onToggle }` Global Voice control. Navigation consumes only item identity; search consumes the public summary conversion. Header, row, menu, style and swipe implementations remain private. The Global Voice button renders a muted gray assistant when idle and the live state while active; startup and stopping retain their disabled progress semantics. It never imports the supervisor model or transport. Existing account, project, connection, navigation, diagnostic-commit and turn-action public contracts are the only peer imports; the exact module allowlist is enforced in dependency-cruiser.v1.config.mjs.

Summary and usage database references remain the existing model owners. Their cached ranges, pinned/recent separation, pending-request projection and stable item identities are preserved. The projection retains an unchanged readonly source instead of making a pass-through copy. List state survives conversation selection. Rows render the supplied qualified destination through the neutral `AppLink` primitive. Expo Router owns transition and same-destination reuse; `onNavigate` only prepares observation, IME and timing. Active/archive/project rows share this link contract. Long press and swipe remain commands; thread rows do not start data loading from `onPressIn`. A command starts before swipe close. Pin/archive/read commands remain lower-authority operations; only list selection cleanup is local.

M2 checks cover query limits, projection equality, navigation isolation, filter/account scope, row geometry and sidebar feedback. The V1 gate checks native/web/compatibility types, lint, acyclic imports and private/facade negative probes. Desktop/browser and native device interaction/performance smoke are disclosed separately; automated source/render evidence is not a device parity claim.

Project selection is one native-stack destination composed by `ProjectThreadListRoute` at every width.
The root list scope remains unchanged when a project opens. The workspace-owned project filters and paging are shared by the fixed header and content and
survive child routes; the shared offset memory restores each list scope. The Router-owned catalog
stack remains mounted in one pane, full width on compact layouts and left of the conversation
on wide layouts. One shared header stays above Expo Stack; root/project content scenes contain no header.
Expo Stack owns content placement and transition timing, while Orb and Search retain their native instances.

The header orb reserves a fixed hit-target slot while its floating counterpart is active.
It has no mount/unmount or layout-driven spatial animations: opening Search, switching a
project or resizing the window must not start an orb transition. Android alone owns the
activation flight to the floating overlay and the return flight to the measured header anchor.

Pagination follows the catalog owner's continuation, including unshown rows already in the merged local range; displayed row counts do not authorize or reject a page request. `threadListPageRequest` retains and deduplicates end intent across asynchronous loads. `threadListViewportPaging` uses native layout/content measurements to fill an undersized viewport, stops at exhaustion or failure, and owns no fetch effect. During drag/momentum, `threadListScroll` freezes existing order but admits newly loaded tail rows. Catalog membership is decided by Companion, never by a local supervisor binding.

Idle native thread rows mount no Compose hosts or menu-item trees. `ThreadRowMenu` measures the RN row only on long press, then mounts a separate anchored Compose popup without reparenting the visible trigger. Its keyed lifetime follows the qualified thread identity so recycling cannot retain an old popup or redirect a pending measurement/action to another thread. Native popup dismissal removes the host. Web rows retain their sheet; swipe gestures and command-before-close ordering remain unchanged.

Responsive business contract: initial catalog publication and width changes never select a
thread. Only explicit selection does. Project paging and offset memory use one qualified
project/mode key across mobile route and desktop sidebar presentations. Wide project/filter
changes retain the selected conversation; project navigation targets the existing catalog stack without changing conversation focus.

The unread slot prioritizes a raised-hand icon for current pending requests, waiting flags and observed async questions. Opening a thread does not resolve that attention. The unread state is retained and reappears after attention clears. This owner consumes summary metadata without loading chat history for each row.
