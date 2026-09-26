import {
  ThreadTimelineList,
  type ThreadTimelineListProps,
} from "../../../rendering/ThreadTimelineList";
import { useEvent } from "../../../react/useEvent";
import { useLayoutEffect, useRef, type ReactElement } from "react";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../../../ui/conversation-chrome-layout";
import { AppText as Text } from "../../../ui/Typography";
import { useTimelineGestureBindings } from "./timelineGestureBindings";
import { TIMELINE_TAIL_MODE_THRESHOLD_RATIO } from "./historyAnchor";
import { useTimelineJumpExecution } from "./timelineJump";
import { useTimelineMeasurementBindings } from "./timelineMeasurementBindings";
import { timelineItemKey } from "./timelineProjection";
import {
  projectTimelineRows,
  timelineRowItem,
  timelineRowKey,
  timelineResponseStartRow,
  timelineRowSizeEstimate,
  type TimelineRow,
} from "./timelineRows";
import { useTimelineResponsePositioning } from "./timelineResponsePositioning";
import { useTimelineScrollDiagnostics, useTimelineScrollPolicy } from "./timelineScrollDiagnostics";
import { styles } from "./TimelineViewport.styles";
import type { TimelineViewportProps } from "./TimelineViewportContract";

type ResponseStartAnchor = { readonly index: number; readonly key: string } | null;

export function TimelineViewport(props: TimelineViewportProps): ReactElement {
  const {
    awayFromLatestRef,
    completeTimelineJump,
    fullscreenCovered,
    latestUnreadAgentRef,
    persistTimelineAtEnd,
    scrollOffsetRef,
    timelineJumpRequest,
    timelineRef,
    timelineViewportRef,
  } = props;
  const diagnostics = useTimelineScrollDiagnostics(props);
  const timelineRows = projectTimelineRows(props.displayedTimeline, {
    enabled: true,
    searchMessageItemId: props.searchMessageItemId,
    threadSearchActive: props.threadSearchActive,
  });
  const responsePositioningEnabled = responsePositioningIsEnabled(props);
  const responsePositioning = useTimelineResponsePositioning({
    awayFromLatest: props.awayFromLatest,
    composerScope: props.composerScope,
    enabled: responsePositioningEnabled,
    latestUnreadAgentTurnId: props.latestUnreadAgentTurnId,
    rows: timelineRows,
    timelinePositioned: props.timelinePositioned,
  });
  const responseStartAnchor = resolveResponseStartAnchor(
    responsePositioningEnabled,
    timelineRows,
    responsePositioning.request?.turnId ?? null,
  );
  const responseStartOffset = conversationTopContentInset(props.threadSearchVisible);
  const getTimelineList = useEvent(() => timelineRef.current);
  const onFirstVisibleItemChanged = useEvent(
    ({ index, item: row }: { index: number; item: TimelineRow; key: string }) => {
      diagnostics.record({ index, kind: "visible-row" });
      const item = timelineRowItem(row);
      props.onTimelineFirstVisibleItemChanged({
        index: row.timelineIndex,
        item,
        key: timelineItemKey(item),
      });
    },
  );
  const gestures = useTimelineGestureBindings(props);
  const loadedScopeRef = useRef<string | null>(null);
  const reconcileJumpVisibility = useEvent(() => {
    if (
      loadedScopeRef.current !== props.composerScope ||
      props.fullscreenScrollOwnership.isCovered() ||
      props.threadSearchActive
    ) {
      return;
    }
    const distance = props.timelineRef.current?.getDistanceFromEnd();
    if (distance !== undefined && distance !== null) {
      props.jumpVisibility.update(distance, props.historyViewport.containsLatest);
    }
  });
  const measurement = useTimelineMeasurementBindings(props, reconcileJumpVisibility);
  const reconcileEndThreshold = useEvent((withinThreshold: boolean) => {
    diagnostics.record({ kind: "end-threshold", withinThreshold });
    if (
      loadedScopeRef.current !== props.composerScope ||
      props.fullscreenScrollOwnership.isCovered() ||
      props.threadSearchActive
    ) {
      return;
    }
    const away = !props.historyViewport.containsLatest || !withinThreshold;
    reconcileJumpVisibility();
    const wasAway = awayFromLatestRef.current;
    if (away !== wasAway) {
      awayFromLatestRef.current = away;
      props.setAwayFromLatest(away);
    }
    if (!away && wasAway) {
      props.persistTimelineAtEnd();
    }
  });
  const reconcileCurrentEndThreshold = useEvent(() => {
    const withinThreshold = props.timelineRef.current?.isWithinEndThreshold();
    if (withinThreshold !== undefined && withinThreshold !== null) {
      reconcileEndThreshold(withinThreshold);
    }
  });
  const onLoad = useEvent<NonNullable<ThreadTimelineListProps<TimelineRow>["onLoad"]>>((event) => {
    measurement.onLoad(event);
    loadedScopeRef.current = props.composerScope;
    reconcileCurrentEndThreshold();
  });
  const onScrollBeginDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineRow>["onScrollBeginDrag"]>
  >((event) => {
    responsePositioning.clearResponseStartRequest();
    gestures.onScrollBeginDrag(event);
  });
  useLayoutEffect(() => {
    loadedScopeRef.current = null;
    const unsubscribe = props.timelineRef.current?.subscribeEndThreshold(reconcileEndThreshold);
    return () => {
      loadedScopeRef.current = null;
      unsubscribe?.();
    };
  }, [props.composerScope, props.timelineRef, reconcileEndThreshold]);
  useLayoutEffect(() => {
    reconcileCurrentEndThreshold();
  }, [props.historyViewport.containsLatest, reconcileCurrentEndThreshold]);
  useTimelineJumpExecution({
    completeTimelineJump,
    diagnostics,
    fullscreenCovered,
    latestUnreadAgentRef,
    persistTimelineAtEnd,
    scrollOffsetRef,
    timelineJumpRequest,
    timelineRef,
    timelineViewportRef,
  });
  const initialScrollAtEnd = shouldInitiallyScrollToEnd(
    responseStartAnchor,
    props.timelinePositioned,
  );
  useTimelineScrollPolicy(diagnostics, props, {
    anchor: responseStartAnchor,
    initialScrollAtEnd,
    responseRequest: responsePositioning.request,
    rowCount: timelineRows.length,
  });
  const listHeader = timelineListHeader(props);
  return (
    <ThreadTimelineList
      anchoredEndSpace={responsePositioning.request?.anchorSpace({
        anchor: responseStartAnchor,
        diagnostics,
        getList: getTimelineList,
        offset: responseStartOffset,
      })}
      automaticallyAdjustContentInsets={false}
      contentContainerStyle={[
        styles.conversationContent,
        props.timelineCompact ? styles.conversationContentCompact : styles.conversationContentWide,
        {
          paddingBottom: conversationBottomContentInset(
            props.bottomChromeHeight,
            props.liveStatusVisible,
          ),
          paddingTop: conversationTopContentInset(props.threadSearchVisible),
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      data={timelineRows}
      diagnostics={diagnostics}
      extraData={`${props.threadSearch}:${String(props.threadSearchMatch)}:${props.windowLayout.measurementRevision}`}
      initialScrollAtEnd={initialScrollAtEnd}
      initialScrollIndex={props.timelinePositioned ? undefined : responseStartAnchor?.index}
      itemSizeEstimate={timelineRowSizeEstimate(timelineRows)}
      key={props.composerScope}
      keyboardDismissMode="interactive"
      keyboardLiftBehavior={props.newChat ? "never" : "always"}
      keyboardOffset={props.conversationInsets.bottom}
      keyboardShouldPersistTaps="handled"
      keyExtractor={timelineRowKey}
      ListEmptyComponent={props.emptyContent}
      ListFooterComponent={props.footerContent}
      ListHeaderComponent={listHeader}
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={TIMELINE_TAIL_MODE_THRESHOLD_RATIO}
      maintainVisibleContentPosition
      nestedScrollEnabled
      onContentSizeChange={measurement.onContentSizeChange}
      onEndReached={props.loadNewerAtTimelineEnd}
      onEndReachedThreshold={0.5}
      onFirstVisibleItemChanged={onFirstVisibleItemChanged}
      onLayout={measurement.onLayout}
      onLoad={onLoad}
      onMomentumScrollBegin={gestures.onMomentumScrollBegin}
      onMomentumScrollEnd={gestures.onMomentumScrollEnd}
      onScroll={gestures.onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={gestures.onScrollEndDrag}
      onStartReached={props.loadOlderAtTimelineStart}
      onStartReachedThreshold={0.5}
      ref={timelineRef}
      renderItem={props.renderTimelineItem}
      renderRevision={props.composerScope}
      scrollEnabled={!props.inlineQueueExpanded}
      scrollEventThrottle={16}
      scrollsChildToFocus={false}
      showsVerticalScrollIndicator={false}
      style={styles.conversationScroll}
      testID="conversation-timeline"
    />
  );
}

function shouldInitiallyScrollToEnd(
  anchor: ResponseStartAnchor,
  timelinePositioned: boolean,
): boolean {
  return anchor === null && !timelinePositioned;
}

function timelineListHeader(props: TimelineViewportProps): ReactElement | null {
  return props.historyViewport.containsBeginning &&
    !props.threadSearchActive &&
    props.displayedTimeline.length > 0 ? (
    <Text style={styles.historyBeginning} testID="history-beginning">
      You’re at the beginning of this conversation
    </Text>
  ) : null;
}

function resolveResponseStartAnchor(
  enabled: boolean,
  rows: readonly TimelineRow[],
  turnId: string | null,
): ResponseStartAnchor {
  return !enabled || turnId === null ? null : timelineResponseStartRow(rows, turnId);
}

function responsePositioningIsEnabled(props: TimelineViewportProps): boolean {
  return (
    !props.fullscreenCovered &&
    !props.threadSearchActive &&
    props.historyViewport.containsLatest &&
    props.timelineJumpRequest === null
  );
}
