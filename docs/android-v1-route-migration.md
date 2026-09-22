# Android V1 route migration ledger

Status: **R0–R7 source and test migration implemented and validated on 2026-09-16**.
Baseline: `368f4699a19c3f9c3edd1875739c799720dc7095`.

This ledger records the implemented ownership move described by
[Android V1 route architecture](android-v1-route-architecture.md). Paths below are relative to
`apps/android/` unless stated otherwise.

## Scope

Expo Router is now the sole V1 application destination and Back-history owner. Feature interaction,
lower runtime, transport, persistence, cache, command, voice, document format and product visuals
retain their established owners. V1 stays isolated from V2 route and runtime contracts.

## Closed source moves

| Former owner | Implemented owner | Result |
| --- | --- | --- |
| `src/CodeWideScreen.tsx` | `app/(workspace)/_layout.tsx` and route composition files | deleted after all V1 entry consumers moved |
| `src/features/workspace/WorkspaceScreen*.tsx` | `src/routeComposition/Workspace*.tsx` plus route files | deleted; persistent shell, routing, list adapter and resource composition have distinct owners |
| `src/features/workspace/WorkspaceOverlays.tsx` | settings, projects, search, browser, drawing and route files | deleted; application visibility booleans removed |
| `src/features/navigation/**` | Router plus `src/services/threads`, `servers`, and route callbacks | directory deleted; no duplicate navigation model remains |
| `src/features/projects/newChat.ts` | `src/services/threads/newThreadService.ts` | draft identity is route-independent and first send replaces it with a qualified thread route |
| `ProjectPickerFeature.tsx` and `searchWorkspace.ts` | project/search routes and bounded route sessions | deleted after Router assumed destination visibility and focus ownership |
| `composerToolCapabilities.ts` | typed composer route requests plus existing feature capabilities | deleted after every tool activation moved to a route-qualified contract |
| `ComposerMenuComposition*` | static control routes and `ComposerRuntimeRoutes.tsx` | omnibus page discriminator deleted |
| `AgentsFeature.tsx` and `SubagentSheet.tsx` | agent routes plus `RouteSubagentWorkspace.tsx` | list/detail history is Router-owned; Transition retained |
| `TerminalFeature.tsx` | Terminal route plus retained terminal feature/store | route close and native disposal remain separate |
| attachment/document fullscreen ownership | document routes plus `documentRouteService` | nested document state uses opaque route sessions |
| changes/code-document fullscreen ownership | changes/document routes plus `changesRouteSessions` | source documents use `CodeReviewWorkspace`, not a reduced preview |
| browser, drawing and large-content overlay ownership | routes plus dedicated bounded session services | private values and captured callbacks stay outside URLs |
| pairing deep-link visibility | V1 deep-link hook plus `pairingRouteSessions` and new-server route | raw pairing input stays behind a short-lived opaque id |

## Implemented services

| Owner | Lifetime and bound |
| --- | --- |
| `services/threads/threadNavigationService.ts` | mounted workspace; preserves observer, IME, presentation and timing order; route resources own loading after selection |
| `services/threads/newThreadService.ts` | one retained local draft until close or successful first send |
| `services/servers/serverScope.ts` | mounted workspace; `all | connection` list scope only |
| `services/routeSessionPolicy.ts` | count/TTL policy plus mounted-route leases; retained entries resist passive expiry and capacity eviction, with temporary overflow only while every candidate is mounted |
| `services/search/searchRouteSession.ts` | four unmounted search sessions/windows, 30-minute expiry, explicit cancellation; route and window leases while mounted |
| `services/connections/pairingRouteSession.ts` | two raw pairing-link sessions, 10-minute expiry, explicit close |
| `services/browser/browserRouteSession.ts` | four unmounted forwarded-browser sessions, 30-minute expiry, explicit close; leased while mounted |
| `services/documents/documentRouteService.ts` | bounded private document stack/session identity, leased while its route is mounted |
| `services/changes/changesRouteSession.ts` | six unmounted current/turn/code-document review sessions, 30-minute expiry, leased while mounted |
| `services/drawing/drawingRouteSession.ts` | two unmounted drawing admissions; mounted routes and pending commits resist capacity eviction, and settlement remains exactly once |
| `services/content/contentRouteSession.ts` | four unmounted private content requests, 30-minute expiry, leased while mounted |
| `services/terminal/terminalRouteSession.ts` | leased route presentation over the existing retained native terminal store |
| `services/composer/composerToolRouteSession.ts` | leased route-qualified composer controls and command capabilities |

All session routes carry only validated opaque identifiers. Pairing links, remote URLs, filesystem
paths, content, authorization values, prompts and callbacks are not serialized into route state.

## Slice closure

### R0 — gates and boundaries: closed

The V1 formatter, ESLint, Knip, dependency graph, public API, unresolved-platform, cycle and hygiene
checks include `app/(workspace)/**`, `src/routeComposition/**`, `src/services/**` and `src/components/**`. Expo Router imports are restricted to routes and route composition. Android V2 frontend gates were retired with that frontend; sync-client and Companion protocol validation remain separate.

### R1 — All and thread: closed

`/` owns All, qualified thread paths own conversations, and the workspace stays mounted around an
inner `Stack`. Peer thread selection collapses to All before opening the replacement conversation,
so an older conversation cannot remain mounted below it. Transparent sheet routes retain
the owning conversation below them. Main conversation publication remains
immediate with local Suspense and progressive history hydration. Desktop default selection occurs at
commit and mobile Back returns to All.

### R2 — new thread and search: closed

`/new` owns the local draft until first-send admission succeeds. Search query/filter state and
message windows remain in bounded search sessions. Global search renders in the persistent list
pane: desktop result selection collapses the previous peer conversation while preserving the search
session, while mobile result selection pushes so Back returns to search. The query and project data
never enter the URL. The old
`empty | thread | draft` destination model is deleted.

### R3 — server scope, settings, pairing and projects: closed for implemented V1 product surfaces

`ServerScope` is separate from route identity. Settings overview, Add Server, projects and project
directory selection are routes. The existing pairing widget retains its internal form-step state;
application open/close and deep-link entry are Router-owned. Pairing raw input is private session
state. No server-home route was introduced.

### R4 — attachments, documents and changes: closed

Attachment lists, private documents, current changes and recorded-turn changes are route-owned.
Document sessions preserve nested preview behavior. Code documents share the existing document path
but dispatch by typed session kind to the readonly review workspace, retaining source reveal, diff,
download, voice and attachment behavior. Image, video, Markdown, text and HTML presentations are
also Router-owned and reuse the existing transfer cache, review, annotation and download owners.

### R5 — agents and composer tools: closed

The fullscreen agent workspace and model, permissions, skills, queue, goal, review, ports and runtime
surfaces are route-owned. The composer no longer owns application navigation state. Opening agents
captures the same visible catalog snapshot as the former V1 overlay; selection remains local to the
master/detail workspace and keeps its existing Transition.

### R6 — Terminal, browser, drawing and full content: closed

Routes own application Back while dedicated services own non-serializable inputs. Browser page
history stays in the WebView. Terminal route close does not dispose retained tabs. Drawing and full
content keep their captured admission and cancellation contracts.

### R7 — closure: source and tests closed

The former root screen, workspace screen/overlay owners, navigation feature, composer navigation
owner and duplicate agent/Terminal wrappers are deleted. Behavioral tests now read the actual route,
service and feature owners and assert preserved outcomes rather than deleted filenames or obsolete
local-state calls.

## Test migration

| Former proof | Implemented proof |
| --- | --- |
| `thread-navigation-model.test.ts` internal model shape | branded route parsing/building and Router command semantics |
| workspace navigation source checks | real V1 layout, route model, shell, list adapter and new-thread service ownership |
| transition parity | immediate main selection plus preserved subagent Transition |
| project/new-chat render tests | route service first-send handoff, selected-project draft context and stale activation rejection |
| document and changes tests | typed document/change session dispatch, real review surface and nested document behavior |
| Terminal/browser/drawing/content tests | route-session lifetime, Back separation and retained native/resource ownership |
| broad native contracts | actual route and feature owner contracts after deleted screen/navigation modules |

Tests continue to assert loading, errors, cancellation, selection identity, command admission,
resource bounds and observable rendering semantics. Representation-only assertions were updated only
where the owner or formatting changed; they were not weakened to existence checks.

The configured V1 Jest suite mounts the production workspace layout and composition around a stateful
inner-stack mock that renders the actual registered child route. It is separate from the V2 Jest suite and runs
inside `validate:android:v1`. The tests prove persistent shell identity, push and replace history,
Back/replacement retirement, workspace teardown, missing direct-entry recovery through visible
controls, nested-agent parent routing and mounted session retention beyond TTL and capacity pressure.

## Validation record

Final automated evidence on 2026-09-16:

- focused affected route/session/source contract suite: 9 files, 35 tests passed;
- mounted route render suites: 2 suites, 27 tests passed and exited normally without forced process
  termination;
- navigation transition and native source-contract regressions: 2 files, 53 tests passed;
- `pnpm validate:android:v1`: formatting, native/web/compatibility TypeScript, 16 V1 render suites
  with 51 tests, ESLint layout, Knip and Dependency Cruiser passed; hygiene reported 22,370 current
  violations against the 23,604 checked-in baseline with no regression; 2,607 modules and 9,992
  dependencies were cruised;
- full `pnpm test`: 305 files and 2,217 tests passed.

## Unverified device scenarios

No Android device is attached. Camera pairing, external sign-in handoff, biometric settings,
microphone, native gesture/keyboard behavior, retained native views, Terminal input, WebView/drawing
interaction, startup/failure/retry and relative same-device performance remain unverified. Source,
type, model and Node render tests do not establish those device behaviors.

No commit, push, release, deployment or external mutation is part of this migration.
