import { expect, it } from "vitest";
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
    /void action\(\)\.catch\(\(cause\) =>\s*dialog\.alert/,
  );
  expect(swipeActionStart).toBeGreaterThanOrEqual(0);
  expect(swipeActionStart).toBeLessThan(
    threadRowActions.indexOf("if (closeSwipe) swipeableRef.current?.close()"),
  );
  expect(threadRow).toContain("renderRightActions={() => (");
  expect(threadRow).toContain("<ThreadSwipeActions>");
  expect(migratedThreadRowStyles).toMatch(
    /swipeContainer: \{[\s\S]*?backgroundColor: "transparent"[\s\S]*?\},\s*swipeChildren: \{[\s\S]*?backgroundColor: "transparent"/,
  );
  expect(migratedThreadSwipeActions).toMatch(
    /swipeActionsUnderlay: \{[\s\S]*?backgroundColor: colors\.surfaceContainerHigh[\s\S]*?paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP/,
  );
  expect(migratedThreadSwipeActions).toMatch(/swipeActionsRight: \{[\s\S]*?height: "100%"/);
  expect(migratedThreadSwipeActions).toMatch(/swipeAction: \{[\s\S]*?alignSelf: "stretch"/);
  expect(threadRow).toMatch(
    /<GesturePressable\s+\{\.\.\.\(selected \? \{ testID: "selected-thread-row" \} : \{\}\)\}\s+accessibilityRole="button"\s+cancelable\s+delayLongPress=\{350\}/,
  );
  for (const list of [threadSidebarBody, migratedMobileThreads])
    expect(list.match(/getFixedItemSize=\{threadListRowHeight\}/g)).toHaveLength(1);
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_ROW_HEIGHT =\n  THREAD_LIST_ROW_CONTENT_HEIGHT + THREAD_LIST_ROW_VERTICAL_MARGIN * 2;",
  );
  expect(migratedThreadListModel).toContain(
    "const THREAD_LIST_SECTION_HEIGHT = threadListLayout.sectionHeight;",
  );
});
