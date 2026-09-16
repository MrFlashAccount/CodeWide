# Android V1 route architecture

Status: **implemented and repository-validated on 2026-09-15**. Implementation baseline:
`368f4699a19c3f9c3edd1875739c799720dc7095`.

This document is the current V1 application-navigation contract. The earlier feature extraction
remains the source ownership foundation, while Expo Router now owns application destinations and
Back history. V1 uses `connectionId`; it does not adopt V2 `savedServerId` terminology.

## Ownership model

- `app/v1/**` owns paths, route composition, Router operations and application Back behavior.
- `src/services/**` owns cross-route resources, validated identity, commands and bounded ephemeral
  sessions. Services render no UI.
- `src/features/**` owns domain interaction and presentation. Features emit typed navigation intents
  and do not import Expo Router.
- `src/components/**` owns visual parts without product or route policy.
- `src/data/**`, `src/native/**` and rendering engines retain their existing protocol, persistence,
  cache and platform authority.

The persistent V1 shell is split by cohesive responsibility:

- `app/v1/_layout.tsx` owns generation gating and the legacy native runtime handle;
- `V1WorkspaceRouteModel.ts` validates the current thread URL and adapts Router commands;
- `V1WorkspaceRouteComposition.tsx` binds workspace resources and route intents;
- `V1WorkspaceThreadList.tsx` adapts route resources to the shared thread-list widget;
- `V1WorkspaceShell.tsx` owns the persistent responsive chrome, providers and `Slot`.

`CodeWideScreen`, `WorkspaceScreen`, `WorkspaceOverlays`, `ThreadNavigationModel` and
`features/navigation/**` no longer exist. There is no second selected-destination state.

## Implemented route tree

```text
app/v1/
├── _layout.tsx
├── index.tsx                                      /v1
├── new/
│   ├── _layout.tsx
│   ├── index.tsx                                  /v1/new
│   ├── controls/{model,permissions,skills}.tsx
│   ├── content/[sessionId].tsx
│   └── documents/[sessionId].tsx
├── search.tsx                                     /v1/search
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
    ├── agents/{index,[agentThreadId]}.tsx
    ├── attachments/index.tsx
    ├── changes/{index,turns/[turnId]}.tsx
    ├── controls/{model,permissions,skills}.tsx
    ├── content/[sessionId].tsx
    ├── documents/[sessionId].tsx
    └── {goal,ports,queue,review,runtime,terminal}.tsx
```

The `/legacy` compatibility entry redirects to `/v1`. Generation selection remains in the root
boot owner. `/servers` remains the V2 aggregate route and is not part of V1.

## Route semantics

| Intent | Operation | Contract |
| --- | --- | --- |
| Open V1 | redirect to `/v1` | All is the V1 root destination |
| Select the first desktop thread | commit-time selection from `/v1` | avoids render-time navigation while retaining immediate publication |
| Select a thread | `push` from All, otherwise `replace` | one peer conversation destination is retained |
| Open a thread child | `push` | Back returns to the owning thread |
| Close a route surface | `back` or `dismissTo` its stable parent | UI close and system Back share Router history |
| Delete the active thread | `dismissTo('/v1')` | no invalid active-thread route remains |
| Open a search result | `push` with an opaque search-window id | query and project data stay outside the URL |
| Open browser, drawing, content or document | `push` with an opaque session id | private resources and callbacks stay in bounded services |
| Navigate within a WebView | widget-owned history | page history stays separate from application navigation |

Main-thread navigation publishes immediately and retains cached content or the local skeleton while
history hydrates progressively. It does not use a Transition. Subagent selection continues through
its existing Transition. The workspace runtime, databases, native conversation host, voice
controller and Terminal store outlive route children.

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
2. Desktop sidebar identity stays mounted across thread routes; mobile Back returns to All.
3. Search windows cannot leak into another thread.
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
