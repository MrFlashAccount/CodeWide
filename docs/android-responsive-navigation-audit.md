# Responsive navigation and state audit

Date: 2026-09-21. The audit below records the pre-fix snapshot, followed by business-contract
fixes and shared project navigation using the existing Expo stack. A custom router is deferred.
No release was performed for this work.

## Agreed incremental changes

Sergey confirmed that in wide layout the selected conversation must remain when browsing
another project; only explicit thread selection changes it. Width-specific presentation is
allowed. A unified custom router is not a prerequisite for fixing business behavior.

Implemented in the existing owners:

- Search opens above its origin at either width. The first result is pushed, subsequent
  results replace it, and Back retains the search query, results, and scroll. Explicitly
  closing Search removes its history entry while preserving the selected result.
- Search-result Back and project return decisions no longer depend on width.
- Automatic first-thread selection is removed, including its default-selection bookkeeping.
  Opening or resizing the workspace does not choose a conversation.
- Narrow and wide project lists use the same project/mode identity for pagination and scroll;
  another project's page limits do not leak into the current project.
- Regression coverage verifies that wide project/filter changes retain the conversation,
  and that search history and cached catalog rows behave consistently during width changes.

Deferred at this increment: wide project navigation and the project/header resize failures
(addressed in the follow-up below), subagent Back policy, review sidebar preferences, and
native performance profiling.

Validation of this increment: `pnpm validate:android:v1` passed (54 V1 suites / 236 tests,
39 shared suites / 136 tests, all typing, formatting, hygiene and dependency checks).
Android bundle validation passed. The three affected Vitest contract files passed 60 tests.
The incremental checks supersede the earlier blocked validation snapshot at the end of this
report. No physical-device proof or OTA publication is claimed.

## Project navigation implementation

The follow-up replaces the local wide project selection with the existing Expo catalog stack.
`WorkspacePaneLayout` uses the installed Stack's `layout` and `screenLayout` contracts to
render the catalog descriptor once in a stable pane. Its native history entry remains in the
workspace stack as a transparent compact placeholder or a wide conversation-selection view.
No independent NavigationContainer, copied history, or custom router was introduced.

Project selection dispatches PUSH/REPLACE to the catalog navigator's key. Those native stack
actions do not focus its parent; an open conversation remains selected and mounted. Closing
the project dispatches POP_TO_TOP to that same catalog. Width changes only pane geometry.
System Back from the conversation reveals the catalog's currently selected project. Header
Back reads that same catalog state rather than stale project parameters on a chat route.
The catalog lookup traverses Expo's runtime `__root` wrapper as well as the workspace group.
A `useSyncExternalStore` subscription observes navigation state events: the installed Expo
`useRootNavigationState` reads a snapshot without subscribing, which left the project header
stale after targeted actions. The native fixture exposed this; a test using the real navigator
now verifies that the header updates while a different detail route remains focused.

One header, Search action, and Orb sit outside the content navigator and its Suspense boundary.
Project transitions use the existing 250 ms native fade/short-slide options on both layouts.
Project drafts preserve the catalog parent when opened beside an existing conversation.

The previous project/header resize findings are addressed by this follow-up; the earlier
sections remain the incident baseline. Subagent Back policy and review preferences remain
outside this project-navigation change.

## Original audit conclusion

Window width currently selects navigation semantics as well as presentation. The primary
workspace has one Expo Router tree, but the wide project sidebar bypasses it and owns a
separate local selection. Search, Back, initial thread selection, and project list restoration
also change behavior at the layout boundary. These differences explain why fixing the narrow
project navigator did not fix the wide sidebar.

The independent wide native-stack experiment was rejected before publication and removed.
It could animate the sidebar, but introduced another history without solving folding.
The preceding local sidebar implementation remains until a unified migration is implemented.

The required contract is one logical navigation tree and consistent navigation actions at
every width. Nested navigators are compatible with that contract. An independent history
selected by window width is not. Layout should decide which panes are visible, not rewrite
where the user is or how Back behaves.

## Scope and evidence

Inspected window-width, desktop/mobile, compact, pane-width, orientation, and master/detail
branches across `apps/android/app`, `apps/android/src`, and the native Android host. The
main breakpoint is 720 density-independent pixels, not a physical folding-state detector.
Split-screen resizing can therefore trigger the same problems.

Three temporary characterization tests reproduced the following behavior after removing
the independent-stack experiment:

1. Open a project at width 1100, then resize to 400: history remains `/`, the project
   breadcrumb disappears and the header says Threads, but the project-specific New thread
   action remains. Header and content disagree about the current scope.
2. Open a project at width 400, then resize to 1100: the project route remains the destination,
   while the wide sidebar presents the root header without the project breadcrumb.
3. Select a search result using wide navigation, then switch to narrow and go Back:
   history contains root and thread; Back returns to root because search was removed.

All three passed as reproductions of unwanted behavior. They were not retained as permanent
tests asserting that behavior is desirable. The local reproduction and output are archived
in `/tmp/codewide-responsive-audit-reproduction.test.tsx` and
`/tmp/codewide-responsive-audit-tests-final.log`. The tests use the repository router/render
harness; they do not establish native frame timing or physical-device correctness.

## Conceptual differences

| Area | Narrow | Wide | Consequence and evidence |
| --- | --- | --- | --- |
| Project selection | Expo project route plus route session | Local `sidebarProject` state | Two authorities; folding can disagree about header, content, and destination. Reproduced in both directions. |
| Search result | Push thread above search | Reset to root, then push thread | Different history for the same action; return to search is lost. Reproduced. |
| Back from conversation | Explicit handler; project context can determine target | Compact handler absent; project return branch disabled | Width changes who handles Back and where it returns. Confirmed in source. |
| Initial selection | Root list remains a destination | Can automatically select first thread | Expanding at root can initiate navigation when initial-selection eligibility remains enabled. Source-confirmed conditional behavior. |
| Project pagination | Limit keyed by active/archive mode | Limit keyed by project and mode | Same store, incompatible keys; narrow limits also leak between projects. Source-confirmed. |
| Project scroll restoration | `project-route:<project>:<mode>` | Server/mode/project scope key | Same offset store cannot restore the same project across paths. Source-confirmed. |
| Catalog header lifetime | Header outside animated list destinations | Header inside sidebar's suspending subtree | Different mount/loading behavior; possible contributor to visible header replacement. Exact native jump timing remains unproven. |
| Subagents | Selected detail hides master; Back can clear selection | Master and detail coexist; compact Back handler absent | Selected agent owner is shared, but Back policy differs. Source-confirmed; resize/scroll behavior needs device verification. |
| Review file sidebar | Selecting file explicitly hides sidebar | Sidebar defaults visible unless preference set | Automatic narrow hide writes the same preference as a deliberate user choice, so unfolding can retain hidden sidebar. Selected file/comments have common owners. |

Primary owners:

- [Project action routing](../apps/android/src/routeComposition/WorkspaceRouteComposition.tsx),
  [local project selection](../apps/android/src/features/projects/projectSelection.ts),
  [narrow catalog navigator/header](../apps/android/src/routeComposition/WorkspaceListStack.tsx),
  [workspace sidebar adapter](../apps/android/src/routeComposition/WorkspaceRouteThreadList.tsx).
- [Search and project-return routing](../apps/android/src/routeComposition/WorkspaceRouteModel.ts),
  [thread navigation actions](../apps/android/src/services/threads/threadNavigationService.ts),
  [search presentation](../apps/android/src/routeComposition/WorkspaceShell.tsx).
- [Conversation Back ownership](../apps/android/src/features/conversation/timeline/overlayScrollOwnership.ts),
  [subagent selection and detail](../apps/android/src/features/agents/SubagentSheet.tsx).
- [Initial destination](../apps/android/app/(workspace)/(lists)/index.tsx),
  [initial row selection](../apps/android/src/features/threadList/threadListWorkspace.ts),
  [workspace bindings](../apps/android/src/features/workspace/workspaceListBindings.ts).
- [Narrow project page](../apps/android/src/routeComposition/ProjectThreadListRoute.tsx),
  [sidebar project state keys](../apps/android/src/features/threadList/projectThreadList.ts),
  [list loading boundary](../apps/android/src/features/threadList/ThreadListFeature.tsx).
- [Review workspace state](../apps/android/src/features/review/workspace/codeReviewState.ts),
  [window layout classification](../apps/android/src/native/window-layout.ts).

Existing navigation tests explicitly encode different wide/narrow search behavior. Merely
keeping those tests green cannot establish a unified-history contract; their expectations
must change with the approved migration.

## Shared ownership and acceptable layout differences

The application does not have two complete data models. Connections, thread resources,
search sessions, conversation activation, and composer scope are shared. Composer identity
uses connection/thread identity, not width. Existing resize coverage preserves a selected
conversation destination; it does not prove all native editor/IME or project flows.

Both catalog presentations use virtualized LegendList with row recycling. The audit found
no basis for claiming that only one layout virtualizes its list. They do have separate
presentation components and different loading/header boundaries. Those can increase mount
work, but diagnosing native animation lag requires frame evidence, not that observation alone.

No alternate width-selected navigation owner was found for attachments, Markdown/document
preview, terminal, browser/drawing, settings, requests, or queue surfaces. Sheet/modal width
and pane arrangement change geometrically. Android fullscreen preview dismissal uses the
same explicit Back owner at both widths. This is a source-audit result, not proof that every
overlay survives every physical resize without losing local state.

Subagents and code review already illustrate shared selection with adaptive presentation.
Their Back/preference issues should be fixed at their existing owners, rather than creating
parallel implementations. Master-list scroll, editor focus, and native instance retention
remain device acceptance cases.

Conversation density also uses pane measurements: a wide window may contain a narrow chat
pane. Window layout mode, pane density, and navigation state must remain separate concepts.

## Proposed invariant

- Resizing changes visible panes only. It emits no push, replace, reset, or implicit selection.
- The same user navigation intent produces the same logical history at either width.
- Project/server scope, selected conversation, search session, and focused destination have
  one authority. Sidebar content is derived from that authority.
- A narrow layout presents the focused logical destination; a wide layout can additionally
  show its catalog context. Folding preserves that destination and its history.
- Project paging, filters, and scroll use one semantic scope identity in both presentations.
- Back first dismisses the active overlay or local child, then follows logical route history.
  Both the system button and visible Back controls obey that policy at every width.
- The catalog header, Search control, and Orb stay outside animated catalog content. Active
  conversation/composer lifetime must not depend on switching layout wrappers.
- Main-chat selection retains the existing immediate destination and progressive transcript
  contract. Subagent selection retains its Transition. This migration must not gate the
  main header/composer on full transcript hydration.
- Native content transitions use the accepted fade plus short slide; resizing itself must
  not simulate navigation. Reduced-motion behavior remains supported.

One history does not require putting every dropdown, editor caret, or scroll offset into
route parameters. Route ownership and model-owned view-state retention are separate concerns.

## Decision space

| Lane | Candidate | Verdict |
| --- | --- | --- |
| Incremental | Synchronize local sidebar selection with routes on resize; patch search/Back independently | FAIL as the final design: leaves two authorities and requires ordered synchronization. Individual state-key fixes can still be useful migration steps. |
| Structural | One Expo navigation tree and intent adapter; adaptive catalog/detail presentation; shared catalog scope and header owner | PASS as the target contract. CONDITIONAL on an Android prototype proving native pane presentation and instance retention without an independent history. |
| Radical | Replace the workspace navigation layer with a dedicated state machine and custom native multipane host | CONDITIONAL alternative only if the structural prototype fails. Could remove session/routing mirrors and own pane lifetime directly, but adds substantial Back, deep-link, overlay, restoration, and maintenance responsibilities. |

The radical candidate is reversible as an isolated two-screen prototype. Its cheapest useful
experiment is root → project → thread, resize in both directions, Back, and a deep-link entry
with a retained composer identity. Do not migrate the application merely to evaluate it.

Expo Split View is not an Android solution here: the installed SDK 57 implementation falls
back to `Slot` outside iOS. The official [Split View documentation](https://docs.expo.dev/versions/latest/sdk/router/split-view/)
also describes its iOS-only status. Expo supports
[custom navigators integrated with its route tree](https://docs.expo.dev/router/advanced/custom-navigators/),
but the installed SDK exposes the relevant integration APIs with unstable names. A prototype
must use the installed version's contract; current documentation is not an upgrade mandate.

## Cheapest proof and migration sequence

1. Build a minimal Android prototype using one Expo-owned navigation state and two adaptive
   panes. Show root, project, and thread; keep one stable header and a stateful composer probe.
   Do not copy or synchronize an independent navigation container.
2. Verify 400 → 1100 → 400 and repeated 719 ↔ 720 transitions: history and route identity
   unchanged, no automatic thread selection, no blank frame or duplicate header, composer
   instance retained. Verify native fade/slide for actual navigation separately.
3. After this proof, remove the local sidebar project authority and width-dependent search,
   Back, and initial-selection actions. Centralize catalog scope and restoration keys.
4. Connect the shared catalog presentation, then align subagent Back and review sidebar policy.
   Keep feature resource owners and progressive conversation loading contracts intact.
5. Replace tests that encode divergent behavior with width-independent navigation contracts.
   Run the documented V1 gate and application bundle validation before release.

Acceptance scenarios beyond the thin prototype: project A with archive/filter/page two and
scroll position; a chat with draft, attachment, and open keyboard; search query → result → Back;
Markdown/image preview; terminal and nested settings; selected subagent; review selected file
and draft comment; suspended destination resource; resize during an active native transition.
For each, distinguish route/history preservation, model state, view state, and native frame
behavior. Passing one category does not establish the others.

## Validation

The three characterization scenarios passed after the rejected sidebar stack was removed.
Validation after removing the rejected experiment:

- Workspace navigation: 49/49 tests passed.
- Full V1 command: formatting and native/web/compatibility TypeScript checks passed;
  53 render suites passed and one unrelated question-card suite failed (230 tests passed,
  two failed). Both failures reported `A dynamic import callback was invoked without
  --experimental-vm-modules` in `v1-question-card.render.test.tsx`. No gate was bypassed.
- Android application bundle compiled and passed the repository bundle-content check.
- Separately executed remaining checks: shared render tests passed (39 suites, 136 tests),
  and `lint:v1` passed, including hygiene, dead-code, and dependency-boundary checks.

At that audit checkpoint the full gate was not green. The later validation checkpoints above
and below supersede it. No device performance fix or published update is claimed.


## Project navigation validation

- `pnpm validate:android:v1` passed: 55 V1 suites / 252 tests and 39 shared suites /
  136 tests, native/web/compatibility typing, formatting, hygiene, dead-code and dependency
  checks. Android application bundle compilation and content validation passed.
- The real native-stack render test verifies one catalog/header, retained chat identity,
  project-state subscription, width changes, and Back through project to root.
- Workspace render contracts cover project browsing beside a selected chat, creating a draft
  from a project, suspended list resources, search, and width changes.
- An Android API 35 tablet emulator ran a minimal Expo fixture importing the production pane
  layout and project navigation owner. Root → Alpha → chat → type a draft → Beta retained chat
  instance 1 and its text; resize from 1280 dp to 400 dp retained both; hardware Back revealed
  Beta; widening retained Beta; project Back returned to root. Header and Orb/Search bounds
  remained fixed during project changes. This is native navigator evidence with synthetic
  screens, not full-application device or animation-performance evidence.
- No OTA or APK was published by this change.
