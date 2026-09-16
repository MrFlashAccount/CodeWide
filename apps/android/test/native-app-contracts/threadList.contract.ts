import { expect, it } from "vitest";
import { sourceHasJsxElement, sourceObjectDeclaration } from "../source-contract";
import {
  threadSidebarHeader,
  mobileThreadsHeader,
  listMenus,
  threadRow,
  migratedThreadListWorkspace,
  migratedThreadListProjection,
  migratedMobileThreads,
  migratedThreadRowContent,
  threadRowActions,
  migratedThreadRowStyles,
  migratedThreadSwipeActions,
  threadSidebarBody,
  migratedThreadListModel,
} from "./threadList-sources";

it("preserves threadList integration contracts", () => {
  for (const header of [threadSidebarHeader, mobileThreadsHeader])
    expect(header.match(/<ThreadFilterMenu/gu)).toHaveLength(1);
  const threadFilterMenu = listMenus.slice(listMenus.indexOf("function ThreadFilterMenu("));
  expect(threadFilterMenu).toContain("<ActionMenu");
  expect(threadFilterMenu).not.toContain("<AppSheet");
  expect(threadFilterMenu).not.toContain("<AppPopover");
  expect(threadRow).toContain("Pressable as GesturePressable");
  expect(listMenus).toContain("function ThreadFilterMenu(");
  expect(listMenus).toContain('? "Thread filters, no filters selected"');
  expect(migratedThreadListWorkspace).toContain(
    'recentLimit: threadListMode === "active" ? threadListLimit : 0',
  );
  expect(migratedThreadListWorkspace).toContain("const threadSummaryView = useThreadSummaryView(");
  expect(migratedThreadListProjection).toContain("timestamp: thread.recencyAt ?? thread.updatedAt");
  expect(migratedMobileThreads).toContain(
    "onPressIn={() => onPreloadThread(threadSelectionKey(item.thread))}",
  );
  expect(migratedThreadRowContent).toContain("style={styles.unreadDot}");
  const swipeActionStart = threadRowActions.search(
    /void action\(\)\.catch\(\(error: unknown\) =>\s*\{\s*dialog\.alert/,
  );
  expect(swipeActionStart).toBeGreaterThanOrEqual(0);
  const closeSwipeStart = threadRowActions.indexOf("if (closeSwipe)");
  expect(closeSwipeStart).toBeGreaterThanOrEqual(0);
  expect(swipeActionStart).toBeLessThan(closeSwipeStart);
  expect(threadRow).toContain("renderRightActions={() => (");
  expect(threadRow).toContain("<ThreadSwipeActions>");
  expect(sourceObjectDeclaration(migratedThreadRowStyles, "swipeContainer")).toContain(
    'backgroundColor: "transparent"',
  );
  expect(sourceObjectDeclaration(migratedThreadRowStyles, "swipeChildren")).toContain(
    'backgroundColor: "transparent"',
  );
  const swipeActionsUnderlay = sourceObjectDeclaration(
    migratedThreadSwipeActions,
    "swipeActionsUnderlay",
  );
  expect(swipeActionsUnderlay).toContain("backgroundColor: colors.surfaceContainerHigh");
  expect(swipeActionsUnderlay).toContain("paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP");
  expect(sourceObjectDeclaration(migratedThreadSwipeActions, "swipeActionsRight")).toContain(
    'height: "100%"',
  );
  expect(sourceObjectDeclaration(migratedThreadSwipeActions, "swipeAction")).toContain(
    'alignSelf: "stretch"',
  );
  expect(
    sourceHasJsxElement(threadRow, "GesturePressable", [
      '{...(selected ? { testID: "selected-thread-row" } : {})}',
      'accessibilityRole="button"',
      "cancelable",
      "delayLongPress={350}",
    ]),
  ).toBe(true);
  for (const list of [threadSidebarBody, migratedMobileThreads])
    expect(list.match(/getFixedItemSize=\{threadListRowHeight\}/g)).toHaveLength(1);
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_ROW_HEIGHT =\n  THREAD_LIST_ROW_CONTENT_HEIGHT + THREAD_LIST_ROW_VERTICAL_MARGIN * 2;",
  );
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_SECTION_HEIGHT = threadListLayout.sectionHeight;",
  );
});
