import { useNativeListGroups } from "../../../rendering/nativeMarkdownListHost";
import {
  ThreadTimelineList,
  type ThreadTimelineListProps,
} from "../../../rendering/ThreadTimelineList";
import { RichMarkdownPremeasurementProvider } from "../../../rendering/RichMarkdownPremeasurementProvider";
import { timelineRowPremeasurementEnabled$ } from "../../../data/timelineRowPremeasurementPreference";
import { useSelector } from "@legendapp/state/react";
import { useEvent } from "../../../react/useEvent";
import { useLayoutEffect, useRef, type ReactElement } from "react";
import { observablePrimitive } from "@legendapp/state";
import { useConstant } from "../../../react/useConstant";
import { usePaneBodyMode } from "../../../ui/paneBodyTransition";
import {
  conversationBottomContentInset,
  conversationHeaderChromeHeight,
  conversationTopContentInset,
} from "../../../ui/conversation-chrome-layout";
import { surfaceToneCanvasStyle, useSurfaceTone } from "../../../ui/surfaceTone";
import { prepareTimelineOpening } from "./timelineInitialReveal";
import { savedReadingIndex, useThreadReadingPosition } from "./threadReadingPosition";
import { useTimelineReadingGestures } from "./timelineReadingGestures";
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
import {
  historyBeginningSizeEstimate,
  timelineMarkdownContentWidth,
  timelineRowHeight,
} from "./timelineRowPremeasurement";
import { useTimelineScrollDiagnostics, useTimelineScrollPolicy } from "./timelineScrollDiagnostics";
import { useRunningTaskPlacement } from "./useRunningTaskPlacement";
import { TaskNotificationLine } from "../turns/TaskNotificationLine";
import { styles } from "./TimelineViewport.styles";
import type { TimelineViewportProps } from "./TimelineViewportContract";

type ResponseStartAnchor = { readonly index: number; readonly key: string } | null;

const TIMELINE_HISTORY_PREFETCH_THRESHOLD_RATIO = 1.5;
const MINIMUM_TIMELINE_RENDER_AHEAD_PX = 250;

export function TimelineViewport(props: TimelineViewportProps): ReactElement {
  const rowPremeasurementEnabled = useSelector(timelineRowPremeasurementEnabled$);
  const bodyWidth = useTimelineBodyWidth(props.windowLayout.width, rowPremeasurementEnabled);
  const nativeLists = useNativeListGroups(rowPremeasurementEnabled);
  const rows = projectTimelineRows(props.displayedTimeline, {
    containsBeginning: props.historyViewport.containsBeginning,
    enabled: true,
    nativeLists,
    packMarkdown: !rowPremeasurementEnabled,
    searchMessageItemId: props.searchMessageItemId,
    threadSearchActive: props.threadSearchActive,
  });
  const placement = useRunningTaskPlacement(rows, showsConversationTail(props));
  const timelineRows = placement.rows;
  const canvas = surfaceToneCanvasStyle(useSurfaceTone());
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
  const reading = useThreadReadingPosition(props.draftConnectionId, props.draftThreadId);
  const { readingIndex, responsePositioningEnabled, unreadTurnId } = timelineOpeningPosition(
    props,
    timelineRows,
    reading,
  );
  const responsePositioning = useTimelineResponsePositioning({
    awayFromLatest: props.awayFromLatest,
    composerScope: props.composerScope,
    enabled: responsePositioningEnabled,
    latestUnreadAgentTurnId: unreadTurnId,
    rows: timelineRows,
    timelinePositioned: props.timelinePositioned,
  });
  const responseStartAnchor = resolveResponseStartAnchor(
    responsePositioningEnabled,
    timelineRows,
    responsePositioning.request?.turnId ?? null,
  );
  const responseStartOffset = conversationTopContentInset(props.threadSearchVisible);
  const responseStartTopInset = conversationHeaderChromeHeight(props.threadSearchVisible);
  const responseStartBottomInset = conversationBottomContentInset(
    props.bottomChromeHeight,
    props.liveStatusVisible,
  );
  const getTimelineList = useEvent(() => timelineRef.current);
  const timelineRowSizeHint = useTimelineRowSizeHint({
    diagnostics,
    fontScale: props.windowLayout.fontScale,
    markdownWidth: bodyWidth.markdown,
    premeasured: rowPremeasurementEnabled,
    rows,
    scale: props.windowLayout.scale,
    timelineDateLabels: props.timelineDateLabels,
  });
  const rowMeasurementRevision = timelineRowMeasurementRevision(
    props.composerScope,
    rowPremeasurementEnabled,
  );
  const onItemSizeChanged = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineRow>["onItemSizeChanged"]>
  >((event) => {
    diagnostics.itemSizeChanged({
      index: event.index,
      previousSizePx: event.previous,
      rowKind: event.itemData.kind,
      sizePx: event.size,
    });
  });
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
  const gestures = useTimelineReadingGestures(props, {
    clearResponseStartRequest: responsePositioning.clearResponseStartRequest,
    reading,
    responseStartTopInset,
    timelineRows,
  });
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
  const prepareInitialReveal = useEvent(async () =>
    prepareTimelineOpening({
      anchor: responseStartAnchor,
      bottomInset: responseStartBottomInset,
      list: timelineRef.current,
      offset: responseStartOffset,
      readingIndex,
      request: responsePositioning.request,
      topInset: responseStartTopInset,
      unreadOpening: reading?.opening.kind === "unread",
    }),
  );
  const measurement = useTimelineMeasurementBindings(props, {
    measureWidth: bodyWidth.measure,
    onGeometryChanged: reconcileJumpVisibility,
    prepareInitialReveal,
  });
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
    onJumpStart: responsePositioning.clearResponseStartRequest,
    persistTimelineAtEnd: useEvent(() => {
      reading?.session.atEnd();
      persistTimelineAtEnd();
    }),
    scrollOffsetRef,
    timelineJumpRequest,
    timelineRef,
    timelineViewportRef,
  });
  const initialScrollAtEnd = shouldInitiallyScrollToEnd(
    responseStartAnchor,
    props.timelinePositioned || readingIndex !== undefined,
  );
  const initialScrollIndex = timelineInitialIndex(
    props.timelinePositioned,
    readingIndex,
    responsePositioning.request?.initialPosition(responseStartAnchor, responseStartOffset),
  );
  useTimelineScrollPolicy(diagnostics, props, {
    anchor: responseStartAnchor,
    initialScrollAtEnd,
    responseRequest: responsePositioning.request,
    rowCount: timelineRows.length,
  });
  const listFooter = (
    <>
      <TaskNotificationLine reports={placement.footer} />
      {props.footerContent}
    </>
  );
  return (
    <RichMarkdownPremeasurementProvider
      enabled={rowPremeasurementEnabled}
      fontScale={props.windowLayout.fontScale}
      width={timelineMarkdownContentWidth(bodyWidth.markdown)}
    >
      <ThreadTimelineList
        anchoredEndSpace={responsePositioning.request?.anchorSpace({
          anchor: responseStartAnchor,
          bottomInset: responseStartBottomInset,
          diagnostics,
          getList: getTimelineList,
          maxViewportHeight: props.windowLayout.height,
          offset: responseStartOffset,
          topInset: responseStartTopInset,
        })}
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.conversationContent,
          props.timelineCompact
            ? styles.conversationContentCompact
            : styles.conversationContentWide,
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
        extraData={`${props.threadSearch}:${String(props.threadSearchMatch)}:${props.windowLayout.measurementRevision}:${String(rowPremeasurementEnabled)}:${props.renderTimelineItemRevision}`}
        initialScrollAtEnd={initialScrollAtEnd}
        initialScrollIndex={initialScrollIndex}
        itemSizeEstimate={timelineRowSizeEstimate()}
        itemSizeHint={timelineRowSizeHint}
        key={props.composerScope}
        keyboardDismissMode="interactive"
        keyboardLiftBehavior={props.newChat ? "never" : "always"}
        keyboardOffset={props.conversationInsets.bottom}
        keyboardShouldPersistTaps="handled"
        keyExtractor={timelineRowKey}
        ListEmptyComponent={props.emptyContent}
        ListFooterComponent={listFooter}
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={TIMELINE_TAIL_MODE_THRESHOLD_RATIO}
        maintainVisibleContentPosition
        measureInitialBuffer={readingIndex !== undefined}
        nestedScrollEnabled
        onContentSizeChange={measurement.onContentSizeChange}
        onEndReached={props.loadNewerAtTimelineEnd}
        onEndReachedThreshold={TIMELINE_HISTORY_PREFETCH_THRESHOLD_RATIO}
        onFirstVisibleItemChanged={onFirstVisibleItemChanged}
        onItemSizeChanged={onItemSizeChanged}
        onLayout={measurement.onLayout}
        onLoad={onLoad}
        onMomentumScrollBegin={gestures.onMomentumScrollBegin}
        onMomentumScrollEnd={gestures.onMomentumScrollEnd}
        onReady={measurement.onReady}
        onScroll={gestures.onScroll}
        onScrollBeginDrag={gestures.onScrollBeginDrag}
        onScrollEndDrag={gestures.onScrollEndDrag}
        onStartReached={props.loadOlderAtTimelineStart}
        onStartReachedThreshold={TIMELINE_HISTORY_PREFETCH_THRESHOLD_RATIO}
        overscanDistance={Math.max(MINIMUM_TIMELINE_RENDER_AHEAD_PX, props.windowLayout.height)}
        ref={timelineRef}
        renderItem={props.renderTimelineItem}
        renderRevision={rowMeasurementRevision}
        scrollEnabled={!props.inlineQueueExpanded}
        scrollEventThrottle={16}
        scrollsChildToFocus={false}
        showsVerticalScrollIndicator={false}
        style={[styles.conversationScroll, canvas]}
        testID="conversation-timeline"
      />
    </RichMarkdownPremeasurementProvider>
  );
}

function useTimelineBodyWidth(windowWidth: number, premeasured: boolean) {
  const resizing = usePaneBodyMode() !== "fixed";
  const width$ = useConstant(() => observablePrimitive(0));
  // Only the opt-in exact Markdown layout subscribes. Native rows already measure themselves.
  const markdown = useSelector(() => (resizing && premeasured ? width$.get() : windowWidth));
  const measure = useEvent((width: number) => {
    if (resizing) {
      width$.set(width);
    }
  });
  return { markdown, measure };
}

function timelineInitialIndex(
  positioned: boolean,
  saved: ReturnType<typeof savedReadingIndex>,
  unread: ReturnType<typeof savedReadingIndex>,
) {
  return positioned ? undefined : (saved ?? unread);
}

function shouldInitiallyScrollToEnd(
  anchor: ResponseStartAnchor,
  timelinePositioned: boolean,
): boolean {
  return anchor === null && !timelinePositioned;
}

function showsConversationTail(props: TimelineViewportProps): boolean {
  return props.historyViewport.containsLatest && !props.threadSearchActive;
}

function resolveResponseStartAnchor(
  enabled: boolean,
  rows: readonly TimelineRow[],
  turnId: string | null,
): ResponseStartAnchor {
  return !enabled || turnId === null ? null : timelineResponseStartRow(rows, turnId);
}

function timelineOpeningPosition(
  props: TimelineViewportProps,
  timelineRows: readonly TimelineRow[],
  reading: ReturnType<typeof useThreadReadingPosition>,
) {
  const regular = {
    readingIndex: undefined,
    responsePositioningEnabled: responsePositioningIsEnabled(props, false),
    unreadTurnId: props.latestUnreadAgentTurnId,
  };
  if (reading === null || props.threadSearchActive) {
    return regular;
  }
  const { opening, session } = reading;
  if (opening.kind === "saved") {
    return {
      ...regular,
      readingIndex: props.timelinePositioned
        ? undefined
        : savedReadingIndex(timelineRows, opening.bookmark),
      unreadTurnId: session.hasReturnedToEnd ? regular.unreadTurnId : null,
    };
  }
  if (opening.kind === "unread" && !props.timelinePositioned) {
    return {
      ...regular,
      responsePositioningEnabled: responsePositioningIsEnabled(props, true),
      unreadTurnId: opening.turnId,
    };
  }
  return regular;
}

function responsePositioningIsEnabled(
  props: TimelineViewportProps,
  openingUnread: boolean,
): boolean {
  return (
    !props.fullscreenCovered &&
    !props.threadSearchActive &&
    (openingUnread || props.historyViewport.containsLatest) &&
    props.timelineJumpRequest === null
  );
}

function useTimelineRowSizeHint(input: {
  diagnostics: ReturnType<typeof useTimelineScrollDiagnostics>;
  fontScale: number;
  markdownWidth: number;
  premeasured: boolean;
  rows: readonly TimelineRow[];
  scale: number;
  timelineDateLabels: TimelineViewportProps["timelineDateLabels"];
}) {
  const getTimelineRowSizeHint = useEvent((row: TimelineRow) => {
    const startedAt = performance.now();
    const dateLabels = input.timelineDateLabels.get(row.item);
    const result = timelineRowHeight(row, {
      agentDateVisible: timelineRowStartsAgentResponse(row) && (dateLabels?.agent ?? null) !== null,
      beforeDateVisible: timelineRowStartsTurn(row) && (dateLabels?.before ?? null) !== null,
      density: input.scale,
      fontScale: input.fontScale,
      viewportWidth: input.markdownWidth,
    });
    input.diagnostics.fixedSize(performance.now() - startedAt, result, row.kind);
    return result.status === "exact"
      ? { size: result.size, status: "exact" as const }
      : { size: result.estimate, status: "estimated" as const };
  });
  const estimatedRowSizeHint = useEvent((row: TimelineRow) =>
    row.kind === "historyBeginning"
      ? {
          size: historyBeginningSizeEstimate(input.fontScale),
          status: "estimated" as const,
        }
      : packedRowSizeHint(row),
  );
  return input.premeasured
    ? getTimelineRowSizeHint
    : hasEstimatedRows(input.rows)
      ? estimatedRowSizeHint
      : undefined;
}

function timelineRowStartsAgentResponse(row: TimelineRow): boolean {
  return row.kind === "turnSlice" && isLeadingTimelinePlacement(row.placement);
}

function timelineRowStartsTurn(row: TimelineRow): boolean {
  if (row.kind === "turnLead") {
    return true;
  }
  return row.kind === "turnSlice" && !row.followsLead && isLeadingTimelinePlacement(row.placement);
}

function isLeadingTimelinePlacement(placement: "end" | "middle" | "single" | "start"): boolean {
  return placement === "single" || placement === "start";
}

function hasEstimatedRows(rows: readonly TimelineRow[]): boolean {
  return rows.some(
    (row) =>
      row.kind === "historyBeginning" ||
      (row.kind === "turnSlice" && row.packedSizeEstimate !== undefined),
  );
}

function packedRowSizeHint(row: TimelineRow) {
  return row.kind === "turnSlice" && row.packedSizeEstimate !== undefined
    ? { size: row.packedSizeEstimate, status: "estimated" as const }
    : undefined;
}

function timelineRowMeasurementRevision(composerScope: string, enabled: boolean): string {
  return `${composerScope}:${enabled ? "premeasured" : "estimated"}`;
}
