import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ownerTimelineProjection,
  ownerTimelineViewport,
  ownerOverlayScrollOwnership,
  ownerUnreadReceipt,
  ownerJumpToLatest,
  ownerHistoryAnchor,
  ownerTimelineViewportState,
  ownerThreadTimeline,
} from "./conversation-timeline-sources";

const ownerTimelineMeasurementBindings = readFileSync(new URL("../../src/features/conversation/timeline/timelineMeasurementBindings.ts", import.meta.url), "utf8");

const gestureBindings = readFileSync(new URL("../../src/features/conversation/timeline/timelineGestureBindings.ts", import.meta.url), "utf8");

it("preserves conversation timeline integration contracts", () => {
  expect(ownerTimelineProjection).toContain(
    "status: normalizePendingDeliveryState(delivery.state)",
  );
  expect(ownerTimelineViewport).toMatch(
    /followTail=\{\s*!props\.fullscreenCovered\s*&&\s*props\.historyViewport\.containsLatest\s*&&\s*!props\.awayFromLatest\s*&&\s*!props\.threadSearchActive\s*\}/,
  );
  expect(gestureBindings).toMatch(
    /const away =\s*!props\.historyViewport\.containsLatest\s*\|\|\s*distance > LATEST_TIMELINE_THRESHOLD_PX;/,
  );
  expect(ownerTimelineViewport).toMatch(
    /<ThreadTimelineList\s+key=\{props\.composerScope\}\s+ref=\{timelineRef\}/,
  );
  expect(ownerOverlayScrollOwnership).toContain(
    "KeyboardController.dismiss({ animated: true, keepFocus: false })",
  );
  expect(ownerTimelineViewport).toContain('keyboardLiftBehavior="always"');
  expect(ownerTimelineViewport).toContain("onScrollBeginDrag={gestures.onScrollBeginDrag}");
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
  expect(ownerHistoryAnchor).toContain("const jumpTimelineToLatest = useEvent(() => {");
  expect(ownerJumpToLatest).toContain("onPress={jumpTimelineToLatest}");
  expect(ownerTimelineViewport).toContain("onEndReached={props.loadNewerAtTimelineEnd}");
  expect(ownerTimelineViewportState).toMatch(
    /const \[timelineDidLoad, setTimelineDidLoad\] =\s*useConversationState\(composerScope, \(\) => \(?false\)?\)/,
  );
  expect(ownerTimelineViewport).toContain(
    "onFirstVisibleItemChanged={props.onTimelineFirstVisibleItemChanged}",
  );
  expect(gestureBindings).toMatch(
    /lastTimelineOffsetYRef\.current =\s*nativeEvent\.contentOffset\.y/,
  );
  expect(ownerTimelineViewport).toContain("onStartReached={props.loadOlderAtTimelineStart}");
  expect(ownerTimelineViewport).toContain("showsVerticalScrollIndicator={false}");
  expect(ownerTimelineViewport).toContain("getItemType={(item) => item.kind}");
  expect(ownerHistoryAnchor).toContain(
    'const restoredToAnchor = timelineInitialPosition.kind === "item";',
  );
  expect(gestureBindings).toMatch(
    /const distance = Math\.max\(\s*0,\s*nativeEvent\.contentSize\.height -\s*nativeEvent\.layoutMeasurement\.height -\s*nativeEvent\.contentOffset\.y,?\s*\)/,
  );
  expect(ownerTimelineViewport).toContain("initialPosition={props.timelineInitialPosition}");
  expect(ownerHistoryAnchor).toContain("historyAnchorOffsetPx");
  expect(ownerTimelineMeasurementBindings).toContain("commitInitialTimelineLoad();");
  expect(ownerThreadTimeline).toContain(
    'await onFork({ boundary: { kind: "through", turnId }, ephemeral: false })',
  );
  expect(ownerThreadTimeline).toMatch(
    /<RecoverableRenderBoundary\s+key=\{boundaryKey\}\s+scope="bubble"\s+label="Conversation item"/,
  );
  expect(ownerTimelineViewport).toContain("renderRevision={props.composerScope}");
  expect(ownerTimelineViewport).toContain("<ThreadTimelineList");
  expect(ownerThreadTimeline).toContain("{ getAccess: props.getStableTransferAccess }");
  expect(ownerThreadTimeline).toMatch(/<PrivateImageAccessProvider\s+scope=\{props\.composerScope\}/);
});
