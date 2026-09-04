import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { TOKEN_SYMBOL } from "../../ui/tokenDisplay";
import { formatEstimatedTurnCost } from "../../turnCost";
import { Bubble, BubbleContent } from "../../rendering/Bubble";
import { richMarkdownLayout } from "../../rendering/RichMarkdown";
import { PresentationText as Text, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { MessageActionRailView } from "./MessageActionRailView";
import { TimelineActivityRow, TimelineActivityView } from "./timelineActivityView";
import { TimelineUserInputView } from "./timelineUserInputView";
import {
  timelineClockLabel,
  timelineCompactNumber,
  timelineDurationLabel,
  timelineStatusDotStyle,
  timelineTurnStateLabel,
} from "./timelineFormat";
import type {
  TimelineActivityActions,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
  TimelineTurnActions,
} from "./timelineTypes";

interface TimelineTurnViewProps {
  activityActions?: TimelineActivityActions;
  actions?: TimelineTurnActions;
  latestAssistantRef?(node: View | null): void;
  latestAssistantMeasurementKey?: string | null;
  onLatestAssistantLayout?(): void;
  onLoadActivity?(turnId: string): Promise<TimelineDisplayResponseRow[]>;
  turn: TimelineDisplayTurn;
}

export function TimelineTurnView(props: TimelineTurnViewProps): React.JSX.Element {
  const {
    actions,
    activityActions,
    latestAssistantRef,
    latestAssistantMeasurementKey,
    onLatestAssistantLayout,
    onLoadActivity,
    turn,
  } = props;
  const assistantText = turn.assistantText.join("\n\n");
  const sentAt = timelineClockLabel(turn.createdAt);
  const completedAt = timelineClockLabel(turn.completedAt);
  const duration = timelineDurationLabel(turn.durationMs);
  const agentBubbleFill = turn.assistantText.some((text) => richMarkdownLayout(text) === "fill");
  const showAgentBubble =
    turn.activityCount > 0 ||
    assistantText !== "" ||
    (turn.state !== "running" && turn.state !== "queued");
  const loadActivity = useEvent(async (): Promise<TimelineDisplayResponseRow[]> => {
    if (onLoadActivity === undefined) return [];
    const lifecycleIds = new Set(turn.lifecycle.map((row) => row.id));
    return (await onLoadActivity(turn.id)).filter((row) => !lifecycleIds.has(row.id));
  });
  const handleLatestAssistantLayout = useEvent((_event: LayoutChangeEvent) => {
    onLatestAssistantLayout?.();
  });

  return (
    <View testID="turn-group" style={styles.turnGroup}>
      {turn.userInput.length === 0 ? null : (
        <View style={styles.userMessageRow}>
          {sentAt === null ? null : (
            <Text numberOfLines={1} style={styles.messageTime}>{`Sent · ${sentAt}`}</Text>
          )}
          <Bubble variant="user" testID="user-bubble">
            <BubbleContent>
              <TimelineUserInputView
                {...(activityActions === undefined ? {} : { actions: activityActions })}
                blocks={turn.userInput}
              />
            </BubbleContent>
          </Bubble>
        </View>
      )}
      {turn.lifecycle.length === 0 ? null : (
        <View testID="pre-turn-lifecycle" style={styles.lifecycleList}>
          {turn.lifecycle.map((row) => (
            <View key={row.id} style={styles.lifecycleRow}>
              <TimelineActivityRow
                {...(activityActions === undefined ? {} : { actions: activityActions })}
                activity={row}
                turnId={turn.id}
              />
            </View>
          ))}
        </View>
      )}
      {showAgentBubble ? (
        <View
          key={latestAssistantMeasurementKey ?? "initial-authority"}
          {...(latestAssistantRef === undefined ? {} : { ref: latestAssistantRef })}
          {...(onLatestAssistantLayout === undefined
            ? {}
            : { onLayout: handleLatestAssistantLayout })}
          style={styles.agentMessageRow}
        >
          <Bubble fill={agentBubbleFill} variant="agent" testID="codex-bubble">
            <BubbleContent>
              <TimelineActivityView
                {...(activityActions === undefined ? {} : { actions: activityActions })}
                activityCount={turn.activityCount}
                rows={turn.responseRows}
                {...(onLoadActivity === undefined ? {} : { onLoadActivity: loadActivity })}
                turnId={turn.id}
                turnState={turn.state}
              />
              {assistantText === "" && turn.activityCount === 0 ? (
                <ProductText style={styles.agentPlaceholder} tone="dim">
                  {emptyResponseLabel(turn.state)}
                </ProductText>
              ) : null}
            </BubbleContent>
          </Bubble>
          <MessageActionRailView
            {...(actions === undefined ? {} : { actions })}
            completedAt={completedAt}
            copyText={assistantText}
          />
        </View>
      ) : null}
      {showAgentBubble || actions === undefined ? null : (
        <View style={styles.turnOnlyActionRow}>
          <MessageActionRailView actions={actions} completedAt={null} copyText="" />
        </View>
      )}
      <View testID="turn-footer" style={styles.turnFooter}>
        {isProgressState(turn.state) ? (
          <ShimmerText style={styles.turnMetaText} text={timelineTurnStateLabel(turn.state)} />
        ) : (
          <>
            <View style={[styles.statusDot, timelineStatusDotStyle(turn.state)]} />
            <Text style={styles.turnMetaText}>{timelineTurnStateLabel(turn.state)}</Text>
          </>
        )}
        {duration === null ? null : <Text style={styles.turnMetaText}>{duration}</Text>}
        {turn.usage === null ? null : (
          <View
            accessible
            accessibilityLabel={`${turn.usage.inputTokens.toLocaleString()} input tokens, ${turn.usage.outputTokens.toLocaleString()} output tokens`}
            style={styles.turnTokenMetrics}
          >
            <Text style={styles.turnMetaText}>{TOKEN_SYMBOL}</Text>
            <Text
              style={styles.turnMetaText}
            >{`↓${timelineCompactNumber(turn.usage.inputTokens)}`}</Text>
            <Text
              style={styles.turnMetaText}
            >{`↑${timelineCompactNumber(turn.usage.outputTokens)}`}</Text>
          </View>
        )}
        {turn.usage?.totalCostUsd === null || turn.usage?.totalCostUsd === undefined ? null : (
          <Text style={styles.turnMetaText}>
            {`≈${formatEstimatedTurnCost(turn.usage.totalCostUsd)}`}
          </Text>
        )}
      </View>
    </View>
  );
}

function emptyResponseLabel(state: TimelineDisplayTurn["state"]): string {
  if (state === "failed") return "The turn failed before Codex returned a response.";
  if (state === "completed") return "The turn completed without a response.";
  return "Stopped before a response was completed.";
}

function isProgressState(state: TimelineDisplayTurn["state"]): boolean {
  return state === "running" || state === "queued";
}

const styles = StyleSheet.create({
  agentMessageRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-start",
    minWidth: 0,
    width: "100%",
  },
  agentPlaceholder: { ...typeScale.label },
  lifecycleList: { gap: spacing.xxs, paddingVertical: spacing.optical, width: "100%" },
  lifecycleRow: { minHeight: 28, paddingHorizontal: spacing.xs, width: "100%" },
  messageTime: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.caption,
    marginBottom: spacing.xxs,
  },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  turnFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    minHeight: 20,
    paddingHorizontal: spacing.xs,
  },
  turnGroup: { alignSelf: "center", gap: spacing.xs, maxWidth: 880, width: "100%" },
  turnOnlyActionRow: { alignItems: "flex-end" },
  turnMetaText: { color: colors.textMuted, ...typeScale.caption },
  turnTokenMetrics: { alignItems: "baseline", flexDirection: "row", gap: spacing.xxs },
  userMessageRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    minWidth: 0,
    width: "100%",
  },
});
