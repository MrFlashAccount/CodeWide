import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
import {
  ownerTimelineProjection,
  ownerTimelineJump,
  ownerTimelineViewport,
  ownerOverlayScrollOwnership,
  ownerUnreadReceipt,
  ownerJumpToLatest,
  ownerHistoryAnchor,
  ownerTimelineViewportState,
  ownerThreadTimeline,
} from "./conversation-timeline-sources";

const ownerTimelineMeasurementBindings = readFileSync(
  new URL(
    "../../src/features/conversation/timeline/timelineMeasurementBindings.ts",
    import.meta.url,
  ),
  "utf8",
);

const gestureBindings = readFileSync(
  new URL("../../src/features/conversation/timeline/timelineGestureBindings.ts", import.meta.url),
  "utf8",
);

it("preserves conversation timeline integration contracts", () => {
  expect(ownerTimelineProjection).toContain(
    "status: normalizePendingDeliveryState(delivery.state)",
  );
  expect(ownerTimelineViewport).toContain("initialScrollAtEnd={initialScrollAtEnd}");
  expect(ownerTimelineViewport).toContain(
    "projectTimelineRows(props.displayedTimeline, {\n    enabled: true,",
  );
  expect(ownerTimelineViewport).not.toContain("useV1FeatureFlag");
  expect(ownerTimelineViewport).toContain("maintainScrollAtEnd");
  expect(ownerTimelineViewport).toContain(
    "maintainScrollAtEndThreshold={TIMELINE_TAIL_MODE_THRESHOLD_RATIO}",
  );
  expect(ownerTimelineViewport).toContain("maintainVisibleContentPosition");
  expect(ownerTimelineViewport).not.toContain("shouldFollowTimelineTail");
  expect(gestureBindings).not.toContain("publishUserTailPosition");
  expect(
    sourceHasJsxElement(ownerTimelineViewport, "ThreadTimelineList", [
      "key={props.composerScope}",
      "ref={timelineRef}",
    ]),
  ).toBe(true);
  expect(ownerOverlayScrollOwnership).toContain(
    "KeyboardController.dismiss({ animated: true, keepFocus: false })",
  );
  // Keyboard lift and question-editing anchor behavior are exercised by v1-jump-to-latest.render.
  expect(ownerTimelineViewport).toContain("onScrollBeginDrag={onScrollBeginDrag}");
  expect(ownerTimelineViewport).toContain("anchoredEndSpace={");
  expect(ownerTimelineViewport).toContain("keyboardOffset={props.conversationInsets.bottom}");
  expect(ownerUnreadReceipt).toContain("claimUnreadReceipt(");
  expect(ownerUnreadReceipt).toContain("onViewedLatest?.();");
  const momentumBegin = gestureBindings.match(
    /const onMomentumScrollBegin = useEvent<[\s\S]*?>\(\(\) => \{([^}]+)\}\)/u,
  )?.[1];
  expect(momentumBegin).toContain("setTimelineGestureActive(true)");
  expect(momentumBegin).toContain("cancelScheduledPaginationTrim()");
  expect(momentumBegin).not.toMatch(/scrollTo|pinToEnd|historyViewport\.freeze/u);
  expect(ownerTimelineViewport).toContain("onMomentumScrollEnd={gestures.onMomentumScrollEnd}");
  expect(ownerTimelineViewport).toContain("onScrollEndDrag={gestures.onScrollEndDrag}");
  expect(ownerTimelineViewport).toContain("onStartReached={props.loadOlderAtTimelineStart}");
  expect(ownerTimelineViewport).toContain("onEndReached={props.loadNewerAtTimelineEnd}");
  expect(ownerTimelineViewport).toContain("scrollEventThrottle={16}");
  expect(ownerJumpToLatest).toContain('testID="jump-to-latest"');
  expect(ownerTimelineJump).toContain("const jumpTimelineToLatest = useEvent(() => {");
  expect(ownerJumpToLatest).toContain("onPress={jumpTimelineToLatest}");
  expect(ownerTimelineJump).toContain("historyViewport");
  expect(ownerTimelineJump).toContain(".loadLatest()");
  expect(ownerTimelineJump).toContain(".scrollToIndex({ animated: false");
  expect(ownerTimelineJump).toContain("list.scrollToEnd({ animated: false })");
  expect(ownerTimelineViewport).toContain("onEndReached={props.loadNewerAtTimelineEnd}");
  expect(ownerTimelineViewportState).toMatch(
    /const \[timelineDidLoad, setTimelineDidLoad\] =\s*useConversationState\(composerScope, \(\) => \(?false\)?\)/,
  );
  expect(ownerTimelineViewport).toContain("onFirstVisibleItemChanged={onFirstVisibleItemChanged}");
  expect(ownerTimelineViewport).toContain("props.onTimelineFirstVisibleItemChanged({");
  expect(gestureBindings).toMatch(
    /lastTimelineOffsetYRef\.current =\s*nativeEvent\.contentOffset\.y/,
  );
  expect(ownerTimelineViewport).toContain("onStartReached={props.loadOlderAtTimelineStart}");
  expect(ownerTimelineViewport).toContain("showsVerticalScrollIndicator={false}");
  expect(ownerTimelineViewport).not.toContain("getItemType");
  expect(ownerHistoryAnchor).not.toContain("timelineInitialPosition");
  expect(gestureBindings).toMatch(
    /const distance = Math\.max\(\s*0,\s*nativeEvent\.contentSize\.height -\s*nativeEvent\.layoutMeasurement\.height -\s*nativeEvent\.contentOffset\.y,?\s*\)/,
  );
  expect(ownerTimelineViewport).not.toContain("bootstrapInitialPosition");
  expect(ownerHistoryAnchor).not.toContain("historyAnchorOffsetPx");
  expect(ownerTimelineMeasurementBindings).toContain("commitInitialTimelineLoad();");
  expect(ownerThreadTimeline).toContain(
    'await onFork({ boundary: { kind: "through", turnId }, ephemeral: false })',
  );
  expect(
    sourceHasJsxElement(ownerThreadTimeline, "RecoverableRenderBoundary", [
      "key={boundaryKey}",
      'label="Conversation item"',
      'scope="bubble"',
    ]),
  ).toBe(true);
  expect(ownerTimelineViewport).toContain("renderRevision={props.composerScope}");
  expect(ownerTimelineViewport).toContain("<ThreadTimelineList");
  expect(ownerThreadTimeline).toContain("{ getAccess: props.getStableTransferAccess }");
  expect(
    sourceHasJsxElement(ownerThreadTimeline, "PrivateImageAccessProvider", [
      "scope={props.composerScope}",
    ]),
  ).toBe(true);
});
