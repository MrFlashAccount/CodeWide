# Android V2 frontend retirement

Date: 2026-09-21. Source baseline: `0e39482ae39136ed8305b5787795af0066f4773a`.

## Contract and scope

Android has one application router, under `app/v1`. Root, legacy, pairing, and notification aliases
enter V1; its existing process deep-link listener still receives the original URL. Startup no longer
reads a generation preference, imports V2 diagnostics, or creates a V2 runtime. Native V1 resource
activation/cleanup remains serialized and separate from process-lifetime JavaScript state.

Removed: V2 Expo route groups, `src/v2`, generation preference/switch/diagnostics adapters, tests of
those deleted implementations, and their frontend-only gate configuration. Mixed V1/V2 tests retain
the V1 cases. Existing native protocol isolation/security tests remain applicable.

Companion, `packages/sync-client/src/v2`, native authenticated transport support, their durable data,
and their protocol/security contracts are **not** removed by frontend retirement. No release,
credential change, persisted-data deletion, or server mutation is part of this change.

## Alternatives and falsification

| Lane | Candidate | Verdict | Evidence / cost |
| --- | --- | --- | --- |
| Incremental | Force the generation preference to V1 | FAIL | Already implemented: the loader read storage and then always published legacy. Root imports and Router still retained V2. |
| Structural | Remove V2 routes, runtime imports and their orphaned frontend; keep live V1 presentation | PASS | Matches the requested boundary. Knip explicitly rooted all V2/presentation files, so deleting route files alone could not retire their graph. |
| Radical | Remove Companion V2, sync-client V2 and native transport contracts as well | CONDITIONAL | Potential gain: fewer protocols/native paths. Risk: expands into server compatibility, security and durable operations without consumer evidence. Reversible in source, not necessarily in deployed data/contracts. Cheapest experiment: a separate consumer inventory and native/backend contract run before deleting any protocol owner. |

## UI reuse audit

This is a source/consumer comparison, not device-based visual approval. No component is copied into
V1 solely to preserve unused source. Shared controls/icons/text, thread-list header and other live V1
consumers remain in `src/presentation`. Source-only candidates remain recoverable from the baseline
commit at the paths below; they are not hidden as unused runtime entrypoints.

| Candidate (former `src/v2/presentation` path) | V1 comparison | Verdict and next experiment |
| --- | --- | --- |
| `requests/RequestChoiceView`, `ElicitationRequestView` | V1 `features/requests/RequestFields.tsx` already handles scalar choices and text; `elicitationForm.ts` handles defaults and numeric/boolean/array conversion. V2 additionally models selected arrays independently, distinguishes unset/null defaults, and supports secret fields. | CONDITIONAL: useful behavior, not a drop-in component. V2 view models import the sync protocol, and its choice view lacks a disabled prop. First prove multi-select values containing commas, optional defaults, required fields, and pending-state locking against V1's request adapter. |
| `actions/useAsyncAction`, `AsyncActionFeedbackView` | V1 actions already have feature-owned pending/error state; the V2 hook adds immediate ref-based duplicate suppression and retry. | CONDITIONAL: consider only for an identified V1 duplicate-activation bug. A retained retry captures the old action; blindly adopting it risks invoking a stale thread capability. Cheapest experiment: deferred action, double press, rejection and owner switch. |
| `output/PagedTextViewer` | V2 page cursors and full-copy loading belong to its output-resource contract. | FAIL as a direct UI transplant. It joins every loaded page on render and holds fetching/state in the component; V1 requires model-owned render resources. Reuse the bounded-read requirement only after proving a V1 output limit problem. |
| `preview/InteractiveImageView` and gesture model | V1 `rendering/ImagePreviewHost.tsx` already owns gestures, progressive images, gallery lifetime, review points and attachment retention. | FAIL as replacement: replacing it would risk established ownership and annotation behavior. Pure gesture geometry is a possible future extraction only with a measured defect. |
| `queue/*` | V1 `QueueFeature`, `queueBubbleMotion`, `InlineQueueItem` already implement editing, delivery and reordering with V1 queue commands. | FAIL as replacement: no missing V1 capability established. |
| `conversation/*`, `input/*` | V1 has progressive/windowed transcript hydration, retained composer state, and its own native input/voice owners. | FAIL as wholesale transplant: V2 timeline and composer depend on different resource and operation contracts. Preserve V1 geometry and lifetime. |
| `diagnostics/*` | V1 `ui/NavigationPerformanceHud`, `features/diagnostics/PerformanceDiagnostics`, and `ui/SpeedscopeProfileViewer.*` already provide the live diagnostics surface. | PASS for keeping V1 implementations; remove the generation selector and V2 duplicates. |
| `navigation/*`, `layouts/*`, `text/*`, `icons/*`, `surfaces/*`, `usage/*` | Shared V1 presentation already contains the live controls; V1 feature owners contain current menus and routing. | PASS for keeping live consumers and removing unreferenced duplicates/compatibility wrappers. No new router or style system needed. |
| `browser/*`, `terminal/*`, `drawing/*`, `review/*`, `goal/*`, `settings/*`, `skills/*`, `changes/*`, `voice/*` | V1 has corresponding feature owners; V2 views depend on V2 DTOs, capabilities or rendering models. | FAIL as automatic transfer. Port only an independently demonstrated behavior gap through V1 contracts. |

### Inspected presentation inventory

All former V2 presentation modules were inventoried by imports and corresponding V1 owner. Selected
candidates above were read for behavior and ownership; the inventory alone is not visual parity proof.

| Area | Files |
| --- | ---: |
| actions | 7 |
| browser | 5 |
| changes | 1 |
| conversation | 25 |
| diagnostics | 9 |
| drawing | 2 |
| feedback | 1 |
| goal | 8 |
| icons | 1 |
| input | 6 |
| layouts | 3 |
| navigation | 19 |
| output | 2 |
| preview | 3 |
| queue | 9 |
| requests | 9 |
| review | 12 |
| settings | 3 |
| skills | 1 |
| surfaces | 2 |
| terminal | 3 |
| text | 3 |
| tokens.ts | 1 |
| usage | 11 |
| voice | 2 |

## Validation

Use `pnpm validate:android:v1` for the surviving frontend and
`pnpm --filter @codewide/android compile:android` for the Android Metro bundle.
`pnpm validate:sync:v2` remains independent for the retained protocol/backend.
The dependency boundary rejects V2 imports from every application route and source owner.
Knip no longer treats whole boot/presentation/V2 directories as live roots. The surviving boot and
presentation modules now run under the full V1 formatter/hygiene profile, without raising its debt
baseline. Shared UI render suites retain their original test environment and run as part of the V1
gate; tests owned by the V1 platform suite are not duplicated in the shared suite.

The historical `scripts/android-e2e.ts` generation-parity runner still contains V2-only scenarios
and generation-preference fault injection. It is not evidence for this V1-only frontend; adapting that
live-device harness is separate work and it was not run against a device during retirement.

Device cold start, warm deep links, notification selection and Back behavior still require physical
device evidence; source checks and a bundle cannot establish that evidence.

### Recorded local results

- `pnpm validate:android:v1`: passed, including native/web/compatibility type checks,
  43 V1 suites (178 tests), 39 shared UI suites (135 tests), strict Knip, hygiene without
  debt-baseline growth, and dependency boundaries.
- `pnpm test`: 283 suites / 1,907 tests passed. The subsequent focused runtime/router,
  policy and typography checks passed after the shared hygiene cleanup.
- `compile:android`: Metro built the application; source-map inspection found the V1
  workspace entry and no Android V2 or V2 sync-client modules.
- `git diff --check`: passed. No device installation, publication or commit was performed.
