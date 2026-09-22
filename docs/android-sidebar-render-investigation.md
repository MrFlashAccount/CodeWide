# Intermittent disappearance of the workspace sidebar

Status: unresolved; no rendering or navigation fix established. Investigation date: 2026-09-22.

## Device report

The whole sidebar disappears, including its header and controls. This is broader than missing
thread rows. The reporter cannot currently provide a stable reproduction. Follow-up confirms
that an empty column remains; the conversation does not expand into the sidebar's space.

## Ownership and diagnostic branches

`src/routeComposition/WorkspacePaneLayout.tsx` renders the catalog from the `(lists)` route
descriptor outside the detail stack. Its desktop width is explicit; the compact layout places
the catalog underneath the detail stack. `src/native/window-layout.ts` selects the two-pane
layout at 720 dp. `WorkspaceListStack` hides the catalog chrome and nested navigator while
desktop search occupies the pane.

These give separate hypotheses, not confirmed causes:

- Missing catalog route/descriptor: inspect workspace route names, active index and catalog
  descriptor presence. Do not record route parameters or user content.
- A mounted but hidden/zero-sized native pane: inspect pane and parent bounds, visibility,
  attachment and native screen state. A present React test node does not prove visible pixels.
- Search replacement: establish whether search is active and whether its replacement surface
  has nonzero bounds before attributing the disappearance to the thread list.

## Checks performed

The existing navigation tests pass: 64 tests in `workspace-navigation.render.test.tsx` and
`v1-workspace-panes.render.test.tsx`. Their native-screen mocks cannot establish Android
visibility.

An isolated API 35 emulator fixture used the actual `WorkspacePaneLayout`,
`WorkspaceScreenLayout`, `ThreadSidebar` and `MobileThreads`, real Expo Router/native screen
stacks, React Compiler and synthetic thread data. It reproduced the workspace route group,
nested catalog and thread navigators, link selection and `dismissTo` navigation. It did not
mount the complete production workspace, transport or database resources. The catalog
header/search controls and conversation body were fixture controls.

No persistent disappearance was observed in the tested scenarios:

- Open a thread and return to the catalog.
- Change the nested project route while a thread remains selected.
- Hide and restore the catalog using the search visibility mechanism.
- Switch between compact and wide dimensions, including six repeated cycles with thread links.
- Open a thread through a running-app deep link.
- Restore an initial scroll offset beyond the current content range; the list clamped it.

Animations were enabled for the later navigation/resize checks. These results do not rule out
the reported intermittent device failure. The fixture used its own 600 dp breakpoint; later
resize cycles crossed both that breakpoint and production's 720 dp breakpoint. It does not
prove production breakpoint classification or foldable/freeform metric behavior.

Follow-up testing replaced the synthetic header with the actual `MobileThreadsHeader`, rebuilt
the debug native client to match current sources and used the production 720 dp breakpoint.
Five additional cycles of app backgrounding, compact/wide resizing and thread deep links
retained the real header and rows. The fixture still does not mount the full workspace or its
live data sources. No physical-device failure trace was obtained.

## Diagnostic changes

The existing **Copy window report** action now includes the last 80 process-local catalog
events and the latest observation per channel: route/descriptor presence, compact/wide
selection, viewport width, pane/content layout sizes, content mount/unmount and list/search
replacement. The latest navigation observation survives layout churn evicting older events.
These samples are collected
independently of the optional native window recorder, so opening Settings after a failure
does not discard the preceding catalog evidence. No chat text, route parameters or identifiers
are accepted by the diagnostic event contract; there is no persistence or automatic upload.

This is instrumentation, not a rendering fix. In particular, nonzero `onLayout` dimensions and
a mounted component do not prove that Android drew it. A native view/visibility capture may
still be necessary after the report distinguishes the navigation and layout branches.

A render test removes the catalog route deliberately and proves that the still-reserved pane
is reported as `missing-route` without recording route payloads. This is coverage of the
diagnostic branch, not a claim to have reproduced the reporter's triggering action. Export and
bounded-history tests cover retained evidence after navigating to Settings.

Validation after instrumentation: `pnpm validate:android:v1` passed (285 V1 render tests and
136 shared render tests, plus formatting, type, hygiene, dead-code and dependency checks).
`pnpm --filter @codewide/android compile:android` passed. The refreshed emulator fixture also
recorded actual nonzero pane dimensions after resize. This does not establish physical-device
visibility or a fix for the reported failure.

No release was published for this investigation.

## Local investigation artifacts

The uncommitted temporary harness is `/var/tmp/codewide-sidebar-probe`; its `node_modules`
symlink and source imports refer to this checkout. Start its Expo dev server on port 8100 and
connect an Android development client with `adb reverse tcp:8100 tcp:8100`. It contains only
synthetic conversations. Its dependency on the local checkout makes it a diagnostic fixture,
not a portable regression test.

Navigation test output is `/var/tmp/codewide-sidebar-navigation-tests.log`. Screenshots are
`/var/tmp/codewide-sidebar-*.png`. These paths are local and are not release artifacts.

The next discriminating evidence is the failing pane's native bounds/visibility together
with workspace route presence and the window-layout snapshot. Do not substitute forced
remounts, disabled recycling or route resets for that evidence: those would disturb selection,
scroll position or history without establishing the mechanism.
