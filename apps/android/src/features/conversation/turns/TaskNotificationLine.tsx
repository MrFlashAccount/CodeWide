import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext, useState } from "react";
import { Pressable, View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { AnchoredMenuList, AnchoredMenuRow } from "../../../ui/AnchoredMenuList";
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

/** The pill takes at most this share of the conversation's width. */
const PILL_WIDTH_SHARE = 0.5;

/**
 * Background task reports drawn outside a bubble as one short pill: the
 * reports that woke a turn, or those that arrived while it answered. A single
 * report's pill opens it directly (an agent's thread or a command's output);
 * several open a plain list centered on the pill. Each report's status is the
 * dot on its avatar.
 */
export function TaskNotificationLine({
  reports,
}: {
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element | null {
  const layout = useLayoutWidth();
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
  const [only] = reports;
  return (
    <View onLayout={layout.onLayout} style={styles.lineRow} testID="task-notification-line-row">
      {reports.length === 1 && only !== undefined ? (
        <SingleReportPill lineWidth={lineWidth} report={only} />
      ) : (
        <ReportListPill lineWidth={lineWidth} reports={reports} />
      )}
    </View>
  );
}

/** One report: the pill is the report's own link, without a list. */
function SingleReportPill({
  lineWidth,
  report,
}: {
  readonly lineWidth: number;
  readonly report: TaskNotificationReport;
}): React.JSX.Element {
  // The pill lives in a recycled list cell.
  const [opening, setOpening] = useRecyclingState<OpeningState>(NOT_OPENING);
  const target = useReportTarget(report, [opening, setOpening], noop);
  return (
    <>
      <TaskNotificationPill
        loading={target.loading}
        maxWidth={lineWidth * PILL_WIDTH_SHARE}
        onPress={target.kind === "none" ? null : target.press}
        open={null}
        reports={[report]}
      />
      {target.error === null ? null : (
        <Text numberOfLines={2} style={styles.lineError} testID="task-notification-error">
          {target.error}
        </Text>
      )}
    </>
  );
}

/** Several reports: the pill opens their list centered on it, above or below. */
function ReportListPill({
  lineWidth,
  reports,
}: {
  readonly lineWidth: number;
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element {
  const [open, setOpen] = useRecyclingState(false);
  const menu = useAnchoredMenuSize();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const close = useEvent(() => {
    setOpen(false);
  });
  const trigger = createElement(TaskNotificationPill, {
    loading: false,
    maxWidth: lineWidth * PILL_WIDTH_SHARE,
    onPress: toggleOpen,
    open,
    reports,
  });
  return (
    <ContentMenu
      align="center"
      onOpenChange={setOpen}
      open={open}
      placement="bottom"
      trigger={trigger}
      width={Math.min(menu.width, lineWidth)}
    >
      <AnchoredMenuList testID="task-notification-list">
        {reports.map((report) => (
          <ReportRow key={report.id} onNavigate={close} report={report} />
        ))}
      </AnchoredMenuList>
    </ContentMenu>
  );
}

/**
 * The pill itself. `open` is the list's state for a pill that opens one and
 * `null` for a single report's link; `onPress` is `null` when nothing opens.
 */
function TaskNotificationPill({
  loading,
  maxWidth,
  onPress,
  open,
  reports,
}: {
  readonly loading: boolean;
  readonly maxWidth: number;
  readonly onPress: (() => void) | null;
  readonly open: boolean | null;
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element {
  const summary = reportLineSummary(reports);
  return (
    <Pressable
      accessibilityLabel={`${summary.label} ${summary.phrase}`}
      accessibilityRole="button"
      accessibilityState={open === null ? { busy: loading } : { expanded: open }}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      style={({ pressed }) => [styles.trigger, { maxWidth }, pressed && styles.pressed]}
      testID="task-notification-line"
    >
      <AgentAvatarStack
        badgeOf={(report) => reportOutcome(report).badge}
        keyOf={(report) => report.id}
        subjects={reports}
        surface={colors.surfaceRaised}
      />
      <Text ellipsizeMode="tail" numberOfLines={1} shimmering={loading} style={styles.label}>
        {summary.label}
      </Text>
    </Pressable>
  );
}

function ReportRow({
  onNavigate,
  report,
}: {
  readonly onNavigate: () => void;
  readonly report: TaskNotificationReport;
}): React.JSX.Element {
  // The list renders in the anchored popover, outside any recycled list cell.
  const [opening, setOpening] = useState<OpeningState>(NOT_OPENING);
  const target = useReportTarget(report, [opening, setOpening], onNavigate);
  const details = reportDetails(report);
  return (
    <AnchoredMenuRow
      accessibilityLabel={`${reportName(report)}, ${reportOutcome(report).phrase}, ${details}`}
      disabled={target.kind === "none"}
      onPress={target.press}
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
    </AnchoredMenuRow>
  );
}

/** Opening a task's output: idle, loading, or a failure shown in the row. */
type OpeningState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "failed" };

const NOT_OPENING: OpeningState = { status: "idle" };
const noop = (): void => undefined;
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
function useReportTarget(
  report: TaskNotificationReport,
  [opening, setOpening]: readonly [OpeningState, (next: OpeningState) => void],
  onNavigate: () => void,
) {
  const openThread = useContext(SubagentNavigationContext);
  const openTask = useContext(BackgroundTaskContext);
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
