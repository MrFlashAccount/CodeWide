import { type RenderBlock } from "@codewide/renderers";
import { projectedTurnMetadata } from "@codewide/sync-client";
import { Ionicons } from "@expo/vector-icons";
import { type LegendListRenderItemProps } from "@legendapp/list/react-native";
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
import { formatTurnMeta } from "../turns/turnPresentation";
import { TurnTimelineItem } from "../turns/TurnTimelineItem";
import type { UseThreadTimelineProps } from "./ThreadTimeline.types";
import { type TimelineItem } from "./timelineTypes";
export function useThreadTimeline(props: UseThreadTimelineProps) {
  const renderTimelineItem = ({ item }: LegendListRenderItemProps<TimelineItem>) => {
    const boundaryKey =
      item.kind === "turn" || item.kind === "meta" ? item.key : `${item.scope}\u0000${item.id}`;
    const boundaryContext =
      item.kind === "turn"
        ? `Thread: ${item.threadId}\nTurn: ${item.id}`
        : `Timeline item: ${boundaryKey}`;
    const usage = item.kind === "turn" ? (projectedTurnMetadata(item.turn)?.usage ?? null) : null;
    const dateLabels = props.timelineDateLabels.get(item);
    const dateLabel = dateLabels?.before ?? null;
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
                query: props.searchWindow.query,
                onLayout: props.focusSearchMessage,
              }
            : null
        }
      >
        <View style={styles.timelineRow}>
          {dateLabel === null ? null : <TimelineDateSeparator label={dateLabel} />}
          <RecoverableRenderBoundary
            key={boundaryKey}
            scope="bubble"
            label="Conversation item"
            context={boundaryContext}
            resetKey={boundaryKey}
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
                  {item.kind === "turn" && (
                    <TurnTimelineItem
                      turn={item}
                      agentDateLabel={dateLabels?.agent ?? null}
                      compact={props.timelineCompact}
                      animateLiveUpdates={props.animateLiveUpdates}
                      usage={usage}
                      forceExpanded={props.threadSearchActive}
                      requestPrompt={
                        item.turn.status === "inProgress" ? props.requestPrompt : null
                      }
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
                        color={
                          item.status === "failed"
                            ? colors.red
                            : item.status === "inProgress"
                              ? colors.amber
                              : colors.green
                        }
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
    return item.kind === "turn" ? (
      <ThreadNavigationRowCommitBoundary
        connectionId={item.connectionId}
        threadId={item.threadId}
        rowKey={item.key}
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
  timelineRow: { width: "100%" },
  timelineItem: { width: "100%", maxWidth: 880, alignSelf: "center" },
  timelineItemWide: { alignSelf: "flex-start" },
  turnMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
  },
  turnMetaText: { color: colors.textMuted, ...typeScale.caption },
});

export function useThreadTimelineActions(
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined,
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined,
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined,
) {
  const fixUnsupportedBlock = useEvent(async (block: RenderBlock) => {
    if (onFixUnsupportedBlock === undefined) throw new Error("Renderer repair is unavailable");
    await onFixUnsupportedBlock(block);
  });
  const forkThroughTurn = useEvent(async (turnId: string) => {
    if (onFork === undefined) throw new Error("Thread fork is unavailable");
    await onFork({ boundary: { kind: "through", turnId }, ephemeral: false });
  });
  const loadStableTurnItems = useEvent(async (turnId: string) => {
    if (onLoadTurnItems === undefined) throw new Error("Turn activity is unavailable");
    await onLoadTurnItems(turnId);
  });

  return { fixUnsupportedBlock, forkThroughTurn, loadStableTurnItems };
}
