# Android V1 route architecture

Status: **implemented and repository-validated on 2026-09-15**. Implementation baseline:
`368f4699a19c3f9c3edd1875739c799720dc7095`.

This document is the current V1 application-navigation contract. The earlier feature extraction
remains the source ownership foundation, while Expo Router now owns application destinations and
Back history. V1 uses `connectionId`; it does not adopt V2 `savedServerId` terminology.

## Ownership model

- `app/(workspace)/**` owns destination screens and layouts with unversioned public paths.
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
- `WorkspaceShell.tsx` owns the persistent responsive chrome, providers and inner `Stack`.

`CodeWideScreen`, `WorkspaceScreen`, `WorkspaceOverlays`, `ThreadNavigationModel` and
`features/navigation/**` no longer exist. There is no second selected-destination state.

## Implemented route tree

```text
app/(workspace)/
├── _layout.tsx
├── (lists)/
│   ├── _layout.tsx                                fixed mobile header and nested content Stack
│   ├── index.tsx                                  /; mobile All list
│   └── project/[sessionId].tsx                    /project/:sessionId; opaque project session
├── new/
│   ├── _layout.tsx
│   ├── index.tsx                                  /new
│   ├── controls/{model,permissions,skills}.tsx
│   ├── content/[sessionId].tsx
│   └── documents/[sessionId].tsx
├── search.tsx                                     /search; mobile stack screen, desktop list pane when no chat is selected
├── projects/
│   ├── index.tsx
│   └── add/[connectionId].tsx
├── settings/
│   ├── index.tsx
│   └── servers/new/index.tsx
├── browser/[sessionId].tsx
├── drawing/[sessionId].tsx
└── threads/[connectionId]/[threadId]/
    ├── _layout.tsx
    ├── index.tsx
    ├── agents/{index,[agentThreadId]}.tsx            fullscreen workspace; detail path compatibility
    ├── attachments/index.tsx
    ├── changes/{index,turns/[turnId]}.tsx
    ├── controls/{model,permissions,skills}.tsx
    ├── content/[sessionId].tsx
    ├── documents/[sessionId].tsx
    └── {goal,ports,queue,review,runtime,terminal}.tsx
```

The workspace index owns `/` directly; `/legacy`, `/pair`, `/thread` compatibility entries redirect there. The `(workspace)` group preserves the mounted layout without contributing a URL segment. V1 owns the
original process deep links. The V2 route groups and generation chooser were removed;
see [the retirement audit](android-v2-retirement.md).

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

Main-thread navigation publishes immediately and retains cached content or the local skeleton while
history hydrates progressively. It does not use a Transition. Subagent selection continues through
its existing Transition. The workspace runtime, databases, native conversation host, voice
controller and Terminal store outlive route children.

`RouteFullscreenOverlay` keeps fullscreen content owned by its Expo Router destination while
projecting the rendered workspace into the application-level `AppFullscreenOverlayHost`. The host
sits above the responsive split shell, so Changes, documents, large content, browser, drawing,
subagents and Terminal cover both panes. Overlay close and system Back dismiss the owning route;
route teardown closes the overlay without navigating a second time.

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

All and project content at both widths render in the `(lists)` native stack. `WorkspaceListStack` keeps
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

The real Expo route parser resolves `/` to `(workspace)/(lists)/index` and anchors direct thread
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

`WorkspacePaneLayout` uses Expo Stack `layout` to render the `(lists)` descriptor in one stable
pane, and `screenLayout` to leave only a placeholder for that entry inside the detail native
stack. Thus the list navigator and header mount once; window width changes pane geometry only.
The native list entry remains in application history, so Back from a conversation reveals its
current project. Deep-link anchors and native detail/overlay navigation remain Expo-owned.

`workspaceProjectNavigation` reads the catalog state below the workspace, including Expo's
runtime root wrapper, and targets native PUSH/REPLACE/POP_TO_TOP actions to that navigator.
PUSH and REPLACE do not focus the parent, allowing wide project browsing to preserve the open
conversation. There is no independent navigation container or local project-selection mirror.
The shared header remains outside list Suspense and native animation. Both widths use the
application's native fade plus short horizontal travel. Project data remains in bounded route
sessions, not URLs; an open project route retains its session while a chat or search covers it.
