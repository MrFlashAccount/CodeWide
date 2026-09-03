import { useContext, useRef } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import type { OnViewableItemsChangedInfo } from "@legendapp/list/react-native";

import { useEvent } from "../../../react/useEvent";
import { spacing } from "../../theme";
import { ThreadTimelineList, type ThreadTimelineListRef } from "./threadTimelineList";
import { TimelineEmptyView } from "./timelineEmptyView";
import { TimelineEdgeStateView } from "./timelineEdgeStateView";
import { TimelineNavigationView } from "./timelineNavigationView";
import { renderTimelineItem, TimelineRowProvider } from "./timelineRow";
import type {
  TimelineActivityActions,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
  TimelineTurnActionsResolver,
} from "./timelineTypes";
import { LATEST_ASSISTANT_VIEWABILITY, useLatestAssistantVisibility } from "./timelineVisibility";
import { useTimelineViewport, type TimelineEdge } from "./timelineViewport";

export type {
  TimelineActivityActions,
  TimelineActivityAttachment,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
  TimelineTurnActions,
} from "./timelineTypes";

/** @testOnly Exposes the closed activity union to rich rendering fixtures. */
export type { TimelineDisplayActivity } from "./timelineTypes";

export interface TimelineViewProps {
  activityActions?: TimelineActivityActions;
  actionsForTurn?: TimelineTurnActionsResolver;
  canLoadNewer?: boolean;
  canLoadOlder?: boolean;
  onLoadNewer?(): Promise<void>;
  onLoadOlder?(): Promise<void>;
  onLoadActivity?(turnId: string): Promise<TimelineDisplayResponseRow[]>;
  onJumpToLatest?(): Promise<string | null> | string | null;
  onLatestFinalAssistantVisible?(activityMarker: string): Promise<void> | void;
  readReceiptRetryKey?: string | null;
  onSettleWindow?(direction: TimelineEdge): void;
  timelineKey?: string;
  latestActivityMarker?: string | null;
  initialAnchorOffsetPx?: number | null;
  initialAnchorTurnId?: string | null;
  onAnchorTurnChange?(turnId: string | null, viewportOffsetPx: number | null): void;
  turns: TimelineDisplayTurn[];
  unreadCount?: number;
}

export function TimelineView(props: TimelineViewProps): React.JSX.Element {
  const {
    activityActions,
    actionsForTurn,
    canLoadNewer = false,
    canLoadOlder = false,
    onLoadNewer,
    onLoadOlder,
    onLoadActivity,
    onJumpToLatest,
    onLatestFinalAssistantVisible,
    readReceiptRetryKey = null,
    onSettleWindow,
    timelineKey = "conversation",
    latestActivityMarker = null,
    initialAnchorOffsetPx = null,
    initialAnchorTurnId = null,
    onAnchorTurnChange,
    turns,
    unreadCount = 0,
  } = props;
  const dimensions = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext);
  const listRef = useRef<ThreadTimelineListRef>(null);
  const clearPersistedAnchor = useEvent(() => onAnchorTurnChange?.(null, null));
  const viewport = useTimelineViewport({
    canLoadNewer,
    canLoadOlder,
    ...(onLoadNewer === undefined ? {} : { onLoadNewer }),
    ...(onLoadOlder === undefined ? {} : { onLoadOlder }),
    ...(onAnchorTurnChange === undefined ? {} : { onReachedLatest: clearPersistedAnchor }),
    ...(onJumpToLatest === undefined ? {} : { onJumpToLatest }),
    ...(onSettleWindow === undefined ? {} : { onSettleWindow }),
    listRef,
    turns,
    unreadCount,
  });
  const {
    latestTurnId,
    onLayout: handleVisibilityLayout,
    onViewableItemsChanged,
    scheduleMeasurement,
    setLatestAssistantNode,
    setViewportNode,
  } = useLatestAssistantVisibility({
    activityMarker: canLoadNewer ? null : latestActivityMarker,
    ...(onLatestFinalAssistantVisible === undefined
      ? {}
      : { onVisible: onLatestFinalAssistantVisible }),
    turns,
  });
  const handleScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.handleScroll(event);
    scheduleMeasurement();
  });
  const handleContentSizeChange = useEvent(() => {
    viewport.contentSizeChanged();
    scheduleMeasurement();
  });
  const handleViewableItemsChanged = useEvent(
    (info: OnViewableItemsChangedInfo<TimelineDisplayTurn>) => {
      onViewableItemsChanged(info);
      if (onAnchorTurnChange === undefined) return;
      const anchor = viewport.awayFromLatest ? (info.viewableItems[0]?.item.id ?? null) : null;
      const offset =
        anchor === null ? null : (listRef.current?.getItemViewportOffset(anchor) ?? null);
      onAnchorTurnChange(anchor, offset);
    },
  );
  const anchorIndex =
    initialAnchorTurnId === null ? -1 : turns.findIndex((turn) => turn.id === initialAnchorTurnId);

  return (
    <TimelineRowProvider
      {...(activityActions === undefined ? {} : { activityActions })}
      {...(actionsForTurn === undefined ? {} : { actionsForTurn })}
      latestAssistantTurnId={latestTurnId}
      latestAssistantMeasurementKey={readReceiptRetryKey}
      onLatestAssistantLayout={handleVisibilityLayout}
      {...(onLoadActivity === undefined ? {} : { onLoadActivity })}
      setLatestAssistantNode={setLatestAssistantNode}
    >
      <View ref={setViewportNode} onLayout={handleVisibilityLayout} style={styles.container}>
        <ThreadTimelineList
          ref={listRef}
          automaticallyAdjustContentInsets={false}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="never"
          data={turns}
          extraData={`${canLoadNewer}:${canLoadOlder}:${viewport.loadingEdge ?? "idle"}`}
          followTail={!canLoadNewer && !viewport.awayFromLatest}
          initialPosition={
            anchorIndex < 0
              ? { kind: "tail" }
              : {
                  index: anchorIndex,
                  kind: "item",
                  viewOffset: initialAnchorOffsetPx ?? 0,
                  viewPosition: 0,
                }
          }
          keyExtractor={turnKey}
          keyboardDismissMode="interactive"
          keyboardLiftBehavior="whenAtEnd"
          keyboardOffset={insets?.bottom ?? 0}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={TimelineEmptyView}
          ListFooterComponent={
            <TimelineEdgeStateView
              edge="newer"
              failed={viewport.loadError === "newer"}
              loading={viewport.loadingEdge === "newer"}
              onRetry={viewport.loadNewer}
            />
          }
          ListHeaderComponent={
            <TimelineEdgeStateView
              edge="older"
              failed={viewport.loadError === "older"}
              loading={viewport.loadingEdge === "older"}
              onRetry={viewport.loadOlder}
            />
          }
          measurementRevision={`${dimensions.width}:${dimensions.height}:${dimensions.scale}:${dimensions.fontScale}`}
          onContentSizeChange={handleContentSizeChange}
          onEndReached={viewport.loadNewer}
          onEndReachedThreshold={0.5}
          onMomentumScrollEnd={viewport.endGesture}
          onScroll={handleScroll}
          onScrollBeginDrag={viewport.beginGesture}
          onScrollEndDrag={viewport.endGesture}
          onStartReached={viewport.loadOlder}
          onStartReachedThreshold={0.5}
          onViewableItemsChanged={handleViewableItemsChanged}
          renderItem={renderTimelineItem}
          renderRevision={timelineKey}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          testID="conversation-timeline"
          viewabilityConfig={LATEST_ASSISTANT_VIEWABILITY}
        />
        <TimelineNavigationView
          onJumpToLatest={viewport.jumpToLatest}
          unseenCount={viewport.unseenCount}
          visible={canLoadNewer || viewport.awayFromLatest}
        />
      </View>
    </TimelineRowProvider>
  );
}

function turnKey(turn: TimelineDisplayTurn): string {
  return turn.id;
}

const styles = StyleSheet.create({
  container: { flex: 1, position: "relative" },
  list: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  scroll: { flex: 1 },
});
