import { createContext, useContext, useRef, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { TOKEN_SYMBOL } from "../../ui/tokenDisplay";
import { formatEstimatedTurnCost } from "../../turnCost";
import { Bubble, BubbleContent } from "../../rendering/Bubble";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { MessageActionRailView } from "./MessageActionRailView";
import { ThreadTimelineList } from "./threadTimelineList";

interface TimelineRenderItem {
  item: TimelineDisplayTurn;
}

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
  canLoadNewer?: boolean;
  canLoadOlder?: boolean;
  onLoadNewer?(): Promise<void>;
  onLoadOlder?(): Promise<void>;
  onLoadActivity?(turnId: string): Promise<TimelineDisplayActivity[]>;
  onSettleWindow?(direction: "newer" | "older"): void;
  timelineKey?: string;
  turns: TimelineDisplayTurn[];
}

interface TimelineTurnProps {
  turn: TimelineDisplayTurn;
}

type TimelineActivityLoader = ((turnId: string) => Promise<TimelineDisplayActivity[]>) | undefined;

const TimelineActivityLoaderContext = createContext<TimelineActivityLoader>(undefined);

export function TimelineView(props: TimelineViewProps): React.JSX.Element {
  const {
    canLoadNewer = false,
    canLoadOlder = false,
    onLoadNewer,
    onLoadOlder,
    onLoadActivity,
    onSettleWindow,
    timelineKey = "conversation",
    turns,
  } = props;
  const dimensions = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext);
  const edgeLockRef = useRef<"newer" | "older" | null>(null);
  const loadOlder = useEvent(() => {
    if (!canLoadOlder || onLoadOlder === undefined || edgeLockRef.current === "newer") return;
    edgeLockRef.current = "older";
    onLoadOlder().catch(() => undefined);
  });
  const loadNewer = useEvent(() => {
    if (!canLoadNewer || onLoadNewer === undefined || edgeLockRef.current === "older") return;
    edgeLockRef.current = "newer";
    onLoadNewer().catch(() => undefined);
  });
  const beginGesture = useEvent(() => {
    edgeLockRef.current = null;
  });
  const settleWindow = useEvent(() => {
    const direction = edgeLockRef.current;
    edgeLockRef.current = null;
    if (direction !== null) onSettleWindow?.(direction);
  });
  return (
    <TimelineActivityLoaderContext.Provider value={onLoadActivity}>
      <ThreadTimelineList
        contentContainerStyle={styles.list}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        data={turns}
        extraData={`${canLoadNewer}:${canLoadOlder}`}
        followTail={!canLoadNewer}
        keyExtractor={turnKey}
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={insets?.bottom ?? 0}
        keyboardShouldPersistTaps="handled"
        measurementRevision={`${dimensions.width}:${dimensions.height}:${dimensions.scale}:${dimensions.fontScale}`}
        onEndReached={loadNewer}
        onEndReachedThreshold={0.5}
        onMomentumScrollEnd={settleWindow}
        onScrollBeginDrag={beginGesture}
        onScrollEndDrag={settleWindow}
        onStartReached={loadOlder}
        onStartReachedThreshold={0.5}
        renderItem={renderTimelineItem}
        renderRevision={timelineKey}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        testID="conversation-timeline"
        ListEmptyComponent={TimelineEmptyView}
      />
    </TimelineActivityLoaderContext.Provider>
  );
}

function renderTimelineItem(value: TimelineRenderItem): React.JSX.Element {
  return <TimelineTurn turn={value.item} />;
}

function turnKey(turn: TimelineDisplayTurn): string {
  return turn.id;
}

function TimelineEmptyView(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <PresentationIcon color={colors.textDim} name="sparkles" size={26} />
      <ProductText style={styles.emptyTitle} weight="semibold">
        Start by typing a message
      </ProductText>
    </View>
  );
}

function TimelineTurn(props: TimelineTurnProps): React.JSX.Element {
  const { turn } = props;
  const onLoadActivity = useContext(TimelineActivityLoaderContext);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [activities, setActivities] = useState(turn.activities);
  const [activityLoading, setActivityLoading] = useState(false);
  const toggleActivity = useEvent(() => {
    const expanding = !activityExpanded;
    setActivityExpanded(expanding);
    if (
      !expanding ||
      activityLoading ||
      activities.length >= turn.activityCount ||
      onLoadActivity === undefined
    )
      return;
    setActivityLoading(true);
    onLoadActivity(turn.id)
      .then(setActivities)
      .catch(() => undefined)
      .finally(() => setActivityLoading(false));
  });
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
          {turn.lifecycle.map((row, index) => (
            <View key={row.id} style={styles.lifecycleRow}>
              {isProgressState(turn.state) && index === turn.lifecycle.length - 1 ? (
                <ShimmerText
                  containerStyle={styles.lifecycleShimmer}
                  style={styles.lifecycleText}
                  text={row.label}
                />
              ) : (
                <ProductText
                  numberOfLines={1}
                  style={styles.lifecycleText}
                  tone="muted"
                  weight="semibold"
                >
                  {row.label}
                </ProductText>
              )}
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
                    {isProgressState(turn.state) ? (
                      <ShimmerText
                        containerStyle={styles.activityLabelShimmer}
                        style={styles.activityLabel}
                        text={activityLabel(turn.activityCount)}
                      />
                    ) : (
                      <ProductText
                        numberOfLines={1}
                        style={styles.activityLabel}
                        tone="muted"
                        weight="semibold"
                      >
                        {activityLabel(turn.activityCount)}
                      </ProductText>
                    )}
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
                      {activityLoading ? (
                        <ShimmerText
                          containerStyle={styles.activityLoadingShimmer}
                          style={styles.activityDetailTitle}
                          text="Loading activity…"
                        />
                      ) : null}
                      {activities.map((row) => (
                        <View key={row.id} style={styles.activityDetail}>
                          {isProgressState(row.state) ? (
                            <ShimmerText
                              containerStyle={styles.activityLoadingShimmer}
                              style={styles.activityDetailTitle}
                              text={row.label}
                            />
                          ) : (
                            <ProductText
                              style={styles.activityDetailTitle}
                              tone="muted"
                              weight="semibold"
                            >
                              {row.label}
                            </ProductText>
                          )}
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
        {isProgressState(turn.state) ? (
          <ShimmerText style={styles.turnMetaText} text={turnStateLabel(turn.state)} />
        ) : (
          <>
            <View style={[styles.statusDot, statusDotStyle(turn.state)]} />
            <Text style={styles.turnMetaText}>{turnStateLabel(turn.state)}</Text>
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

function isProgressState(state: string | undefined): boolean {
  return state === "running" || state === "queued" || state === "pending";
}

const styles = StyleSheet.create({
  activity: { alignSelf: "flex-start", marginTop: spacing.optical, maxWidth: "100%" },
  activityChevronSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 14,
  },
  activityDetail: { gap: spacing.optical },
  activityDetailText: { ...typeScale.caption },
  activityDetailTitle: { ...typeScale.caption },
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
  activityLabel: { flexShrink: 1, ...typeScale.caption, minWidth: 0 },
  activityLabelShimmer: { alignSelf: "center", flex: 1 },
  activityLoadingShimmer: { alignSelf: "flex-start" },
  activityList: {
    gap: spacing.xs,
    maxWidth: "100%",
    minWidth: 0,
    paddingBottom: spacing.optical,
    paddingLeft: spacing.lg,
    paddingRight: spacing.optical,
    paddingTop: spacing.optical,
    width: "100%",
  },
  activityToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 25,
    paddingHorizontal: spacing.optical,
  },
  agentMessageRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-start",
    minWidth: 0,
    width: "100%",
  },
  agentPlaceholder: { ...typeScale.label },
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  emptyTitle: { ...typeScale.title },
  lifecycleList: {
    alignSelf: "stretch",
    gap: spacing.xxs,
    minWidth: 0,
    paddingVertical: spacing.optical,
    width: "100%",
  },
  lifecycleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.xs,
    width: "100%",
  },
  lifecycleText: { flexShrink: 1, ...typeScale.label, minWidth: 0 },
  lifecycleShimmer: { alignSelf: "flex-start" },
  list: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  messageTime: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.caption,

    marginBottom: spacing.xxs,
  },
  scroll: { flex: 1 },
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
