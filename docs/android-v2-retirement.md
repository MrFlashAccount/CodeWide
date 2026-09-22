# CodeWide V2 retirement

Date: 2026-09-21. Source baseline: `0e39482ae39136ed8305b5787795af0066f4773a`.

The subsequent unversioned-route cleanup and remaining-name inventory are recorded in
[the version-reference audit](version-reference-audit.md).

## Contract and scope

Android has one application router, under the URL-invisible `app/(workspace)` group. Its index
owns `/`; legacy, pairing, and notification aliases enter that workspace; its existing process deep-link listener still receives the original URL. Startup no longer
reads a generation preference, imports V2 diagnostics, or creates a V2 runtime. Native V1 resource
activation/cleanup remains serialized and separate from process-lifetime JavaScript state.

Removed: V2 Expo route groups, `src/v2`, generation preference/switch/diagnostics adapters, tests of
those deleted implementations, and their frontend-only gate configuration. Mixed V1/V2 tests retain
the V1 cases. Existing native protocol isolation/security tests remain applicable.

The follow-up decision also retires the CodeWide Companion V2 protocol, sync-client
subpath, and native implementation. The only Companion API remains `/v1`; Android
workspace routes have no version prefix. The external Codex App Server generated
`v0.155.1/v2` contract is unrelated and remains required.

Removed backend/native scope: `sync_v2`, its generated contract and generator,
`sync-client/src/v2`, V2 native sync/storage/notifications/voice/transport leases,
V2-only fault hooks, protocol tests, generation-parity Appium harness and its
unused dependencies. The surviving release checks continue to run; the old parity
validator was already outside Android release checks. Device smoke/lifecycle/layout/
upgrade checks remain available through `pnpm test:android-device`. No replacement
live-conversation E2E coverage or physical-device validation is claimed.

Two existing V1 dependencies were extracted before deletion:

- `file_uploads` owns authenticated resumable uploads, bounded streaming, durable
  device ownership, cancellation, quotas and revocation cleanup. Historical database
  filename/table/owner-key prefixes stay unchanged so existing uploads retain their
  ownership. These strings do not expose or enable a V2 API.
- `server/port_forwarding` preserves service identity checks and session-bound
  binary forwarding. Android now uses `/v1/port-forwards/:port`; explicit discovered
  identities must match the current service. Legacy clients without identity headers
  retain compatibility. Device-session streams close on expiry or revocation.

Pairing proof domain `codewide-pairing-v2`, native credential bridge method
`saveConnectionCredentialsV2`, and persisted cache/policy schema names are retained
compatibility identifiers used by the surviving client. Removing or renaming them
would break pairing, native bridge compatibility, or existing data.

No deployed service, installed app, credentials, or persisted data are modified by
this source retirement.

## Alternatives and falsification

| Lane | Candidate | Verdict | Evidence / cost |
| --- | --- | --- | --- |
| Incremental | Force the generation preference to V1 | FAIL | Already implemented: the loader read storage and then always published legacy. Root imports and Router still retained V2. |
| Structural | Remove V2 routes, runtime imports and their orphaned frontend; keep live V1 presentation | PASS | Matches the requested boundary. Knip explicitly rooted all V2/presentation files, so deleting route files alone could not retire their graph. |
| Radical | Remove the whole CodeWide V2 protocol/runtime | PASS after explicit follow-up authorization | Consumer audit identified uploads and forwarding as live V1 dependencies; both were extracted with their security behavior and compatibility identifiers. Source deletion is reversible in Git; deployment is separate. |

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
Use `pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`
and `cargo fmt --all -- --check` for the surviving backend.
The dependency boundary rejects V2 imports from every application route and source owner.
Knip no longer treats whole boot/presentation/V2 directories as live roots. The surviving boot and
presentation modules now run under the full V1 formatter/hygiene profile, without raising its debt
baseline. Shared UI render suites retain their original test environment and run as part of the V1
gate; tests owned by the V1 platform suite are not duplicated in the shared suite.

Device cold start, warm deep links, notification selection and Back behavior still require physical
device evidence; source checks and a bundle cannot establish that evidence.

### Historical frontend-only validation results

- `pnpm validate:android:v1`: passed, including native/web/compatibility type checks,
  43 V1 suites (178 tests), 39 shared UI suites (135 tests), strict Knip, hygiene without
  debt-baseline growth, and dependency boundaries.
- `pnpm test`: 283 suites / 1,907 tests passed. The subsequent focused runtime/router,
  policy and typography checks passed after the shared hygiene cleanup.
- `compile:android`: Metro built the application; source-map inspection found the V1
  workspace entry and no Android V2 or V2 sync-client modules.
- `git diff --check`: passed. No device installation, publication or commit was performed.

### Full protocol retirement validation

- Workspace TypeScript checks passed, including native, web, and compatibility projects.
- Both Android render suites passed: 44 suites / 183 tests and 39 suites / 135 tests.
- Strict Knip and dependency-cruiser passed (2,148 modules / 7,734 dependencies).
- Android bundle compiled; source-map verification found the workspace and no V2 modules.
- Native E2E Kotlin compilation and focused forwarding, authority lifecycle, proxy and
  device-key tests passed. Full native tests had one unrelated failure in
  `VoiceOverlayMenuGeometryTest` (242 passed / 1 failed).
- `pnpm test`: 272 suites passed, one failed in the parallel `ImagePreviewHost`
  fullscreen-contract changes (1,822 tests passed / 1 failed).
- `pnpm validate:android:v1` reached hygiene and failed on two new rule groups in that
  same parallel `ImagePreviewHost` file. No baseline or suppression was changed.
- Cargo workspace tests passed (438 tests, 2 ignored), as did strict Clippy. Transport tests cover retired API
  paths returning 404 and stale discovered forwarding identities returning 409.
- No device installation or publication was performed for the protocol retirement.
