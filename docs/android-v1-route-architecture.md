# Android V1 route architecture

Status: **approved normative target for retained workspace tabs**. This document defines the
required end state; it does not claim that the implementation or its validation is complete. Factual
implementation and gate evidence belongs in [the migration ledger](android-v1-route-migration.md).

This document is the current V1 application-navigation contract. The earlier feature extraction
remains the source ownership foundation, while Expo Router now owns application destinations and
Back history. V1 uses `connectionId`; it does not adopt V2 `savedServerId` terminology.

## Ownership model

- `app/(workspace)/(tabs)/**` owns one URL-invisible parent Tabs navigator. Its
  `(threads)/**` and `(pull-requests)/**` children own retained nested Stacks and destination
  screens. Settings, browser and drawing remain direct children of `app/(workspace)/**`.
- `src/routeComposition/**` owns workspace composition, Router operations and application Back behavior. Helpers stay outside `app/` so Expo cannot publish them as destinations.
- `src/services/**` owns cross-route resources, validated identity, commands and bounded ephemeral
  sessions. Services render no UI.
- `src/features/**` owns domain interaction and presentation. Features emit typed navigation intents
  and do not import Expo Router.
- `src/components/**` owns visual parts without product or route policy.
- `src/data/**`, `src/native/**` and rendering engines retain their existing protocol, persistence,
  cache and platform authority.

The persistent shell is split by cohesive responsibility; helper modules below live in `src/routeComposition/`:

- `app/_layout.tsx` owns framework/security providers and a `Slot`; it does not wrap the
  workspace in a second native stack. Only workspace destinations need native screen history.
- `app/+not-found.tsx` displays recovery with an explicit Open threads action while replacing
  unmatched or obsolete URLs with `/`; it never pushes the invalid address into Back history.
- `app/(workspace)/_layout.tsx` owns the serialized V1 native runtime handle;
- `WorkspaceRouteModel.ts` validates the current thread URL and adapts Router commands;
- `WorkspaceRouteComposition.tsx` binds workspace resources and route intents;
- `WorkspaceRouteThreadList.tsx` adapts route resources to the shared thread-list widget;
- `WorkspaceShell.tsx` owns the persistent providers and root `Stack`; it registers `(tabs)` and
  root surfaces without interpreting a catalog or mirroring tab selection.
- `WorkspaceTabsRouteLayout.tsx` owns the standard parent Tabs policy, retained descriptors,
  inactive-scene isolation, one shared floating bar and its presentation claim.
- `ThreadsWorkspaceRouteLayout.tsx` and `PullRequestsWorkspaceRouteLayout.tsx` each compose one
  nested Stack, its real catalog descriptor and detail slot around `WorkspaceTwoPaneLayout`.
- `WorkspaceTwoPaneLayout.tsx` owns responsive width, placement and animation only. It owns no
  Router state, product mode or feature lifecycle.
- `workspaceThreadsRouteState.ts` is the single topology adapter for project targeting and Search
  retention. It references the retained Threads navigation state; it does not copy Router state.

`CodeWideScreen`, `WorkspaceScreen`, `WorkspaceOverlays`, `ThreadNavigationModel` and
`features/navigation/**` no longer exist. There is no second selected-destination state.

## Normative route tree

```text
app/(workspace)/
├── _layout.tsx                                    runtime and root overlay Stack; registers (tabs)
├── (tabs)/
│   ├── _layout.tsx                                parent JS Tabs; backBehavior = history
│   ├── (threads)/
│   │   ├── _layout.tsx                            retained Threads Stack; anchor = (lists)
│   │   ├── (lists)/**                             / and /project/:sessionId
│   │   ├── new/**                                 /new and Threads-owned draft destinations
│   │   ├── search.tsx                             /search
│   │   ├── projects/**                            /projects and /projects/add/**
│   │   └── threads/[connectionId]/[threadId]/**   canonical conversation and child destinations
│   └── (pull-requests)/
│       ├── _layout.tsx                            retained Pull requests Stack; anchor = pulls/index
│       └── pulls/
│           ├── index.tsx                          /pulls; real catalog descriptor
│           └── [connectionId]/[pullRequestKey]/
│               ├── index.tsx                      canonical Details URL
│               └── changes.tsx                    canonical Changes URL
├── settings/
│   ├── index.tsx
│   └── servers/new/index.tsx
├── browser/[sessionId].tsx
└── drawing/[sessionId].tsx
```

Parenthesized groups do not contribute URL segments. The workspace index still owns `/` publicly;
`/legacy`, `/pair` and `/thread` compatibility entries redirect there. V1 owns the original process
deep links. The V2 route groups and generation chooser remain retired; see
[the retirement audit](android-v2-retirement.md).

### Anchor and generated-parent contract

- `app/(workspace)/_layout.tsx` registers `(tabs)` plus root settings, browser and drawing surfaces.
- `app/(workspace)/(tabs)/_layout.tsx` owns one standard JS Tabs navigator with route records named
  exactly `(threads)` and `(pull-requests)` and `backBehavior="history"`.
- `app/(workspace)/(tabs)/(threads)/_layout.tsx` exports `anchor: "(lists)"` and
  `initialRouteName: "(lists)"`.
- `app/(workspace)/(tabs)/(pull-requests)/_layout.tsx` exports `anchor: "pulls/index"` and
  `initialRouteName: "pulls/index"`.
- Route groups add no URL segments. Shared root overlays use the Router history of the active tab
  that pushed them; cold direct entry keeps stable-parent recovery without synthesizing another tab.

The production Expo-generated tree must resolve these exact parent chains:

- `/` → `(workspace)` → `(tabs)` → `(threads)` → `(lists)` → `index`;
- `/projects` → `(workspace)` → `(tabs)` → `(threads)` → `[(lists), projects/index]`;
- `/pulls` → `(workspace)` → `(tabs)` → `(pull-requests)` → `[pulls/index]`;
- `/pulls/:connectionId/:pullRequestKey` → `(workspace)` → `(tabs)` → `(pull-requests)` →
  `[pulls/index, pulls/[connectionId]/[pullRequestKey]/index]`;
- `/pulls/:connectionId/:pullRequestKey/changes` has the same Pull requests catalog parent, ends in
  `changes` and retains the sibling Threads tab state;
- `/threads/:connectionId/:threadId` → `(workspace)` → `(tabs)` → `(threads)` →
  `[(lists), threads/[connectionId]/[threadId]]`.

### Router-owned records

- `TabNavigationState` is the only active-tab and tab-history record. It retains both tab route
  records and each nested Stack state; there is no selected-mode store or synthetic snapshot.
- Catalog mapping is exact: `(threads)` maps to `threads`, and `(pull-requests)` maps to
  `pullRequests`. Numeric index may select the active route record but never defines this mapping.
- The Pull request detail Stack owns the validated `{connectionId, pullRequestKey}` route record.
  Switching tabs preserves that record, route key and canonical Details or Changes URL.
- Details and Changes are canonical sibling route variants. The selected tab is not a domain entity
  and is not mirrored in React, Legend State or `pullRequestScreenModel`.
- Router history owns overlay parentage. Projects exists only inside `(threads)`; shared root
  overlays return to the subtree that pushed them.
- `WorkspaceTwoPaneLayout` owns a transient presentation value only. Width changes emit no Router
  action.
- Companion and data owners continue to resolve the canonical linked review thread. Route
  composition chooses wide local presentation or compact canonical Threads-tab navigation without
  copying conversation data.

## Route semantics

| Intent                                     | Operation                                                                                                     | Contract                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open V1                                    | open `/`                                                                                             | All is the V1 root destination                                                                                                                   |
| Mount or resize the workspace | no thread selection | Only an explicit thread choice selects a conversation; a wide empty destination shows the selection placeholder. |
| Select a thread | qualified `Link`: navigate from All/project, `dismissTo` from detail/child destinations | Repeated selection retains the mounted screen; peer selection keeps one conversation destination; Back returns to the list or retained search. |
| Open a thread child                        | `push`; controls/lists use transparent sheets, content workspaces use an opaque fullscreen `transparentModal` | Back returns to the still-mounted owning thread; Android never detaches the covered Fabric screen                                                |
| Close a route surface                      | `back`, with stable-parent replacement for direct entry                                                       | UI close and system Back share Router history                                                                                                    |
| Delete the active thread                   | `dismissTo('/')`                                                                                            | no invalid active-thread route remains                                                                                                           |
| Open global search | `push` on compact layouts or without a selected chat; set the session parameter on a selected wide chat | Wide search occupies the left pane while the native chat screen keeps its scroll gestures; narrow search covers its origin without removing it from history. |
| Toggle Global Voice Mode                   | activate the app-level live-assistant/stop control without navigation                                         | the process-lifetime supervisor continues across routes and app backgrounding; only explicit Stop or terminal failure releases it                |
| Open a search result | `push` from Search; clear the session parameter on a selected wide origin first | Back returns to the retained search query/results on compact layouts; closing wide Search keeps the selected result and removes its search parameter. |
| Open browser, drawing, content or document | `push` with an opaque session id and fullscreen modal presentation                                            | private resources and callbacks stay in bounded services; root modals carry the owning thread identity                                           |
| Navigate within a WebView                  | widget-owned history                                                                                          | page history stays separate from application navigation                                                                                          |
| Switch catalog mode (Threads / Pull requests) | map the mode to the exact tab route name, emit cancelable `tabPress`, then dispatch standard tab navigation | both nested Stacks stay mounted; focus and tab history change without replacing either public URL state |
| Open a pull request | push the canonical Details URL | the real `/pulls` descriptor remains the Router-owned catalog parent and the local Suspense boundary owns loading feedback |
| Reselect the active catalog | emit cancelable `tabPress`; use the nested Stack listener | detail pops to its catalog root; root reselect is a no-op and canceled activation dispatches nothing |
| Open a linked thread from a PR | wide: keep canonical conversation inside the PR route; compact: ensure, prepare, then navigate the canonical Threads href through parent Tabs | the PR Stack stays retained, the canonical thread opens in Threads, and error/cancel stays in the PR route |

Main-thread navigation publishes immediately and retains cached content or the local skeleton while
history hydrates progressively. It does not use a Transition. Subagent selection continues through
its existing Transition. The workspace runtime, databases, native conversation host, voice
controller and Terminal store outlive route children.

`RouteFullscreenOverlay` keeps fullscreen content owned by its Expo Router destination while
projecting the rendered workspace into the application-level `AppFullscreenOverlayHost`. The host
sits above the responsive split shell, so Changes, documents, large content, browser, drawing,
subagents and Terminal cover both panes. It is the single presentation owner, but every logical
overlay entry receives its own native modal window; earlier entries remain mounted beneath newer
ones. Android's window stack therefore orders a fullscreen child above the sheet or dialog that
opened it without losing the parent workspace state. React `zIndex` and `elevation` never cross
native-window boundaries. Overlay close and system Back dismiss the top owning route; route
teardown closes the overlay without navigating a second time.

Every conversation surface, including the read-only subagent workspace, consumes the retained
thread window through `projectThreadChatWindow`. That projector is the single owner of merging
immutable sealed history with the mutable active head; nested routes do not rematerialize database
rows through a separate path.

## Pull requests routes

Feature ownership is in
[V1 feature architecture](android-v1-feature-architecture.md#approved-pull-requests-extension);
the companion contract is in [Forge plugins](forge-plugins.md).

- `PullRequestsWorkspaceRouteLayout` owns the real `pulls/index` descriptor, Pull request pane
  controller and responsive catalog/detail assembly. It does not render the shared bar or import
  the parent Tabs owner, Threads route layout or descriptor.
- `pulls/index.tsx` renders `features/pullRequests`: onboarding while the connection has no
  connected account, the PR list otherwise. It is the real anchored route, not content manually
  constructed outside the descriptor.
- `pulls/[connectionId]/[pullRequestKey]/{index,changes}.tsx` renders `features/pullRequestDetail`.
  `pullRequestKey` is the companion-issued opaque `PullRequestKey`; route params accept it as an
  opaque nonempty string and brand it, and Android never parses it. Details/Changes selection is
  canonical URL state; the feature receives it as a route prop and does not mirror it. Back dismisses
  either tab to `/pulls`.
- `routeComposition/pullRequestNavigation.ts` owns the navigation intent only: it publishes the
  canonical PR destination immediately. The screen's local Suspense boundary reads the process-owned
  overview resource and owns its stable skeleton; navigation never owns or waits on that Promise.
- Compact linked-chat navigation reuses the established observer, IME-dismissal, timing and
  canonical-identity preparation before navigating the canonical Threads href through parent Tabs.
  It must not use `router.replace`, `dismissTo`, `navigation.reset` or manually assembled navigation
  state. Cancel and failure retain the PR route; wide linked chat remains local to the mounted PR
  route and reuses the canonical conversation surface.
- Pull request composition publishes no presentation claim. Wide linked chat is the PR route's
  right pane, and the shared pane frame covers the catalog while any right pane is open, so the
  catalog and a right pane are never visible together (see `routeComposition/CONTEXT.md`).
  Wide-to-compact preserves chat identity and emits no Router action.
- Features emit typed navigation intents; `features/pullRequests` and
  `features/pullRequestDetail` reach each other only through these intents.

`/projects` and `/projects/add/**` exist only under `(tabs)/(threads)`. They are transparent native-stack
routes that render nothing in the pane: the covered destination (for example New Chat) stays mounted
and visible below them, and their surface is a native `AppSheet` window bound to route focus, so it
covers the whole application like every other sheet. A sheet-presented route must never draw its
backdrop or sheet surface as React content of its screen: the Threads Stack is placed inside the
center pane by `ThreadsWorkspacePaneLayout`, so screen content is clipped to that pane on wide
layouts. Native sheet dismissal (Back, outside tap, swipe) closes the route through Router history;
losing focus to a pushed child route hides the sheet without navigating.

Compatibility is explicit: the existing public URLs are permanent Router-owned surfaces.
`WorkspacePaneLayout`, `WorkspaceScreenLayout`, `projectWorkspaceRoutes`,
`WorkspaceRouteProjection` and `PullRequestsCatalogPane` are deleted in the structural slice. No
temporary re-export, alias, dual route tree or compatibility wrapper may preserve them.
The former physical `(workspace)/(threads)` and `(workspace)/(pull-requests)` group paths and child
catalog-replace helpers are also deleted atomically when the groups move beneath `(tabs)`.

## Global Voice non-route boundary

Global Voice is deliberately not an Expo Router destination. `WorkspaceRouteComposition` obtains the process-lifetime `GlobalSupervisorFeatureContract` from `createWorkspaceFeatures` and passes one `{ active, onToggle }` control into both responsive thread-list headers. The inactive live-assistant signal starts or recovers the supervisor; the same control becomes an active Stop action until the activation ends.

The control owns no independent selected-chat state. Cross-chat targets are always qualified by both V1 `connectionId` and `threadId`; the current route is never ambient authority. The bound supervisor thread is a system thread and is rejected by ordinary direct-route admission as well as excluded from every ordinary list/count/default surface. Navigation, Back, route unmount and app backgrounding are not lifecycle signals for the supervisor.

The feature model owns the binding, capability and activation discriminated unions. Android foreground-service ownership keeps an explicitly started microphone session eligible while the app is backgrounded. Explicit Stop, home-session loss, permission revocation or terminal realtime close converges on teardown before the activation returns to idle/failed state. Lock-screen start/recovery, wake word and notification controls remain outside this contract.

## Server scope

All-versus-one-server selection is `ServerScope = all | connection(connectionId)`. It filters list,
project and search inputs and never creates a server-home destination. The old sentinel string and
navigation-owned server state are removed.

## Private route state

Route parameters are external input. `threadRouteParams.ts` accepts connection, thread and turn
identifiers as opaque nonempty scalar strings, then brands them before lookup; it does not invent
length, slash or control-character restrictions for server-owned identifiers. Locally generated
session identifiers retain the stricter local grammar. Invalid or retired resources render a
bounded unavailable state with a route back to a stable parent.

Search windows, pairing links, forwarded URLs, drawing admission, full content, documents, changes,
composer tools and Terminal presentation use separate typed owners. Secret-bearing pairing and
browser values never enter a route parameter: their services retain the value behind an opaque id.
Each ephemeral registry has a small count bound and expiry or explicit disposal. A mounted route
holds a lease, so passive expiry and capacity pressure cannot invalidate its Back-stack entry; when
all entries are mounted, the registry admits bounded temporary overflow until routes unmount.
Pairing remains deliberately unleased so authentication material keeps its absolute ten-minute
expiry. There is no generic route-state bag.

## Local interaction state

Confirmation dialogs, row menus, filter popovers, the inline queue, composer suggestions, browser
feedback and WebView page history remain widget state because they are not application
destinations. Route unmount does not dispose native Terminal tabs, workspace runtime state or voice
resources.

## Preserved behavior

1. Main-thread header and composer never wait for complete history; composer restoration precedes
   editing.
2. Desktop sidebar identity stays mounted across thread routes; selected-row identity comes from the active qualified route; mobile Back returns to the originating All or project list.
3. Global search occupies the list pane, keeps the desktop conversation pane mounted and survives the mobile result round trip. Search windows cannot leak into another thread.
4. Subagent selection retains its Transition and carries the immediate parent agent explicitly for
   nested agent routes.
5. Code documents open in the real readonly review workspace with line/column reveal, source assets,
   diff loading, download and review attachment behavior. Image, video, Markdown, text and HTML
   previews use Router-owned destinations while reusing their existing presentation capabilities.
6. Resource reads remain model-owned stable resources; React effects do not schedule render data.
7. Navigation retains observer, presentation, IME and timing order.
8. Existing visual primitives, accessibility labels and pending/error surfaces remain in their
   feature widgets.

Relevant Expo Router contracts were checked against the official layout, navigation and Router API
documentation during design:

- [Navigation layouts](https://docs.expo.dev/router/basics/navigation-layouts/)
- [Navigation](https://docs.expo.dev/router/basics/navigation/)
- [Router API](https://docs.expo.dev/versions/latest/sdk/router/)

## Shared project-list stack

All and project content at both widths render in the `(tabs)/(threads)/(lists)` native stack.
`WorkspaceListStack` keeps
one `ThreadListHeader` above the navigator. Root/project transitions retain that exact header,
Search action and Orb instance; only the title/breadcrumb and selected controls change. The content
scenes omit their own headers. The scene container clips animated content below the shared header.
Opening a pinned project pushes `/project/[sessionId]` with the existing native fade and short
slide (`fade_from_bottom`, customized Android resources); reduced motion disables it. Search and
chat remain sibling destinations in the workspace stack. Width changes only pane placement.

`projectListRouteSessions` retains the private qualified project outside URL parameters. A mounted
project screen holds a session lease. Header and project content use the workspace-owned project
archive/filter/page state; the shared catalog and scroll-offset owners remain authoritative.
Opening a project resets project mode to active without changing the root list's scope or state.

Project -> chat preserves the project entry and carries its opaque id so both the header Back and
system Back return to the current catalog project, including a later selection made beside the
conversation in wide mode. Project -> Search and project -> new draft preserve the preceding
project entry. Device animation and rotation from an open project still need physical-device verification.

## Responsive navigation audit

The agreed incremental contract preserves the wide conversation when changing the left project,
server/filter, or opening Search. Only explicit thread selection changes that conversation.
Search presentation branches on width when a chat is selected, automatic initial thread selection is removed, and
project paging/offset keys are shared between presentations. The follow-up now renders the same Expo catalog stack in a persistent adaptive pane.
Folding or unfolding an open Search moves its session between the mobile route and the wide chat parameter without dropping the origin or query.
Project actions target that stack without focusing it over the selected conversation.

The independent wide-sidebar native stack experiment was rejected before publication and removed:
it introduced a second navigation history instead of preserving one history across width changes.
The follow-up removed local wide project selection: both layouts now use the existing Expo catalog stack.
See [responsive navigation audit](android-responsive-navigation-audit.md) for verified divergences,
resize reproductions, alternatives and the proposed acceptance contract.

## Root recovery after version-prefix removal

The real Expo route parser resolves `/` to `(workspace)/(tabs)/(threads)/(lists)/index` and anchors direct thread
links above that list. Returning from a thread targets the workspace navigator, preserving
its list-group entry and selecting its index. Tests exercise Expo's actual parser, action targeting and stack reducer;
render tests separately verify that recovery reveals the thread list.

The whole-list Suspense fallback renders loading feedback immediately. Delayed empty-row
feedback remains appropriate inside an already visible list, but must not hide an entire
destination. These contracts prevent known blank render paths. A device-only native view
failure cannot be diagnosed solely from a screenshot; the reported intermittent gray screen
has not yet been reproduced on a connected device.

Incident clarification: the user also observed the same blank surface while opening a thread,
before installing these recovery changes. Treat this as a bidirectional navigation incident,
not a confirmed Back-target bug. Main-thread selection retains the requested connection/thread
while data loads; missing catalog data does not by itself clear the destination. The workspace
uses native `fade_from_bottom` transitions with application resource overrides that animate
both screens' opacity. Native transition/visibility state and Suspense remain hypotheses;
source inspection does not establish either as the cause. The existing reduced-motion setting
provides a reversible device comparison with native route animation disabled. Capture a failing
device transition before changing animation resources or introducing navigation timeouts.

Decision review: a not-found redirect alone cannot repair an already matched home route
(incremental). Removing the redundant framework native stack while retaining the workspace
stack is the selected structural change: compatibility aliases need routing, not native screen
history. Replacing the workspace native navigator entirely was considered and rejected for
this incident: device evidence does not justify changing all thread/tool transitions.

Validation snapshot, 2026-09-21: TypeScript native/web/compatibility checks and dependency
boundaries passed. Navigation render tests cover both Back commands and unmatched recovery;
real Expo parser/reducer tests and immediate Suspense recovery tests passed. The full V1 render
run passed 48 suites / 213 tests and failed one parallel catalog-pagination test. The documented
V1 gate stopped on parallel voice formatting changes; separate hygiene/Knip and bundle checks
also reported parallel voice changes (including React Compiler's unsupported try/finally in
VoiceInputSettings). No suppressions, dependency upgrades, device installation or release
were used for this fix.

## Adaptive catalog placement

`WorkspaceTabsRouteLayout` renders the two child descriptors through one standard JS Tabs
navigator. Each child layout renders its anchored catalog's real descriptor exactly once and
supplies catalog/detail slots to `WorkspaceTwoPaneLayout`. The shared layout only computes
responsive placement and animation; changing width does not mutate Router state or remount a second
catalog. Child layouts may both import this geometry primitive, but they must not import each other.

`WorkspaceTabSceneIsolation` is authoritative in both BottomTabView paths. Active scenes use
`display: "flex"`, `pointerEvents="auto"`, `accessibilityElementsHidden={false}`,
`importantForAccessibility="auto"` and `aria-hidden={false}`. Inactive scenes remain mounted but
use `display: "none"`, `pointerEvents="none"`, `accessibilityElementsHidden`,
`importantForAccessibility="no-hide-descendants"` and `aria-hidden`. Native
`Screen(activityState=0)` is not sufficient because the bundled plain-`View` fallback does not use
that state. `unmountOnBlur` and `popToTopOnBlur` are not set.

The native catalog entry remains in its nested Stack history. Back pops only the active Stack before
TabRouter consumes deduplicated tab history; after tab history is exhausted, Back bubbles to the
workspace root and Android. Active-tab reselect emits cancelable `tabPress`, pops detail to its
catalog root and is a no-op at root. Direct deep links anchor the correct tab and nested Stack.

`workspaceThreadsRouteState` finds `(workspace) -> (tabs) -> (threads)` by exact names and returns
`unavailable | ready` with the existing state reference. `workspaceProjectNavigation` uses it to
find direct child `(lists)` and target native PUSH/REPLACE/POP_TO_TOP actions to that navigator.
PUSH and REPLACE do not focus the parent, allowing wide project browsing to preserve the open
conversation. There is no independent navigation container or local project-selection mirror.
The shared header remains outside list Suspense and native animation. Both widths use the
application's native fade plus short horizontal travel. Project data remains in bounded route
sessions, not URLs; an open project route retains its session while a chat or search covers it.

Search-session retention traverses the active indexes inside the retained Threads chain, from the
deepest route to its parents, and validates the first `globalSearchSessionId`. Tab blur cannot release
that lease; explicit Search close and workspace teardown can. Existing route-session capacity,
expiry and overflow-only-while-mounted policy does not change.

The one `CatalogModeBarHost` remains an absolute overlay in the parent Tabs content box. Its
geometry is binding: `left = catalogModeBarHorizontalInset`,
`bottom = catalogModeBarBottomInset`,
`width = (desktop ? desktopThreadSidebarWidth(viewportWidth) : viewportWidth) - 2 * catalogModeBarHorizontalInset`,
and `zIndex = 20`. Existing `catalogModeBarContentInset` and `catalogModeBarFabBottom` continue to
protect lists and FABs. The geometry component knows no route names.

Reacticx provenance is explicit. `vendor/reacticx/src/components/organisms/masked-tab-bar/**` is the
source of truth and records the selected-activation patch in `vendor/reacticx/UPSTREAM.md`.
`scripts/sync-reacticx-components.mjs` deterministically generates only
`src/vendor/reacticx/masked-tab-bar.js`; direct edits to that output are forbidden.
`src/vendor/reacticx/masked-tab-bar.d.ts` is maintained and type-checked separately.

## Dependency, verification and rollback contract

- Route groups may import route-composition owners and feature public surfaces. Features, data,
  services, components and native code must not import route modules.
- `WorkspaceTabsRouteLayout` may import child layout entrypoints and public feature capabilities.
  Child layouts, features, data and services must not import the parent `(tabs)` layout or bar owner.
- `WorkspaceTwoPaneLayout` must not import Expo Router, route layouts, `CatalogMode`, Pull request or
  Threads features, or route-name constants. It accepts rendered slots and presentation values only.
- The Threads and Pull requests layouts must not import each other. `features/pullRequests` and
  `features/pullRequestDetail` remain mutually forbidden and meet only through typed route intents.
- Catalog activation and compact linked-chat handoff use the parent Tabs navigator. They do not use
  `router.replace`, `dismissTo`, `navigation.reset` or manually assembled binary state. Projects is
  registered only under `(tabs)/(threads)`.
- Production-tree checks must prove the six parent chains above, unchanged public paths, Back and
  reselect order, retained route keys, canonical Details/Changes URLs, compact linked-thread
  identity, one bar and the exact inactive-scene properties. A separate screens-disabled test must
  prove the plain-`View` fallback. Source checks must prove retired paths/helpers are absent and the
  Reacticx source/generated/type boundary is deterministic.
- `pnpm validate:android:v1` and `pnpm --filter @codewide/android compile:android` are required
  handoff gates. Passing them is repository evidence, not physical-device proof; native Back,
  TalkBack traversal, native detach, fold/unfold and modal ordering remain unverified until exercised
  on a device.
- Roll back the complete route-tree/layout/tests/docs slice if a public URL or exact parent chain
  changes, a nested Stack loses state, an inactive scene stays interactive, tab mapping is wrong, a
  duplicate bar appears, source/generated Reacticx diverges, a runtime owner remounts, or either
  required gate fails. Rollback returns the previous route tree, child bar ownership and these docs
  atomically; do not keep a dual tree, compatibility wrapper or partial parent Tabs migration.
