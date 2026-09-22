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
  expect(migratedMobileThreads).not.toContain("onPressIn=");
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
  expect(sourceObjectDeclaration(migratedThreadSwipeActions, "swipeActionsLayout")).toContain(
    "width: THREAD_SWIPE_ACTIONS_WIDTH",
  );
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
  expect(swipeActionsUnderlay).toContain("left: -THREAD_SWIPE_UNDERLAY_OVERLAP");
  expect(swipeActionsUnderlay).toContain("paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP");
  expect(swipeActionsUnderlay).toContain('position: "absolute"');
  expect(swipeActionsUnderlay).not.toContain(
    "width: THREAD_SWIPE_ACTIONS_WIDTH + THREAD_SWIPE_UNDERLAY_OVERLAP",
  );
  expect(sourceObjectDeclaration(migratedThreadSwipeActions, "swipeActionsRight")).toContain(
    'height: "100%"',
  );
  expect(sourceObjectDeclaration(migratedThreadSwipeActions, "swipeAction")).toContain(
    'alignSelf: "stretch"',
  );
  expect(
    sourceHasJsxElement(threadRow, "ThreadRowLinkTrigger", [
      '{...(selected ? { testID: "selected-thread-row" } : {})}',
      'accessibilityRole="link"',
      "cancelable",
      "delayLongPress={350}",
    ]),
  ).toBe(true);
  for (const list of [threadSidebarBody, migratedMobileThreads])
    expect(list.match(/getFixedItemSize=\{threadListRowHeight\}/g)).toHaveLength(1);
  expect(threadSidebarBody).toContain("extraData={selectedThreadKey}");
  for (const list of [threadSidebarBody, migratedMobileThreads]) {
    expect(list).toContain("maintainVisibleContentPosition={THREAD_LIST_VISIBLE_CONTENT_POSITION}");
    expect(list).toContain("onMomentumScrollBegin={scroll.onMomentumScrollBegin}");
    expect(list).toContain("onMomentumScrollEnd={scroll.onMomentumScrollEnd}");
    expect(list).toContain("onScrollBeginDrag={scroll.onScrollBeginDrag}");
    expect(list).toContain("onScrollEndDrag={scroll.onScrollEndDrag}");
    expect(list).not.toContain("scrollEventThrottle={100}");
  }
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_ROW_HEIGHT =\n  THREAD_LIST_ROW_CONTENT_HEIGHT + THREAD_LIST_ROW_VERTICAL_MARGIN * 2;",
  );
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_SECTION_HEIGHT = threadListLayout.sectionHeight;",
  );
});
