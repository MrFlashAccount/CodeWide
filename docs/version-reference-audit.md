# Version-reference audit and unversioned Android routes

> This inventory describes the earlier frontend-only cleanup. The subsequent full
> CodeWide V2 retirement supersedes its live-protocol findings and radical option.
> See [current scope and compatibility identifiers](android-v2-retirement.md).


Date: 2026-09-21. Baseline: `e77ff6e37c0a9a2bd04154f6147579bffbaf7b96` plus the current parallel working-tree changes.

## Implemented URL cleanup

- The application index is `/`; destinations include `/new`, `/search`, `/settings`, `/projects`, `/threads/[connectionId]/[threadId]` and their children.
- `app/(workspace)` is a URL-invisible Expo Router group. The root framework/security shell and workspace runtime layout keep their distinct lifetimes. The duplicate root redirect was removed.
- No `/v1` aliases remain. Existing `/legacy`, `/pair` and `/thread` compatibility entries still enter `/`; the existing process deep-link listener retains original pairing and notification URL handling.
- Nine navigation helpers moved to `src/routeComposition`. Expo previously discovered these helpers as routes, including `V1WorkspaceShell`, `V1WorkspaceRouteModel`, `draftToolRouteSession` and `threadRouteNavigation`. They no longer appear in the URL tree.
- All navigation destinations, root/peer selection, recovery paths, route-session bindings, tests, source references and route policy scopes follow the new paths. Features, services and lower owners cannot import route composition.
- The local ignored Expo route-type cache was regenerated using the installed Expo generator; it previously contained both prefixed routes and deleted frontend routes. Expo regenerates this cache during development startup.

The installed Expo route-discovery implementation and navigation/render tests are the evidence for path resolution; no physical-device result is claimed.

## Inventory after cleanup

Counts are case-insensitive **literal substring occurrences**, including identifiers, imports, comments and string values. Each cell is **occurrences / files containing them**. Files can contain both versions. This is a textual inventory, not a dead-code or removal count.

Scope: the union of `git ls-files --cached --others --exclude-standard -z`, deduplicated, restricted to existing UTF-8 text files without NUL bytes. Ignored build output, node_modules and `.expo` are excluded. This report is excluded to avoid counting its own results. Parallel edits may change subsequent counts.

| Area | V1 | V2 |
| --- | ---: | ---: |
| Android E2E tooling | 468 / 12 | 638 / 16 |
| Android TS source | 553 / 212 | 124 / 105 |
| Android native | 75 / 26 | 428 / 32 |
| Android route screens | 134 / 37 | 0 / 0 |
| Android tests | 313 / 54 | 79 / 32 |
| Android tooling | 63 / 8 | 9 / 4 |
| Companion | 432 / 46 | 1586 / 92 |
| Documentation | 464 / 53 | 540 / 30 |
| Generated, vendored assets and lockfiles | 1024 / 227 | 2583 / 134 |
| Other | 85 / 19 | 47 / 17 |
| Sync client | 35 / 4 | 1019 / 41 |
| **Total** | **3646 / 698** | **7053 / 503** |

There are 1001 distinct files containing either substring. Separately, 73 existing file paths contain `v1` and 1073 contain `v2`; generated Codex protocol paths contribute heavily. Generated/vendor/lockfile matches include unrelated local identifiers and integrity strings and are not application architecture debt.

To reproduce the raw counting rule, decode each eligible file as UTF-8 and count `re.findall("v1", text, re.I)` and `re.findall("v2", text, re.I)`. Count a file once per version if its occurrence count is nonzero. Classify Markdown first, then generated/schema files, `.generated.*`, `*Generated.kt`, assets and lockfiles, then the application/package owners in the table.

## What remains and why

| Family | Evidence | Disposition |
| --- | --- | --- |
| Internal UI names and comments | `V1ThreadDestination`, `V1ThreadRouteParams`, route component names, `v1MobileRouteMotion`, `useV1WorkspaceDeepLinks` | Naming cleanup candidates. They no longer add a URL prefix. Rename symbols and their consumers together. |
| Android gate/test/document names | `validate:android:v1`, `oxlint.v1.config.mjs`, `knip.v1.config.mjs`, `v1-*.test.*`, architecture documents | Can be made generation-neutral in a separate coordinated tooling rename; retain every check. |
| Obsolete frontend parity harness | `scripts/android-e2e.ts`, `scripts/android-e2e/evidencePolicy.ts`, generation-switch and visual-comparison scenarios | Real retirement debt. The harness still expects the removed generation switch. Rewrite around the single frontend before claiming device parity evidence. |
| Companion V1 and V2 wire contracts | `crates/companion-core/contract/v1.json`, `v2.json`, `src/sync_v2/**`, `/v1/sync`, `/v2/sync` | Live compatibility boundaries, not UI prefixes. Do not rename by text replacement. |
| Sync-client V2 implementation | `packages/sync-client/src/v2/**`, `/v2` package export and tests | Still implemented independently of the Android frontend; Android import rules forbid using it from the remaining application. |
| Native V2 support | `CodexConnectionService.kt`, `NativeSyncGeneration`, authenticated lease, V2 notification stores and `CodeWidePackage.kt` registration of `V2VoiceCaptureModule` | Still present. Knip cannot establish Kotlin reachability. Removing it requires a separate native lifecycle/notification/credential review. |
| Codex App Server V2 | 95 Android TS source files import `@codewide/codex-protocol/v0.155.1/v2` | Current upstream API types used by the surviving UI. This version is unrelated to the removed frontend. |
| Stored data/cache formats | `thread-details-v2`, `thread-summaries-v2`, `workspace-turn-controls-v2`, `user-preferences-v1`, attachment-cache paths | Persisted identities. Renaming can hide existing data or trigger rehydration; needs migration, not cosmetic cleanup. |
| External/native API versions | `saveConnectionCredentialsV2`, voice catalog `voices.v1` / `defaultV1` | Retain declared bridge and provider compatibility. |
| Historical architecture | `android-v2-client-architecture.md`, `android-v2-visual-parity.md`, migration ledgers | Preserve as history or archive explicitly; they are not active routes. |

## Decision lanes

- **Incremental — PASS:** remove only the public URL segment using an invisible route group. Implemented, with helper modules removed from route discovery. Keeping redirect-only prefixed aliases would not satisfy the requested cleanup.
- **Structural — CONDITIONAL:** rename remaining internal UI/gate identifiers and replace generation-parity E2E tooling with single-frontend scenarios. Benefit: fewer misleading ownership names and runnable device scenarios. Cheapest proof: migrate one full navigation/device scenario while preserving all assertions; then rename tooling with consumer checks.
- **Radical — CONDITIONAL:** retire the entire Companion/sync-client/native V2 protocol stack. Potential benefit: remove a whole contract/runtime and its dual-generation lifecycle. There is no verified evidence here that every non-UI consumer is retired. Risks include stored native generation, notification restoration and external client compatibility. Source deletion is reversible in Git; deployed compatibility changes may require rollback or migration. Cheapest experiment: map all native/server entry consumers and exercise cold-start, reconnect, background notification and credential recovery with V2 registration disabled in an isolated build. This audit does not authorize or implement that protocol retirement.

## Validation

- Android bundle compiled and the source-map check found the workspace entry with no Android frontend or sync-client V2 modules.
- Real Expo route discovery resolves unversioned destinations and excludes navigation helpers.
- Both render suites passed: 43 suites / 179 tests and 39 suites / 135 tests, including peer navigation, Back, new-thread admission, search and retained route-session behavior.
- Full Vitest run: 281 suites passed; two tests failed in parallel Global Voice work (speech-state event sequence and the native-runtime-types probe observing an additional WebRTC TS7006 diagnostic). Total: 1906 passed / 2 failed.
- `pnpm validate:android:v1` was run and is blocked by the parallel `globalSupervisorWebRtcSession.native.ts` event parameter type. The separate hygiene check reports 14 regression groups only in the parallel Global Voice files. No baseline or suppression was added for them.
- Knip passed. Dependency-cruiser passed across 2150 modules and 7730 dependencies.
- Focused route-discovery, navigation, route-session and feature-boundary tests passed.
- No device installation or release was performed.

## After full protocol retirement (2026-09-21)

Case-insensitive raw substring occurrences in existing tracked and untracked non-ignored
text files; historical documents and upstream-generated contracts are counted separately.
This is a naming inventory, not a count of APIs or reachable modules.

| Category | V1 occurrences | V2 occurrences | Matching files |
| --- | ---: | ---: | ---: |
| Documentation | 522 | 588 | 62 |
| External Codex protocol | 38 | 1298 | 27 |
| Remaining source/config/tests | 2544 | 811 | 761 |

No CodeWide V2 route/runtime/client entrypoint remains. Retained version names belong
to upstream protocols, stored formats, pairing/bridge compatibility, historical
documents, and negative tests that assert retired endpoints are unavailable.
