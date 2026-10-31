# Application route composition

This source zone binds Expo Router to existing workspace, feature and resource owners. The workspace
uses one URL-invisible parent `Tabs` navigator with two URL-invisible child route groups:
`app/(workspace)/(tabs)/(threads)/**` and `app/(workspace)/(tabs)/(pull-requests)/**`. The parent
Tabs state is the only owner of catalog focus and tab history; each child Stack retains its own
route keys and nested state while inactive.

## Owners

- `WorkspaceShell` owns persistent providers and the workspace root Stack. It registers `(tabs)`
  plus settings, browser and drawing, and it does not mirror a selected catalog mode.
- `WorkspaceTabsRouteLayout` owns the standard `expo-router/js-tabs` policy, exact route-name
  mapping, `backBehavior="history"`, inactive-scene isolation, the single floating
  `CatalogModeBarHost` and its presentation claim.
- `ThreadsWorkspaceRouteLayout` and `PullRequestsWorkspaceRouteLayout` each own one nested Stack,
  their responsive panes and their anchored catalog root. Neither layout renders the shared bar or
  imports its sibling.
- `WorkspaceTabSceneIsolation` keeps both descriptors mounted while applying the complete active or
  inactive display, pointer and accessibility contract. Native screens and the plain-`View`
  fallback use the same wrapper authority.
- `CatalogSearchOverlayHost` is the shared presentation boundary that retains and hides a complete
  catalog while Search covers those same bounds. Threads and Pull requests supply their own search
  state and result surfaces; neither may mount Search below its fixed catalog header.
- `workspaceThreadsRouteState` is the only topology adapter for
  `(workspace) -> (tabs) -> (threads)`. It returns an `unavailable | ready` result that references
  the existing Threads navigation state; it is not a cache or copied navigation model.
- `workspaceProjectNavigation` targets the real `(lists)` navigator through that adapter, including
  while Pull requests is active. `WorkspaceRouteComposition` derives Search-session retention from
  the retained active route chain inside Threads rather than from the globally focused pathname.
- `CatalogModeBarHost` renders the controlled feature surface and geometry only. The parent Tabs
  adapter maps `threads` to `(threads)` and `pullRequests` to `(pull-requests)`, emits cancelable
  `tabPress`, and dispatches standard tab navigation when activation is not prevented.
- `PullRequestRoute` owns the adaptive PR/chat presentation. Wide linked chat remains local to the
  mounted PR route. Compact linked chat keeps attempt fencing and prepare-before-navigate ordering,
  then navigates to the canonical Threads URL through parent Tabs. The linked-chat button and agent
  scenarios started on the PR present the same canonical thread through this one owner
  (`usePullRequestReviewChat`): `openReviewChat` opens the chat the overview names at once, and
  `openThread` opens a scenario's result. It declares its panes through `WorkspaceCenterLayout` (PR
  as center, chat as right) and owns no layout, fullscreen or chrome state of its own.
- A PR without a review chat opens its review-chat draft at once, exactly like New chat: the right
  pane (or the compact pane on a phone) renders `PullRequestReviewChatDraftPane`, the shared
  draft conversation (empty state, inline project control, composer) with a hosted
  `DraftAdmission`. There is no opening skeleton and no separate picker sheet. The route asks the
  Companion for suggestions (`chat/ensure` with `workspace: ask`) in the background: the first
  candidate is pre-selected unless the user already chose, the project text shimmers while asked,
  and a live linked chat the request finds opens instead (never while the route is hidden). The
  inline control opens the shared `NewChatProjectPicker` in explicit-choice mode, limited to the
  PR's server, suggestions first, no server default. Send is disabled until a project is chosen.
  The first send calls `chat/ensure` with `workspace: path` and then sends the message as the
  thread's first turn with the composer's options, and the chat opens like any other; nothing is
  created before it. A scenario that answers `needsWorkspace` is deferred to the same draft
  (`deferScenario`): `ReviewChatScenarioNotice` shows it pending, its Start stays disabled until a
  project is chosen, its label shimmers while starting, a refusal stays in the draft with the
  chosen project, and closing the draft settles it `null`. A draft's composer tool screens
  (model, skills, permissions) stay closed until the chat exists.
- `LinkedPullRequestChipProvider` supplies the composer's linked pull request chip for one mounted
  conversation from the thread-row badge store (`data/pullRequestLinkResources`, demanded during
  render; the Companion orders a thread's links by canonical review chat, then most recently
  linked) and opens the chosen pull request through the mounting route's `onOpen`. The thread
  screen's `ThreadPullRequestPaneLayout` mounts it with the pull request its side pane shows and
  opens the chip's choice in that pane; the thread layout keeps an outer provider for child routes
  (subagents), which opens Details in Pull requests through `usePullRequestNavigation()`.
  `PullRequestConversationPane` mounts it with the route's own pull request, which its review chat
  therefore never offers in any split or fullscreen arrangement. A phone opens that chat through
  Threads, where it is offered.
- `ThreadPullRequestPaneLayout` owns the thread route's panes: the conversation is the center
  pane (always mounted through `WorkspaceCenterLayout`, so opening the pane never replaces it) and
  the linked pull request is the right pane (close and fullscreen). The open pull request is the
  thread route's `pullRequest` search param, set in place with `setParams` like desktop Search's
  `globalSearchSessionId`, so it is per thread route and adds no history entry. Details and its
  nested Changes view (files or guide) are pane-local state of that owner, keyed by the open pull
  request. Android Back leaves pane fullscreen (frame), then Changes, then closes the pane, then
  falls through to the thread's own Back. The PR's Back closes the pane; a review chat that is
  this thread closes the pane, another chat opens through the canonical Threads URL, and a PR
  without a review chat (or a scenario that needs its draft) opens the PR route, which owns the
  review-chat draft. The thread layout publishes its own focus
  (`ThreadDestinationActiveContext`), so sheet and tool routes pushed inside the thread keep the
  pane's presence while a newer thread or the other tab does not.

Routes may import these modules and feature public surfaces. Features, components, services, data
and native owners must not import route composition or route modules; they consume narrow typed
navigation intents instead. Route composition may use Expo Router and existing feature capabilities,
but it does not own transport, persistence, protocol reduction or application data loading.

## Dependency rules

- Route names and keys come from Router state. Numeric indexes may select the current route record,
  but they must not define semantic catalog mapping.
- `WorkspaceTabsRouteLayout` may import child layout entrypoints and public feature capabilities.
  Child layouts, features, data and services must not import the `(tabs)` layout or parent bar owner.
- `WorkspaceTwoPaneLayout` owns left/center geometry only. It must not import Expo Router, route layouts,
  `CatalogMode`, route-name constants or Threads/Pull request features.
- Pane geometry animates only for an intentional rearrangement. `WorkspacePaneFrame` owns one
  `paneMotion` window per frame: a caller arms it through `usePaneRearrangement()` (opening or
  closing a right pane, entering or leaving fullscreen) and the change applies at once. First
  placement, tab reveal, data arrival and viewport changes move panes without animation.
- One owner drives all pane geometry. The frame resolves one settled `PaneArrangement`
  (`resolvePaneArrangement`) and `usePaneMotionState` publishes it to the UI thread once per
  change; there `startPaneMotion` springs a single progress (`paneMotionSpec`, one spring) from
  wherever the panes stand. Every pane frame (catalog width and opacity, destination translation
  and leading radius, center clip and right radius, right pane translation and width) is derived in
  worklets from that one progress by `currentPaneGeometry` (`paneGeometry.ts`, pure functions).
  Panes are absolutely positioned and move by translation and clipping: content layout widths
  hold the larger end of a motion and change at most at its start and settle, never per frame. No
  pane uses layout transitions, entering/exiting animations or its own spring. A closed right pane
  stays mounted, hidden, while it slides out, until the motion settles. Reduced motion (system or
  app preference) snaps.
- Pane chrome is the one exception to fixed content widths. Each pane box also has a visible
  width that moves with the same progress; `ThreePanelsPane` derives, on the UI thread, how far
  its box's content extends past that visible edge (`paneChromeInset`) and publishes it as
  `chromeInset` in `ThreePanelsContext`. `PaneChrome` (`ui/PaneChrome.tsx`) gives up that much
  trailing margin every frame, so headers and bottom bars lay out to the width the pane shows and
  settle with the panes; the heavy body keeps the fixed layout width. `ThreePanelsHeader`,
  `ConversationBottomChrome` (composer, prompts, notices), the thread search bar and the jump
  control use it; other pane content opts in by rendering its chrome inside `PaneChrome`. Chrome
  is a few rows, so the per-frame relayout stays small; JavaScript sees nothing until the motion
  settles (a measured box around chrome keeps the content width). Data for geeks samples the
  UI-thread frame intervals of each rearrangement (`pane_motion_frame_ms`); otherwise no frame
  callback runs.
- `features/pullRequests` and `features/pullRequestDetail` must not import each other. They meet only
  through typed route intents owned here.
- Tab activation and compact linked-chat handoff must not use `router.replace`, `dismissTo`,
  `navigation.reset` or a manually assembled binary navigation state.
- Details and Changes remain canonical sibling URLs and are not mirrored by the feature model.
- TanStack Query and existing Suspense boundaries remain the remote-data and Promise owners. Route
  composition must not trigger reads in effects or copy server state into a navigation model.
- Escaping UI handlers and retained navigator callbacks use `useEvent`; `useCallback` and `useMemo`
  are not introduced.
- Route diagnostics remain content-free: opaque correlation ids are allowed, but route params, Pull
  request data, user content, credentials and secret-bearing URLs are not.

## Three-pane model

The workspace has exactly three panes, named by `workspacePanes.ts`: `left` (the catalog),
`center` (the destination) and `right` (a side pane the destination opens: the PR review chat
beside a PR, or the linked pull request beside a thread). One frame owns one model:

- `WorkspacePaneFrame` creates the frame's `WorkspacePaneOwner` (the fullscreen request and the
  active right pane's key) and the motion window, resolves the single published
  `WorkspacePaneVisibility` (`stacked` on a phone, a `split` of `left+center` or `center+right`,
  or `fullscreen` of one present pane), applies it to the left/center geometry, and owns Back:
  while a pane is fullscreen, Back leaves fullscreen before anything below the frame handles it.
- The left and right panes are never visible at the same time. The frame owns this invariant for
  every subtree: a present right pane resolves the split to `center+right`, and
  `placeFramePresentation` turns a route's `wide` presentation into `wideDetailExpanded`, so the
  catalog is covered (dimmed, inert, hidden from assistive technology, still mounted) for exactly
  as long as the right pane is open; closing the right pane resolves `left+center` and restores
  it. Routes hand the frame only `WorkspaceFramePresentation` (no expanded kinds) and never claim
  the catalog themselves. Opening or closing the right pane is one rearrangement, so the catalog,
  the destination and the right pane move on the same spring.
- The right pane must render inside its route tree, so it cannot be a sibling of the frame's
  center. A destination places it with `WorkspaceCenterLayout`, inside the center destination.
  That layout feeds right-pane presence into the same owner (only while its route is active) and
  reads back the same resolved visibility; it never owns fullscreen or a second visibility.
  Nothing route-owned renders through an overlay or portal.
- Sheet-presented routes (`projects/**`, thread `controls/**`, `goal`, `queue`, ...) are transparent
  native-stack entries inside the pane-placed Stack. Their React content is clipped to the center
  pane, so they render no backdrop or sheet surface there: the surface is a native `AppSheet`
  window bound to route focus, which covers the whole application while the covered destination
  stays mounted and visible. Fullscreen routes likewise project into `AppFullscreenOverlayHost`.
- Sheet routes are tab-scoped: `/projects/**` lives in the Threads Stack, so pushing it from Pull
  requests switches tabs. A Pull requests surface that offers Manage projects (the PR review chat
  and its draft) presents it locally instead: `PullRequestReviewChatPane` owns a
  `LocalProjectManagement` page (closed, Manage Projects, Add project) and renders the same
  `ProjectManagementSheet` / `AddProjectSheet` bindings the `/projects` routes render
  (`ProjectManagementSheets.tsx`). No navigation happens, so the PR route stays focused and
  mounted, its right pane keeps its presence, and closing returns to it.
- Rounding has one rule, `centerCornerRadii(visibility)`: the center rounds its left corners in a
  `left+center` split and its right corners in a `center+right` split, with `radii.composer`;
  it never rounds both sides. Fullscreen and phone layouts have no neighbours and no rounding. Both
  radii are part of the frame's arrangement: the destination's leading edge and the center's
  trailing edge move with the same progress.
- Sizing: beside the center the left pane keeps `desktopThreadSidebarWidth` and the center takes
  the rest; when the right pane is beside the center they split the whole frame width equally
  over the covered catalog. A fullscreen right pane covers the retained
  center; a fullscreen center keeps the right pane mounted past the trailing edge; a fullscreen
  left pane moves the destination past the trailing edge at its split width; a covered catalog
  keeps its width and dims. Every hidden pane stays mounted. Beside other panes the right pane
  keeps the left pane's edge inset (`threadListLayout.edgeInset`) on both sides.
- Surfaces: the left and right panes sit on the frame color (`threadListSurface`) with no border
  against the center (`conversationSurface`). The pane frame owns surface color by position;
  `ThreePanelsPane` declares the tone (`left`/`right` recessed, `center` raised) through
  `ThreePanelsContext` and `ui/surfaceTone`, so content that honours the tone paints the frame
  color and no chat container (layout, timeline, transcript boundary, empty state) paints an inner
  surface. Components inside a pane never set an opaque background for the pane area; where they
  need a matching color (fades, rings, sticky headers, masks) they read it from the tone. The PR
  screen is position-agnostic: the same screen sits on the center surface on the PR route and on
  the frame surface in a thread's right pane.
- `ThreePanelsContext` (`ui/threePanels.ts`) is the one way pane content learns where it is.
  `ThreePanelsPane` is its only writer: `WorkspacePaneFrame` publishes the left pane and the
  frame's default center, `WorkspaceCenterLayout` the destination's center and right panes. Each
  value carries the `pane` (`left | center | right`), the frame `variant` (`stacked`, `split`
  `left+center | center+right`, `fullscreen` of one pane), the pane `chrome` (the owner-declared
  capabilities resolved by `useWorkspacePaneChrome`: `close`, `fullscreen`, `toggleFullscreen`
  and the pane `label` used for control labels), the surface `tone` and the `neighbour`: what the
  other pane of the same destination shows (`ThreePanelsContent`: a `conversation` with its
  thread, `null` for a draft, or a `pullRequest`), published by the route that declares that pane
  (`WorkspaceCenterLayout` declarations carry `label` and `shows`). Components read position,
  tone, chrome and neighbour from the context, never from props or position assumptions.
- `ThreePanelsHeader` (`ui/ThreePanelsHeader.tsx`) is the standard pane header, used by the PR app
  bar and the conversation header (review chat, thread conversation): `[←] title [trailing] [⤢]
[⋯] [×]`. The content supplies a back intent (`exit` leaves the content's root, `nested` steps
  back inside the pane), its title, trailing actions and menu; the header shows `nested` Back
  always, `exit` Back only where the pane declares no close, and the fullscreen toggle and `×`
  from the chrome. So a right pane shows `×` on PR Details (no Back) and Back plus `×` on Files
  changed / Review guide; the PR route's center keeps its route Back and no `×`.
- Neighbour suppression: the PR screen hides its linked-chat button while the neighbour is a
  conversation (the PR route's review chat, or the thread that opened the PR in its right pane);
  `LinkedPullRequestChipProvider`, mounted inside the conversation's pane, drops the pull request
  the neighbour shows from the composer chip.
- Pane actions are capabilities each pane's owner declares (`WorkspacePaneCapabilities`): `close`
  and `fullscreen`, none by default. Undeclared actions never appear and cannot be triggered;
  fullscreen resolves only for a pane the split shows (a covered catalog offers none). Today the
  catalogs declare nothing, the PR center declares fullscreen, and the review chat and a thread's
  pull request pane declare close and fullscreen. Widen/Narrow is not a capability: center and
  right always split equally.

## Compatibility and lifetimes

Existing public URLs remain permanent Expo route surfaces. The physical route groups move beneath
`(tabs)` without adding URL segments. The old sibling group paths and child replace helpers have the
`delete_now` decision: no alias, re-export, dual tree or compatibility wrapper may preserve them.

Tab blur is not a lifecycle signal. Switching tabs must retain the workspace runtime, QueryClient,
native resources, conversation host, both nested Stacks, route sessions, Global Voice, Terminal and
fullscreen-window ownership. `unmountOnBlur` and `popToTopOnBlur` are forbidden. Explicit close and
workspace teardown retain their existing cleanup authority.

No route publishes a presentation claim over the catalog or the shared bar: covering the catalog
beside a right pane is the pane frame's rule, and the bar stays the Tabs layout's presentation.

## Module and deletion proofs

- `WorkspaceTabsRouteLayout` owns one runtime policy used by every workspace catalog: focus,
  history, reselect, isolation and shared-bar presentation. Deleting it would either remove standard
  tab semantics or duplicate those rules across child layouts.
- `WorkspaceTabSceneIsolation` owns the cross-adapter native/fallback visibility contract. Deleting
  it would leave the plain-`View` fallback with mounted interactive inactive content.
- `workspaceThreadsRouteState` serves both project navigation and Search retention. Deleting it
  would duplicate knowledge of the named route chain and let those consumers drift.
- `CatalogModeBarHost` remains a presentation adapter because Reacticx geometry and Router tab
  policy have different owners. It must not become a second navigation state owner.

Validate changes to this owner with production and plain-`View` fallback route-tree/render tests,
`pnpm validate:android:v1` and `pnpm --filter @codewide/android compile:android`. These checks do not
prove hardware Back, TalkBack traversal, native detach behavior, fold/unfold retention or modal
ordering. See [the route architecture](../../../../docs/android-v1-route-architecture.md) for exact
topology, mapping, geometry, compatibility and rollback contracts.
