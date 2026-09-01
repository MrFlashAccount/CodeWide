import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, spacing } from "../../theme";
import { TOKEN_SYMBOL } from "../../ui/token-display";
import { formatEstimatedTurnCost } from "../../turn-cost";
import { Bubble, BubbleContent } from "../../rendering/Bubble";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text, ProductText } from "../text/ProductText";
import { MessageActionRailView } from "./MessageActionRailView";

export interface TimelineDisplayActivity {
  detail?: string;
  id: string;
  label: string;
  state?: string;
}

export interface TimelineDisplayLifecycle {
  id: string;
  label: string;
}

export interface TimelineDisplayTurn {
  activityCount: number;
  activities: TimelineDisplayActivity[];
  assistantText: string[];
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  id: string;
  lifecycle: TimelineDisplayLifecycle[];
  state: string;
  usage: TimelineDisplayUsage | null;
  userText: string[];
}

export interface TimelineDisplayUsage {
  inputTokens: number;
  latestRequestTokens: number;
  modelContextWindow: number | null;
  outputTokens: number;
  threadInputTokens: number;
  threadOutputTokens: number;
  threadTotalCostUsd: number | null;
  threadTotalTokens: number;
  totalCostUsd: number | null;
}

interface TimelineViewProps {
  turns: TimelineDisplayTurn[];
}

interface TimelineTurnProps {
  turn: TimelineDisplayTurn;
}

export function TimelineView({ turns }: TimelineViewProps): React.JSX.Element {
  if (turns.length === 0) {
    return (
      <View style={styles.empty}>
        <PresentationIcon color={colors.textDim} name="sparkles" size={26} />
        <ProductText style={styles.emptyTitle} weight="semibold">
          Start by typing a message
        </ProductText>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.list} style={styles.scroll}>
      {turns.map((turn) => (
        <TimelineTurn key={turn.id} turn={turn} />
      ))}
    </ScrollView>
  );
}

function TimelineTurn({ turn }: TimelineTurnProps): React.JSX.Element {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const toggleActivity = useEvent(() => setActivityExpanded((current) => !current));
  const userText = turn.userText.join("\n\n");
  const assistantText = turn.assistantText.join("\n\n");
  const sentAt = clockLabel(turn.createdAt);
  const completedAt = clockLabel(turn.completedAt);
  const duration = durationLabel(turn.durationMs);
  const showAgentBubble =
    turn.activityCount > 0 || assistantText !== "" || turn.state !== "running";

  return (
    <View testID="turn-group" style={styles.turnGroup}>
      {userText === "" ? null : (
        <View style={styles.userMessageRow}>
          {sentAt === null ? null : <Text style={styles.messageTime}>{`Sent · ${sentAt}`}</Text>}
          <Bubble variant="user" testID="user-bubble">
            <BubbleContent>
              <RichMarkdown source={userText} />
            </BubbleContent>
          </Bubble>
        </View>
      )}
      {turn.lifecycle.length === 0 ? null : (
        <View style={styles.lifecycleList}>
          {turn.lifecycle.map((row) => (
            <View key={row.id} style={styles.lifecycleRow}>
              <View style={styles.lifecycleIcon}>
                <PresentationIcon color={colors.textMuted} name="checkCircle" size={14} />
              </View>
              <ProductText
                numberOfLines={1}
                style={styles.lifecycleText}
                tone="muted"
                weight="semibold"
              >
                {row.label}
              </ProductText>
            </View>
          ))}
        </View>
      )}
      {showAgentBubble ? (
        <View style={styles.agentMessageRow}>
          <Bubble variant="agent" testID="codex-bubble">
            <BubbleContent>
              {turn.activityCount === 0 ? null : (
                <View style={[styles.activity, activityExpanded ? styles.activityExpanded : null]}>
                  <Pressable
                    accessibilityLabel={`${activityExpanded ? "Collapse" : "Expand"} activity ${activityLabel(turn.activityCount)}`}
                    accessibilityRole="button"
                    onPress={toggleActivity}
                    style={styles.activityToggle}
                  >
                    <View style={styles.activityIconSlot}>
                      <PresentationIcon color={colors.textMuted} name="construct" size={13} />
                    </View>
                    <ProductText
                      numberOfLines={1}
                      style={styles.activityLabel}
                      tone="muted"
                      weight="semibold"
                    >
                      {activityLabel(turn.activityCount)}
                    </ProductText>
                    <View style={styles.activityChevronSlot}>
                      <PresentationIcon
                        color={colors.textDim}
                        name={activityExpanded ? "chevronUp" : "chevronDown"}
                        size={12}
                      />
                    </View>
                  </Pressable>
                  {activityExpanded ? (
                    <View style={styles.activityList}>
                      {turn.activities.map((row) => (
                        <View key={row.id} style={styles.activityDetail}>
                          <ProductText
                            style={styles.activityDetailTitle}
                            tone="muted"
                            weight="semibold"
                          >
                            {row.label}
                          </ProductText>
                          {row.detail === undefined || row.detail === "" ? null : (
                            <ProductText selectable style={styles.activityDetailText} tone="muted">
                              {row.detail}
                            </ProductText>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
              {assistantText === "" ? (
                <ProductText style={styles.agentPlaceholder} tone="dim">
                  {turn.state === "failed"
                    ? "The turn failed before Codex returned a response."
                    : "Stopped before a response was completed."}
                </ProductText>
              ) : (
                <RichMarkdown source={assistantText} />
              )}
            </BubbleContent>
          </Bubble>
          <MessageActionRailView completedAt={completedAt} copyText={assistantText} />
        </View>
      ) : null}
      <View testID="turn-footer" style={styles.turnFooter}>
        <View style={[styles.statusDot, statusDotStyle(turn.state)]} />
        <Text style={styles.turnMetaText}>{turnStateLabel(turn.state)}</Text>
        {duration === null ? null : <Text style={styles.turnMetaText}>{duration}</Text>}
        {turn.usage === null ? null : (
          <View
            accessible
            accessibilityLabel={`${turn.usage.inputTokens.toLocaleString()} input tokens, ${turn.usage.outputTokens.toLocaleString()} output tokens`}
            style={styles.turnTokenMetrics}
          >
            <Text style={styles.turnMetaText}>{TOKEN_SYMBOL}</Text>
            <Text style={styles.turnMetaText}>{`↓${compactNumber(turn.usage.inputTokens)}`}</Text>
            <Text style={styles.turnMetaText}>{`↑${compactNumber(turn.usage.outputTokens)}`}</Text>
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

function activityLabel(count: number): string {
  return count === 1 ? "Activity" : `${count} activities · ${count}`;
}

function clockLabel(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function durationLabel(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs >= 60_000) {
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function compactNumber(value: number): string {
  if (Math.abs(value) < 1000) return value.toLocaleString();
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  }
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function statusDotStyle(state: string): { backgroundColor: string } {
  if (state === "running" || state === "queued") return { backgroundColor: colors.amber };
  if (state === "failed") return { backgroundColor: colors.red };
  if (state === "completed") return { backgroundColor: colors.green };
  return { backgroundColor: colors.textDim };
}

function turnStateLabel(state: string): string {
  if (state === "running" || state === "queued") return "Running";
  if (state === "completed") return "Completed";
  if (state === "failed") return "Failed";
  return "Stopped";
}

const styles = StyleSheet.create({
  activity: { alignSelf: "flex-start", marginTop: 1, maxWidth: "100%" },
  activityChevronSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 14,
  },
  activityDetail: { gap: 2 },
  activityDetailText: { fontSize: 11, lineHeight: 16 },
  activityDetailTitle: { fontSize: 11, lineHeight: 15 },
  activityExpanded: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  activityIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 15,
  },
  activityLabel: { flexShrink: 1, fontSize: 11, lineHeight: 15, minWidth: 0 },
  activityList: {
    gap: 5,
    maxWidth: "100%",
    minWidth: 0,
    paddingBottom: 2,
    paddingLeft: 18,
    paddingRight: 1,
    paddingTop: 2,
    width: "100%",
  },
  activityToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 25,
    paddingHorizontal: 2,
  },
  agentMessageRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 7,
    justifyContent: "flex-start",
    minWidth: 0,
    width: "100%",
  },
  agentPlaceholder: { fontSize: 12, lineHeight: 17 },
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  emptyTitle: { fontSize: 16, lineHeight: 22 },
  lifecycleIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 16,
  },
  lifecycleList: {
    alignSelf: "stretch",
    gap: 3,
    minWidth: 0,
    paddingVertical: 2,
    width: "100%",
  },
  lifecycleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minHeight: 28,
    paddingHorizontal: 8,
    width: "100%",
  },
  lifecycleText: { flexShrink: 1, fontSize: 12, lineHeight: 17, minWidth: 0 },
  list: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xs,
    paddingTop: 6,
  },
  messageTime: {
    color: colors.textDim,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 13,
    marginBottom: 4,
  },
  scroll: { flex: 1 },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  turnFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 20,
    paddingHorizontal: 5,
  },
  turnGroup: { alignSelf: "center", gap: 5, maxWidth: 880, width: "100%" },
  turnMetaText: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  turnTokenMetrics: { alignItems: "baseline", flexDirection: "row", gap: 3 },
  userMessageRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 7,
    justifyContent: "flex-end",
    minWidth: 0,
    width: "100%",
  },
});
