import type { RenderBlock } from "@codewide/renderers";
import { projectedTurnMetadata } from "@codewide/sync-client";
import { Ionicons } from "@expo/vector-icons";
import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import { StyleSheet, View } from "react-native";
import type { ThreadForkOptions } from "../../../data/thread-fork";
import { useEvent } from "../../../react/useEvent";
import { MarkdownLocalLinkProvider } from "../../../rendering/MarkdownLinkHandler";
import { SearchMessageFocus } from "../../../rendering/SearchMessageFocus";
import { TimelineDateSeparator } from "../../../rendering/TimelineDateSeparator";
import { PrivateImageAccessProvider } from "../../../rendering/use-private-image-uri";
import { colors, iconSize, spacing, typeScale } from "../../../theme";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { ThreadNavigationRowCommitBoundary } from "../../diagnostics/ThreadNavigationCommit";
import { OptimisticTurn } from "../turns/OptimisticTurn";
import { projectTurnPresentation } from "../turns/turnProjection";
import { formatTurnMeta } from "../turns/turnPresentation";
import { TurnTimelineItem } from "../turns/TurnTimelineItem";
import {
  VirtualizedTurnLeadItem,
  VirtualizedTurnTimelineItem,
} from "../turns/VirtualizedTurnTimelineItem";
import type { UseThreadTimelineProps } from "./ThreadTimeline.types";
import { timelineRowItem, type TimelineRow } from "./timelineRows";

export function useThreadTimeline(props: UseThreadTimelineProps) {
  const renderTimelineItem = ({ item: timelineRow }: LegendListRenderItemProps<TimelineRow>) => {
    const item = timelineRowItem(timelineRow);
    const boundaryKey =
      timelineRow.kind === "turnSlice" || timelineRow.kind === "turnLead"
        ? timelineRow.key
        : item.kind === "turn" || item.kind === "meta"
          ? item.key
          : `${item.scope}\u0000${item.id}`;
    const boundaryContext =
      item.kind === "turn"
        ? `Thread: ${item.threadId}\nTurn: ${item.id}`
        : `Timeline item: ${boundaryKey}`;
    const usage = item.kind === "turn" ? (projectedTurnMetadata(item.turn)?.usage ?? null) : null;
    const dateLabels = props.timelineDateLabels.get(item);
    const startsTurn =
      timelineRow.kind === "turnLead" ||
      (timelineRow.kind === "turnSlice" &&
        !timelineRow.followsLead &&
        (timelineRow.placement === "start" || timelineRow.placement === "single"));
    const dateLabel = startsTurn ? (dateLabels?.before ?? null) : null;
    const virtualizedSearchFocus =
      timelineRow.kind === "turnSlice" &&
      props.searchWindow !== null &&
      timelineRow.item.id === props.searchWindow.target.hit.turnId
        ? { itemId: props.searchWindow.messageItemId }
        : null;
    const virtualizedPresentation =
      timelineRow.kind === "turnSlice" || timelineRow.kind === "turnLead"
        ? projectTurnPresentation(
            timelineRow.item,
            virtualizedSearchFocus,
            props.onFork !== undefined,
            timelineRow.item.turn.status === "inProgress" && props.requestPrompt !== null,
          )
        : null;
    const ownsUnreadVisibility =
      timelineRow.kind === "turnSlice" &&
      timelineRow.item.id === props.latestUnreadAgentTurnId &&
      (timelineRow.placement === "start" || timelineRow.placement === "single");
    const row = (
      // The virtualized row owns one stable document identity. Recycling is off,
      // so leaving the render window unmounts this subtree instead of rebinding
      // its markdown/activity state to a different turn.
      <SearchMessageFocus.Provider
        key={boundaryKey}
        value={
          props.searchWindow !== null &&
          item.kind === "turn" &&
          item.id === props.searchWindow.target.hit.turnId
            ? {
                itemId: props.searchWindow.messageItemId,
                onLayout: props.focusSearchMessage,
                query: props.searchWindow.query,
              }
            : null
        }
      >
        <View style={styles.timelineRow}>
          {dateLabel === null ? null : <TimelineDateSeparator label={dateLabel} />}
          <RecoverableRenderBoundary
            context={boundaryContext}
            key={boundaryKey}
            label="Conversation item"
            resetKey={boundaryKey}
            scope="bubble"
          >
            <MarkdownLocalLinkProvider onOpen={props.openThreadDocumentLink}>
              <PrivateImageAccessProvider
                scope={props.composerScope}
                {...(props.getTransferAccess === undefined
                  ? {}
                  : { getAccess: props.getStableTransferAccess })}
              >
                <View
                  style={[styles.timelineItem, !props.timelineCompact && styles.timelineItemWide]}
                >
                  {item.kind === "turn" && timelineRow.kind === "item" && (
                    <TurnTimelineItem
                      agentDateLabel={dateLabels?.agent ?? null}
                      animateLiveUpdates={props.animateLiveUpdates}
                      compact={props.timelineCompact}
                      forceExpanded={props.threadSearchActive}
                      requestPrompt={item.turn.status === "inProgress" ? props.requestPrompt : null}
                      turn={item}
                      usage={usage}
                      {...(props.getTransferAccess === undefined
                        ? {}
                        : { getTransferAccess: props.getStableTransferAccess })}
                      {...(props.onFixUnsupportedBlock === undefined
                        ? {}
                        : { onFixUnsupportedBlock: props.fixUnsupportedBlock })}
                      {...(props.onFork === undefined
                        ? {}
                        : { onForkThroughTurn: props.forkThroughTurn })}
                      {...(props.onLoadTurnItems === undefined
                        ? {}
                        : { onLoadItems: props.loadStableTurnItems })}
                      {...(item.id === props.latestUnreadAgentTurnId
                        ? {
                            latestAgentRef: props.setLatestUnreadAgentNode,
                            onLatestAgentLayout: props.scheduleUnreadAgentVisibilityCheck,
                          }
                        : {})}
                    />
                  )}
                  {timelineRow.kind === "turnLead" && virtualizedPresentation !== null && (
                    <VirtualizedTurnLeadItem
                      presentation={virtualizedPresentation}
                      turn={timelineRow.item}
                      {...(props.getTransferAccess === undefined
                        ? {}
                        : { getTransferAccess: props.getStableTransferAccess })}
                      {...(props.onFixUnsupportedBlock === undefined
                        ? {}
                        : { onFixUnsupportedBlock: props.fixUnsupportedBlock })}
                    />
                  )}
                  {timelineRow.kind === "turnSlice" && virtualizedPresentation !== null && (
                    <VirtualizedTurnTimelineItem
                      agentDateLabel={dateLabels?.agent ?? null}
                      animateLiveUpdates={props.animateLiveUpdates}
                      compact={props.timelineCompact}
                      followsLead={timelineRow.followsLead}
                      forceExpanded={props.threadSearchActive}
                      parts={timelineRow.parts}
                      placement={timelineRow.placement}
                      presentation={virtualizedPresentation}
                      requestPrompt={
                        timelineRow.item.turn.status === "inProgress" ? props.requestPrompt : null
                      }
                      turn={timelineRow.item}
                      usage={usage}
                      {...(props.getTransferAccess === undefined
                        ? {}
                        : { getTransferAccess: props.getStableTransferAccess })}
                      {...(props.onFixUnsupportedBlock === undefined
                        ? {}
                        : { onFixUnsupportedBlock: props.fixUnsupportedBlock })}
                      {...(props.onFork === undefined
                        ? {}
                        : { onForkThroughTurn: props.forkThroughTurn })}
                      {...(props.onLoadTurnItems === undefined
                        ? {}
                        : { onLoadItems: props.loadStableTurnItems })}
                      {...(ownsUnreadVisibility
                        ? {
                            latestAgentRef: props.setLatestUnreadAgentNode,
                            onLatestAgentLayout: props.scheduleUnreadAgentVisibilityCheck,
                          }
                        : {})}
                    />
                  )}
                  {item.kind === "optimistic" && (
                    <OptimisticTurn
                      item={item}
                      {...(props.onRetryFailedMessage === undefined
                        ? {}
                        : { onRetry: props.onRetryFailedMessage })}
                      {...(props.getTransferAccess === undefined
                        ? {}
                        : { getTransferAccess: props.getTransferAccess })}
                    />
                  )}
                  {item.kind === "meta" && (
                    <View style={styles.turnMeta}>
                      <Ionicons
                        color={
                          item.status === "failed"
                            ? colors.red
                            : item.status === "inProgress"
                              ? colors.amber
                              : colors.green
                        }
                        name={
                          item.status === "failed"
                            ? "close"
                            : item.status === "interrupted"
                              ? "stop"
                              : item.status === "inProgress"
                                ? "ellipsis-horizontal"
                                : "checkmark"
                        }
                        size={iconSize.inline}
                      />
                      <Text style={styles.turnMetaText}>
                        {formatTurnMeta(item.status, item.durationMs, item.completedAt)}
                      </Text>
                    </View>
                  )}
                </View>
              </PrivateImageAccessProvider>
            </MarkdownLocalLinkProvider>
          </RecoverableRenderBoundary>
        </View>
      </SearchMessageFocus.Provider>
    );
    const ownsNavigationCommit =
      item.kind === "turn" &&
      (timelineRow.kind === "item" ||
        timelineRow.kind === "turnLead" ||
        (!timelineRow.followsLead &&
          (timelineRow.placement === "start" || timelineRow.placement === "single")));
    return ownsNavigationCommit ? (
      <ThreadNavigationRowCommitBoundary
        connectionId={item.connectionId}
        rowKey={item.key}
        threadId={item.threadId}
      >
        {row}
      </ThreadNavigationRowCommitBoundary>
    ) : (
      row
    );
  };
  return { renderTimelineItem };
}

const styles = StyleSheet.create({
  timelineItem: {
    alignSelf: "center",
    maxWidth: 880,
    width: "100%",
  },
  timelineItemWide: { alignSelf: "flex-start" },
  timelineRow: { width: "100%" },
  turnMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});

export function useThreadTimelineActions(
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined,
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined,
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined,
) {
  const fixUnsupportedBlock = useEvent(async (block: RenderBlock) => {
    if (onFixUnsupportedBlock === undefined) {
      throw new Error("Renderer repair is unavailable");
    }
    await onFixUnsupportedBlock(block);
  });
  const forkThroughTurn = useEvent(async (turnId: string) => {
    if (onFork === undefined) {
      throw new Error("Thread fork is unavailable");
    }
    await onFork({ boundary: { kind: "through", turnId }, ephemeral: false });
  });
  const loadStableTurnItems = useEvent(async (turnId: string) => {
    if (onLoadTurnItems === undefined) {
      throw new Error("Turn activity is unavailable");
    }
    await onLoadTurnItems(turnId);
  });

  return { fixUnsupportedBlock, forkThroughTurn, loadStableTurnItems };
}
