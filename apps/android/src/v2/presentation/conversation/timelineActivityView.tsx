import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { TimelineActivityContent } from "./timelineActivityContent";
import { TimelineMemoryCitationView } from "./timelineMemoryCitationView";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import type {
  TimelineActivityActions,
  TimelineDisplayActivity,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
} from "./timelineTypes";

interface TimelineActivityViewProps {
  actions?: TimelineActivityActions;
  activityCount: number;
  onLoadActivity?(): Promise<TimelineDisplayResponseRow[]>;
  rows: TimelineDisplayResponseRow[];
  turnId: string;
  turnState: TimelineDisplayTurn["state"];
}

export function TimelineActivityView(props: TimelineActivityViewProps): React.JSX.Element | null {
  const { actions, activityCount, onLoadActivity, rows, turnId, turnState } = props;
  const [expanded, setExpanded] = useState(false);
  const [loadedRows, setLoadedRows] = useState<TimelineDisplayResponseRow[] | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "failed">("idle");
  const displayedRows = loadedRows === null ? rows : mergeResponseRows(loadedRows, rows);
  const displayedActivityCount = responseActivityCount(displayedRows);
  const load = useEvent(() => {
    if (
      loadState === "loading" ||
      displayedActivityCount >= activityCount ||
      onLoadActivity === undefined
    ) {
      return;
    }
    setLoadState("loading");
    onLoadActivity()
      .then((items) => {
        setLoadedRows(items);
        setLoadState("idle");
      })
      .catch(() => setLoadState("failed"));
  });
  const toggle = useEvent(() => {
    if (expanded && loadState === "failed") {
      load();
      return;
    }
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) load();
  });

  if (activityCount === 0 && displayedRows.length === 0) return null;
  const progressing = turnState === "queued" || turnState === "running";
  const visibleRows = responseRenderRows(displayedRows, activityCount, expanded);
  return (
    <View
      style={[
        styles.activity,
        activityCount === 0 ? styles.withoutActivity : null,
        expanded ? styles.expanded : null,
      ]}
    >
      {visibleRows.map((row) => {
        if (row.kind === "activityToggle") {
          return (
            <ActivityToggle
              key={row.id}
              activityCount={activityCount}
              expanded={expanded}
              onPress={toggle}
              progressing={progressing}
            />
          );
        }
        if (row.kind === "assistant") {
          return (
            <View key={`assistant:${row.id}`} style={styles.assistant}>
              <RichMarkdown source={row.text} />
              <TimelineMemoryCitationView
                citations={row.memoryCitation === null ? [] : [row.memoryCitation]}
              />
            </View>
          );
        }
        return (
          <View key={`activity:${row.id}`} style={styles.list}>
            <TimelineActivityRow
              {...(actions === undefined ? {} : { actions })}
              activity={row.activity}
              turnId={turnId}
            />
          </View>
        );
      })}
      {expanded ? (
        <>
          {loadState === "loading" ? (
            <ShimmerText
              containerStyle={styles.loadingShimmer}
              style={styles.title}
              text="Loading activity…"
            />
          ) : null}
          {loadState === "failed" ? (
            <ProductText style={styles.failed} tone="muted">
              Could not load complete activity. Tap the activity header to retry.
            </ProductText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

interface ActivityToggleProps {
  activityCount: number;
  expanded: boolean;
  onPress(): void;
  progressing: boolean;
}

function ActivityToggle(props: ActivityToggleProps): React.JSX.Element {
  const { activityCount, expanded, onPress, progressing } = props;
  return (
    <Pressable
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${activityLabel(activityCount)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.toggle}
    >
      <View style={styles.iconSlot}>
        <PresentationIcon color={colors.textMuted} name="construct" size={13} />
      </View>
      {progressing ? (
        <ShimmerText
          containerStyle={styles.labelShimmer}
          style={styles.label}
          text={activityLabel(activityCount)}
        />
      ) : (
        <ProductText numberOfLines={1} style={styles.label} tone="muted" weight="semibold">
          {activityLabel(activityCount)}
        </ProductText>
      )}
      <View style={styles.chevronSlot}>
        <PresentationIcon
          color={colors.textDim}
          name={expanded ? "chevronUp" : "chevronDown"}
          size={12}
        />
      </View>
    </Pressable>
  );
}

interface TimelineActivityRowProps {
  actions?: TimelineActivityActions;
  activity: TimelineDisplayActivity;
  turnId: string;
}

export function TimelineActivityRow(props: TimelineActivityRowProps): React.JSX.Element {
  const { actions, activity, turnId } = props;
  const progressing = activity.state === "pending" || activity.state === "running";
  return (
    <View
      accessible
      accessibilityLabel={`${activity.label}, ${activityStateLabel(activity.state)}`}
      style={styles.row}
    >
      <View style={styles.rowHeader}>
        {progressing ? (
          <ShimmerText
            containerStyle={styles.loadingShimmer}
            style={styles.title}
            text={activity.label}
          />
        ) : (
          <>
            <View style={[styles.stateDot, stateDotStyle(activity.state)]} />
            <ProductText style={styles.title} tone="muted" weight="semibold">
              {activity.label}
            </ProductText>
            <ProductText style={styles.stateLabel} tone="dim">
              {activityStateLabel(activity.state)}
            </ProductText>
          </>
        )}
      </View>
      <TimelineActivityContent
        {...(actions === undefined ? {} : { actions })}
        activity={activity}
        turnId={turnId}
      />
    </View>
  );
}

function mergeResponseRows(
  authoritative: TimelineDisplayResponseRow[],
  projected: TimelineDisplayResponseRow[],
): TimelineDisplayResponseRow[] {
  const projectedById = new Map(projected.map((row) => [row.id, row]));
  const merged = authoritative.map((row) => projectedById.get(row.id) ?? row);
  const mergedIds = new Set(merged.map((row) => row.id));
  for (let index = 0; index < projected.length; index += 1) {
    const row = projected[index];
    if (row === undefined || mergedIds.has(row.id)) continue;
    const followingAnchor = nextMergedAnchor(projected, mergedIds, index + 1);
    if (followingAnchor === undefined) {
      merged.push(row);
    } else {
      const insertionIndex = merged.findIndex((candidate) => candidate.id === followingAnchor.id);
      merged.splice(insertionIndex, 0, row);
    }
    mergedIds.add(row.id);
  }
  return merged;
}

function nextMergedAnchor(
  rows: TimelineDisplayResponseRow[],
  mergedIds: ReadonlySet<string>,
  start: number,
): TimelineDisplayResponseRow | undefined {
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined && mergedIds.has(row.id)) return row;
  }
  return undefined;
}

type TimelineResponseRenderRow =
  | TimelineDisplayResponseRow
  | { id: "activity-toggle"; kind: "activityToggle" };

function responseRenderRows(
  rows: TimelineDisplayResponseRow[],
  activityCount: number,
  expanded: boolean,
): TimelineResponseRenderRow[] {
  if (activityCount === 0) return rows;
  const rendered: TimelineResponseRenderRow[] = [];
  let toggleInserted = false;
  for (const row of rows) {
    if (row.kind === "activity") {
      if (!toggleInserted) {
        rendered.push({ id: "activity-toggle", kind: "activityToggle" });
        toggleInserted = true;
      }
      if (expanded) rendered.push(row);
      continue;
    }
    rendered.push(row);
  }
  if (toggleInserted) return rendered;
  const fallbackIndex = Math.max(0, rendered.length - 1);
  rendered.splice(fallbackIndex, 0, { id: "activity-toggle", kind: "activityToggle" });
  return rendered;
}

function responseActivityCount(rows: TimelineDisplayResponseRow[]): number {
  return rows.reduce((count, row) => count + (row.kind === "activity" ? 1 : 0), 0);
}

function activityLabel(count: number): string {
  return count === 1 ? "Activity" : `${count} activities · ${count}`;
}

function activityStateLabel(state: TimelineDisplayActivity["state"]): string {
  if (state === "running" || state === "pending") return "Running";
  if (state === "failed" || state === "rejected") return "Failed";
  return "Completed";
}

function stateDotStyle(state: TimelineDisplayActivity["state"]): { backgroundColor: string } {
  if (state === "failed" || state === "rejected") return { backgroundColor: colors.red };
  return { backgroundColor: colors.green };
}

const styles = StyleSheet.create({
  activity: { alignSelf: "flex-start", marginTop: spacing.optical, maxWidth: "100%" },
  assistant: { gap: spacing.optical, width: "100%" },
  chevronSlot: { alignItems: "center", height: 18, justifyContent: "center", width: 14 },
  expanded: { alignSelf: "stretch", maxWidth: "100%", minWidth: 0, width: "100%" },
  failed: { ...typeScale.caption, color: colors.red },
  iconSlot: { alignItems: "center", height: 18, justifyContent: "center", width: 15 },
  label: { flexShrink: 1, ...typeScale.caption, minWidth: 0 },
  labelShimmer: { alignSelf: "center", flex: 1 },
  list: {
    gap: spacing.xs,
    paddingBottom: spacing.optical,
    paddingLeft: spacing.lg,
    paddingRight: spacing.optical,
    paddingTop: spacing.optical,
    width: "100%",
  },
  loadingShimmer: { alignSelf: "flex-start" },
  row: { gap: spacing.optical },
  rowHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xxs },
  stateDot: { borderRadius: 4, height: 7, width: 7 },
  stateLabel: { ...typeScale.caption, marginLeft: "auto" },
  title: { ...typeScale.caption },
  toggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 25,
    paddingHorizontal: spacing.optical,
  },
  withoutActivity: { marginTop: 0 },
});
