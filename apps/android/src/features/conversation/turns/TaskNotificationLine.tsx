import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { AnchoredMenuList } from "../../../ui/AnchoredMenuList";
import { ContentMenu } from "../../../ui/ContentMenu";
import { useAnchoredMenuSize } from "../../../ui/useAnchoredMenuSize";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import {
  reportDetails,
  reportLineSummary,
  reportName,
  reportOutcome,
} from "./taskNotificationPresentation";
import { BackgroundTaskContext, SubagentNavigationContext } from "./turnContexts";

/** The line is centred outside bubbles, inside the timeline gutters. */
const LINE_SIDE_INSET = 48;
const BADGE_ICON = {
  done: "checkmark-circle",
  failed: "alert-circle",
  running: "ellipse",
  waiting: "time-outline",
} as const;

const BADGE_COLOR = {
  done: colors.green,
  failed: colors.red,
  running: colors.amber,
  waiting: colors.amber,
} as const;

/**
 * Background task reports drawn outside a bubble as one short line: the
 * reports that woke a turn, or those that arrived while it answered. The line
 * opens a list; an agent's row opens its thread.
 */
export function TaskNotificationLine({
  reports,
}: {
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element | null {
  const [open, setOpen] = useRecyclingState(false);
  const menu = useAnchoredMenuSize();
  const window = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const close = useEvent(() => {
    setOpen(false);
  });
  if (reports.length === 0) {
    return null;
  }
  const summary = reportLineSummary(reports);
  // WHY numeric: Compose measures the anchored trigger intrinsically (a
  // percentage bound collapses its label) and opens the menu at the anchor's
  // start with the menu's width, so anchor and menu share one row width.
  const rowWidth = window.width - LINE_SIDE_INSET;
  const trigger = createElement(TaskNotificationTrigger, {
    onPress: toggleOpen,
    open,
    reports,
    rowWidth,
    summary,
  });
  const body = (
    <AnchoredMenuList
      maxHeight={menu.maxHeight}
      testID="task-notification-list"
      title={reports.length === 1 ? "Background task" : `${String(reports.length)} reports`}
    >
      {reports.map((report) => (
        <ReportRow key={report.id} onNavigate={close} report={report} />
      ))}
    </AnchoredMenuList>
  );
  return (
    <View style={styles.lineRow}>
      <ContentMenu
        align="center"
        onOpenChange={setOpen}
        open={open}
        placement="bottom"
        trigger={trigger}
        width={rowWidth}
      >
        {body}
      </ContentMenu>
    </View>
  );
}

function TaskNotificationTrigger({
  onPress,
  open,
  reports,
  rowWidth,
  summary,
}: {
  readonly onPress: () => void;
  readonly open: boolean;
  readonly reports: readonly TaskNotificationReport[];
  readonly rowWidth: number;
  readonly summary: ReturnType<typeof reportLineSummary>;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={`${summary.label} ${summary.phrase}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={[styles.anchorRow, { width: rowWidth }]}
      testID="task-notification-line"
    >
      {({ pressed }) => (
        <TaskNotificationPill
          maxWidth={rowWidth}
          pressed={pressed}
          reports={reports}
          summary={summary}
        />
      )}
    </Pressable>
  );
}

function TaskNotificationPill({
  maxWidth,
  pressed,
  reports,
  summary,
}: {
  readonly maxWidth: number;
  readonly pressed: boolean;
  readonly reports: readonly TaskNotificationReport[];
  readonly summary: ReturnType<typeof reportLineSummary>;
}): React.JSX.Element {
  const single = reports.length === 1;
  return (
    <View style={[styles.trigger, { maxWidth }, pressed && styles.pressed]}>
      <AgentAvatarStack
        // One report's status sits next to the label; a stack marks each avatar.
        badgeOf={(report) => (single ? null : reportOutcome(report).badge)}
        keyOf={(report) => report.id}
        subjects={reports}
      />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
        {summary.label}
      </Text>
      <Ionicons
        color={BADGE_COLOR[summary.badge]}
        name={BADGE_ICON[summary.badge]}
        size={iconSize.indicator}
      />
      <Text numberOfLines={1} style={styles.phrase}>
        {summary.phrase}
      </Text>
    </View>
  );
}

function ReportRow({
  onNavigate,
  report,
}: {
  readonly onNavigate: () => void;
  readonly report: TaskNotificationReport;
}): React.JSX.Element {
  const target = useReportTarget(report, onNavigate);
  const outcome = reportOutcome(report);
  const details = reportDetails(report);
  const opens = target.kind !== "result";
  return (
    <View>
      <Pressable
        accessibilityLabel={`${reportName(report)}, ${details}`}
        accessibilityRole="button"
        {...(opens || report.result === null
          ? {}
          : { accessibilityState: { expanded: target.expanded } })}
        disabled={!opens && report.result === null}
        onPress={target.press}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID="task-notification-row"
      >
        <AgentAvatar badge={outcome.badge} subject={report} />
        <ReportRowText
          details={target.error ?? details}
          loading={target.loading}
          name={reportName(report)}
        />
        {opens ? (
          <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
        ) : null}
      </Pressable>
      {target.expanded ? <ReportResult result={report.result} /> : null}
    </View>
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
 * What a report row opens: an agent's thread, a background task's output
 * (loaded on press), else its result text in place.
 */
function useReportTarget(report: TaskNotificationReport, onNavigate: () => void) {
  const openThread = useContext(SubagentNavigationContext);
  const openTask = useContext(BackgroundTaskContext);
  // The list renders in the anchored popover, outside any recycled list cell.
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<OpeningState>(NOT_OPENING);
  const agentThreadId = report.agentThreadId;
  const kind =
    agentThreadId !== null && openThread !== null
      ? "thread"
      : report.kind !== "agent" && openTask !== null
        ? "task"
        : "result";
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
    } else {
      setExpanded((current) => !current);
    }
  });
  return {
    error: opening.status === "failed" ? opening.message : null,
    expanded,
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

function ReportResult({ result }: { readonly result: string | null }): React.JSX.Element | null {
  return result === null ? null : (
    <View style={styles.result}>
      <RichMarkdown source={result} />
    </View>
  );
}
