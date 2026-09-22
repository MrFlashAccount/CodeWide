# Thread catalog regression: APK 0.2.178

Status: source changes implemented; physical Android validation and publication pending.

## Evidence from the published release

The release artifact record is `builds/android/CodeWide-0.2.178-191-20260921-145843-a0288168.apk.json`.
APK SHA-256: `a0288168c45965ee18b17a28ce451f8b549bab67cbe550f3b736a3283d3faf33`.
Runtime: `0.2.178-native-191`.
Associated packager source map SHA-256: `e140e6b234c92505b1a1cfd6ada0b964fc83b9dc1756ce24fa743702532f33fa`.
Both local hashes were checked. All 928 Android source entries were extracted from that map into an isolated reproduction checkout. The working checkout was not rolled back.

The release-source reproduction mounts production `MobileThreads`, catalog/window ownership, SQLite merge and Legend view publication together. A real in-memory SQLite engine substitutes for the native SQL bridge. The existing test host replaces LegendList virtualization and decorative UI; it invokes the actual list callbacks. This proves the release source contract, not the exact handset state or Android's native callback timing.

Five scenarios against the release source: **4 fail, 1 passes**. The active and archived drag scenarios first assert that cursor `36` was requested and thread `71` was durably stored, then fail because that row is not rendered. Early end intent and undersized viewport also fail. The concurrent refresh scenario passes in 0.2.178: its previously released cursor-owner fix already protects the requested tail.

## Causes and correction

| Chain | Release behavior | Correction |
| --- | --- | --- |
| End callback → demand | The callback rejects demand when the displayed count is below the requested limit. A callback received while a small cached page is refreshing is discarded. Displayed count also shrinks under filtering and is not a server continuation contract. | Retain/deduplicate the intent, await current catalog demand, then advance the range if remote or local continuation exists. |
| Cursor → RPC → merge → render during drag | `onEndReached` advances the limit; the next cursor is requested, merged and published. The scroll owner nevertheless supplies the entire old `frozenRows` array until drag/momentum ends. | Keep existing row order frozen while admitting newly loaded tail rows. |
| Short first page → next callback | No measurement-driven continuation exists. With no scrollable extent or another edge callback, the list stays at its current range. | Layout and content-size measurements retain a fill intent until the viewport fills, the catalog ends, or loading fails. No effect-triggered fetch. |
| Multiple servers → merged range | Remote cursors can all be exhausted although the global SQLite range still has unshown rows, e.g. 25 + 25 with a visible limit of 36. | Continuation also checks whether the requested local partition has another row. |
| Background refresh during next-page request | 0.2.178 already publishes the requested prefix before restarting the head. | Preserve that behavior and cover it through the real model/render chain with a blocked tail and blocked refresh head. |

The local supervisor policy was a separate ownership defect, not a proven explanation of the user's exact stalled handset. It could reduce the visible count and exacerbate the count gate. No claim depends on the user having precisely one hidden row.

## Server-owned membership

Companion excludes all reserved `codewide-global-supervisor:` sources from ordinary thread pages, archived counts and search results. Ephemeral/root membership is applied by the server to ordinary pages. It preserves opaque `nextCursor`, including on empty filtered pages. Only a null cursor means remote exhaustion.

The private `companion/supervisor/threadList` method reconciles a supervisor by an exact validated creation source. It keeps the supervisor lifecycle functional without reopening it in the ordinary catalog.

Live/replayed events and private thread metadata carry the server's `codewideCatalogExcluded` instruction. Catalog summaries carry `excludedThreadIds` to evict stale persisted rows, including pinned/unread rows. Android validates and applies these server instructions; it does not infer membership from the device binding, source prefix, title or UI route. The remaining tool-target guard only prevents the assistant's worker tools from addressing itself; it does not filter catalog/search/render data.

Deployment requires the new Companion before the new Android build. New Android intentionally has no fallback to the removed local policy. No version bump, APK/OTA publication or Companion deployment was performed.

## Validation

- Exact 0.2.178 release-source reproduction: 4 expected failures, 1 passing refresh-race scenario.
- Current end-to-end catalog/render regressions: 8 passing (active/archive × ordinary/project drag, early intent, short viewport, refresh race, merged local remainder).
- Scroll contracts include preserving gesture order while admitting the tail, settlement and scope changes.
- Real WebSocket Companion RPC regression: ordinary active/archive/project empty pages retain continuation, private reconciliation is exact-source only, invalid private source is rejected.
- Durable SQLite regressions cover server-directed pinned/unread eviction across reopening, server-admitted rows regardless of local source, and private metadata/live/replay membership.
- `pnpm validate:android:v1`: passed on final rerun. Native/web/compatibility type checks, 49 V1 suites / 215 tests, 39 shared suites / 135 tests, hygiene (no regressions), Knip and dependency boundaries all pass.
- `pnpm --filter @codewide/android compile:android`: passed; 4,176 modules, retired V2 frontend absent.
- `pnpm test:companion`: passed, including the wire and stale search-index regressions.
- `CARGO_INCREMENTAL=0 cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo fmt --all -- --check`: passed.
- `pnpm test`: 1,834 pass, 3 fail across 277 files. The remaining failures are pre-existing expectations for parallel work: `app-lock.test.ts` expects the old gated router source shape; `global-supervisor-background-lifecycle.test.ts` expects the old overlay bounds call; `native-app-config.test.ts` workspace contract expects the old `viewportWidth` composition prop. The removed supervisor-storage expectation was corrected; all catalog/visibility regressions pass. No check was suppressed.

## Device work still required

No device is listed by `adb devices -l`.

1. After separately authorized server/client releases, start with the existing persisted catalog, including old pinned/unread assistant entries. Confirm ordinary catalog/search excludes the assistant while Global Voice resumes or recovers its exact private thread.
2. On mobile and tablet, continuously drag/fling through active/archive/project lists with concurrent chats. Confirm older rows appear during the gesture, the anchor stays stable, and loading recovers across reconnects.
3. Check a short initial page, empty server-filtered pages, multi-server aggregation and final exhaustion. Confirm automatic fill without an extra gesture and no fetch loop after exhaustion/unmount.
4. Record foreground and background CPU, frame timing and catalog request rate with two active chats. The original ~200% CPU complaint is not considered resolved by source tests or bundle compilation.

## Files in this change

Android production changes (parallel edits in these files were preserved):

- `apps/android/src/data/catalog-runtime.ts`
- `apps/android/src/data/thread-catalog-window.ts`
- `apps/android/src/data/thread-catalog-loader.ts`
- `apps/android/src/data/thread-summary-database-contract.ts`
- `apps/android/src/data/thread-summary-database.native.ts`
- `apps/android/src/data/thread-summary-database.web.ts`
- `apps/android/src/data/thread-summary-projection.ts`
- `apps/android/src/data/threadCatalogMembership.ts`
- `apps/android/src/data/threadCatalogInvalidation.ts`
- `apps/android/src/data/thread-sync-projection.ts`
- `apps/android/src/data/workspace-runtime.ts`
- `apps/android/src/data/globalSupervisorWorkspaceRuntime.ts`
- `apps/android/src/data/globalSupervisorThreadRemote.ts`
- `apps/android/src/data/globalSupervisorToolTarget.ts`
- `apps/android/src/data/globalSupervisorTools.ts`
- `apps/android/src/features/search/workspaceAdapter.ts`
- `apps/android/src/features/workspace/createWorkspaceFeatures.ts`
- `apps/android/src/features/threadList/threadListPageRequest.ts`
- `apps/android/src/features/threadList/threadListViewportPaging.ts`
- `apps/android/src/features/threadList/threadListWorkspace.ts`
- `apps/android/src/features/threadList/threadListModel.ts`
- `apps/android/src/features/threadList/projectThreadList.ts`
- `apps/android/src/features/threadList/MobileThreadsContract.ts`
- `apps/android/src/features/threadList/ThreadSidebarContract.ts`
- `apps/android/src/features/threadList/MobileThreads.tsx`
- `apps/android/src/features/threadList/ThreadSidebar.tsx`
- `apps/android/src/features/threadList/threadListScroll.ts`
- `apps/android/app/(workspace)/threads/[connectionId]/[threadId]/_layout.tsx`
- `apps/android/src/data/thread-summary-sqlite.native.ts`

Deleted local policy modules:

- `apps/android/src/data/globalSupervisorVisibility.ts`
- `apps/android/src/data/globalSupervisorSummaryStoragePolicy.ts`

Server changes:

- `crates/companion-core/src/catalog_visibility.rs`
- `crates/companion-core/src/catalog.rs`
- `crates/companion-core/src/catalog_summary.rs`
- `crates/companion-core/src/history_service.rs`
- `crates/companion-core/src/lib.rs`
- `crates/companion-core/src/sync.rs`
- `crates/companion-core/src/message_search/mod.rs`

Regression fixtures/contracts:

- `apps/android/test/thread-catalog-loader.test.ts`
- `apps/android/test/thread-catalog-window.test.ts`
- `apps/android/test/thread-catalog-pagination.fixture.ts`
- `apps/android/test/v1-thread-catalog-pagination.render.test.tsx`
- `apps/android/test/v1-thread-list-scroll.render.test.tsx`
- `apps/android/test/v1-catalog-runtime.render.test.tsx`
- `apps/android/test/thread-list-query-contract.test.ts`
- `apps/android/test/project-summary-sqlite.test.ts`
- `apps/android/test/global-supervisor-visibility.test.ts`
- `apps/android/test/global-supervisor-search-visibility.test.ts`
- `apps/android/test/global-supervisor-tools.test.ts`
- `apps/android/test/global-supervisor-thread-remote.test.ts`
- `apps/android/test/thread-sync-projection.test.ts`
- `apps/android/test/workspace-navigation.render.test.tsx`
- `apps/android/test/native-app-contracts/runtime.contract.ts`
- `apps/android/test/native-app-contracts/workspace.contract.ts`
- `crates/companion-core/src/message_search/tests.rs`
- `apps/companion-linux/tests/sync_transport.rs`

Ownership documentation:

- `apps/android/src/data/CONTEXT.md`
- `apps/android/src/features/threadList/CONTEXT.md`
- `docs/android-v1-feature-architecture.md`
- This report.
