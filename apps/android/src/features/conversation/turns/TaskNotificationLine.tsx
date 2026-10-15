import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { colors, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { AnchoredMenuList, LIST_GAP, LIST_PADDING } from "../../../ui/AnchoredMenuList";
import { ContentMenu } from "../../../ui/ContentMenu";
import { useAnchoredMenuSize } from "../../../ui/useAnchoredMenuSize";
import { useLayoutWidth } from "../../../ui/useLayoutWidth";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import {
  reportDetails,
  reportLineSummary,
  reportName,
  reportOutcome,
} from "./taskNotificationPresentation";
import { BackgroundTaskContext, SubagentNavigationContext } from "./turnContexts";

/** Each row shows a name and a detail line; its height never depends on measurement. */
const ROW_TEXT_HEIGHT = typeScale.body.lineHeight + typeScale.label.lineHeight;
const ROW_PADDING = spacing.xs;

/**
 * Background task reports drawn outside a bubble as one short line: the
 * reports that woke a turn, or those that arrived while it answered. The line
 * opens a plain list under it; an agent's row opens its thread, a command's
 * row its output. Each report's status is the dot on its avatar.
 */
export function TaskNotificationLine({
  reports,
}: {
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element | null {
  const [open, setOpen] = useRecyclingState(false);
  const menu = useAnchoredMenuSize();
  const layout = useLayoutWidth();
  const { fontScale } = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const close = useEvent(() => {
    setOpen(false);
  });
  if (reports.length === 0) {
    return null;
  }
  // WHY numeric: Compose measures the anchored pill intrinsically (a
  // percentage bound collapses its label), so the pill is bounded by the
  // line's laid-out width. Until it is laid out, the line keeps its height.
  const lineWidth = layout.width;
  if (lineWidth === null) {
    return (
      <View
        onLayout={layout.onLayout}
        style={[styles.lineRow, styles.unmeasuredLine]}
        testID="task-notification-line-row"
      />
    );
  }
  const rowHeight = Math.max(
    controlSize.touch,
    ROW_TEXT_HEIGHT * fontScale + ROW_PADDING + ROW_PADDING,
  );
  const trigger = createElement(TaskNotificationPill, {
    maxWidth: lineWidth,
    onPress: toggleOpen,
    open,
    reports,
  });
  // The menu opens at the pill's start with its own width; Compose keeps it
  // inside the window. Rows have a fixed height, so the list declares its
  // height instead of the popup measuring it.
  const listHeight = Math.min(
    menu.maxHeight,
    reports.length * rowHeight + (reports.length - 1) * LIST_GAP + LIST_PADDING + LIST_PADDING,
  );
  const list = (
    <AnchoredMenuList height={listHeight} testID="task-notification-list">
      {reports.map((report) => (
        <ReportRow height={rowHeight} key={report.id} onNavigate={close} report={report} />
      ))}
    </AnchoredMenuList>
  );
  return (
    <View onLayout={layout.onLayout} style={styles.lineRow} testID="task-notification-line-row">
      <ContentMenu
        align="start"
        height={listHeight}
        onOpenChange={setOpen}
        open={open}
        placement="bottom"
        trigger={trigger}
        width={Math.min(menu.width, lineWidth)}
      >
        {list}
      </ContentMenu>
    </View>
  );
}

function TaskNotificationPill({
  maxWidth,
  onPress,
  open,
  reports,
}: {
  readonly maxWidth: number;
  readonly onPress: () => void;
  readonly open: boolean;
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element {
  const summary = reportLineSummary(reports);
  return (
    <Pressable
      accessibilityLabel={`${summary.label} ${summary.phrase}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, { maxWidth }, pressed && styles.pressed]}
      testID="task-notification-line"
    >
      <AgentAvatarStack
        badgeOf={(report) => reportOutcome(report).badge}
        keyOf={(report) => report.id}
        subjects={reports}
        surface={colors.surfaceRaised}
      />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
        {summary.label}
      </Text>
    </Pressable>
  );
}

function ReportRow({
  height,
  onNavigate,
  report,
}: {
  readonly height: number;
  readonly onNavigate: () => void;
  readonly report: TaskNotificationReport;
}): React.JSX.Element {
  const target = useReportTarget(report, onNavigate);
  const details = reportDetails(report);
  return (
    <Pressable
      accessibilityLabel={`${reportName(report)}, ${reportOutcome(report).phrase}, ${details}`}
      accessibilityRole="button"
      disabled={target.kind === "none"}
      onPress={target.press}
      style={({ pressed }) => [styles.row, { height }, pressed && styles.pressed]}
      testID="task-notification-row"
    >
      <AgentAvatar
        badge={reportOutcome(report).badge}
        subject={report}
        surface={colors.menuSurface}
      />
      <ReportRowText
        details={target.error ?? details}
        loading={target.loading}
        name={reportName(report)}
      />
      {target.kind === "none" ? null : (
        <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      )}
    </Pressable>
  );
}

/** Opening a task's output: idle, loading, or a failure shown in the row. */
type OpeningState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "failed" };

const NOT_OPENING: OpeningState = { status: "idle" };
const OPENING: OpeningState = { status: "loading" };

function failedOpening(error: unknown): OpeningState {
  return {
    message: error instanceof Error ? error.message : "Could not read the output",
    status: "failed",
  };
}

/**
 * What a report row opens: an agent's thread or a background task's output
 * (loaded on press); without either it opens nothing.
 */
function useReportTarget(report: TaskNotificationReport, onNavigate: () => void) {
  const openThread = useContext(SubagentNavigationContext);
  const openTask = useContext(BackgroundTaskContext);
  // The list renders in the anchored popover, outside any recycled list cell.
  const [opening, setOpening] = useState<OpeningState>(NOT_OPENING);
  const agentThreadId = report.agentThreadId;
  const kind =
    agentThreadId !== null && openThread !== null
      ? "thread"
      : report.kind !== "agent" && openTask !== null
        ? "task"
        : "none";
  const press = useEvent(async () => {
    if (kind === "thread" && agentThreadId !== null && openThread !== null) {
      onNavigate();
      openThread(agentThreadId);
    } else if (kind === "task" && openTask !== null) {
      setOpening(OPENING);
      const next = await openTask({ name: reportName(report), taskId: report.taskId }).then(
        () => NOT_OPENING,
        failedOpening,
      );
      setOpening(next);
      if (next.status === "idle") {
        onNavigate();
      }
    }
  });
  return {
    error: opening.status === "failed" ? opening.message : null,
    kind,
    loading: opening.status === "loading",
    press: () => void press(),
  } as const;
}

function ReportRowText({
  details,
  loading,
  name,
}: {
  readonly details: string;
  readonly loading: boolean;
  readonly name: string;
}): React.JSX.Element {
  return (
    <View style={styles.rowText}>
      <Text numberOfLines={1} shimmering={loading} style={styles.rowName}>
        {name}
      </Text>
      <Text numberOfLines={1} style={styles.rowDetails}>
        {details}
      </Text>
    </View>
  );
}
