import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useContext, useEffect, useState, type ContextType } from "react";
import { Pressable, View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { AnchoredMenuRow } from "../../../ui/AnchoredMenuList";
import { TaskPillPicker } from "../../../ui/TaskPillPicker";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import type { TaskLineEntry } from "./backgroundLaunches";
import {
  launchDetail,
  reportDetails,
  reportLineSummary,
  reportName,
  reportOutcome,
} from "./taskNotificationPresentation";
import {
  BackgroundTaskContext,
  BackgroundTerminalsContext,
  SubagentNavigationContext,
} from "./turnContexts";

/** How often a running background command's elapsed time advances. */
const ELAPSED_TICK_MS = 1000;

/**
 * Background tasks drawn outside a bubble as one short pill: the reports that
 * woke a turn or arrived while it answered, and the commands a turn started
 * in the background (their state follows the command item live, from running
 * to its end, with its time). A single entry's pill opens it directly (an
 * agent's thread or a command's output); several open a plain list centered
 * on the pill. Each entry's status is the dot on its avatar.
 */
export function TaskNotificationLine({
  reports,
}: {
  readonly reports: readonly TaskLineEntry[];
}): React.JSX.Element | null {
  if (reports.length === 0) {
    return null;
  }
  const rows = (close: () => void) =>
    reports.map((report) => <ReportRow key={report.id} onNavigate={close} report={report} />);
  return (
    <View style={styles.lineRow} testID="task-notification-line-row">
      <TaskPillPicker
        anchorStyle={styles.pillBound}
        entries={reports}
        listTestID="task-notification-list"
        placement="bottom"
        renderSingle={(report) => <SingleReportPill key={report.id} report={report} />}
        renderTrigger={(open, toggle) =>
          createElement(TaskNotificationPill, {
            bounded: false,
            loading: false,
            onPress: toggle,
            open,
            reports,
          })
        }
      >
        {rows}
      </TaskPillPicker>
    </View>
  );
}

/** One report: the pill is the report's own link, without a list. */
function SingleReportPill({ report }: { readonly report: TaskLineEntry }): React.JSX.Element {
  const target = useReportTarget(report, noop);
  return (
    <>
      <TaskNotificationPill
        bounded
        loading={target.loading}
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

/**
 * The pill itself. `open` is the list's state for a pill that opens one and
 * `null` for a single report's link; `onPress` is `null` when nothing opens.
 * A `bounded` pill sits directly in its line and carries the line's width
 * bound itself; a menu's pill fills the anchor box that carries it.
 */
function TaskNotificationPill({
  bounded,
  loading,
  onPress,
  open,
  reports,
}: {
  readonly bounded: boolean;
  readonly loading: boolean;
  readonly onPress: (() => void) | null;
  readonly open: boolean | null;
  readonly reports: readonly TaskLineEntry[];
}): React.JSX.Element {
  const summary = reportLineSummary(reports);
  const [only] = reports;
  const running = reports.some((report) => report.status === "running");
  const now = useNow(running);
  // A single background command shows its own state and time on the pill.
  const detail = reports.length === 1 && only !== undefined ? launchDetail(only, now) : null;
  return (
    <Pressable
      accessibilityLabel={`${summary.label} ${detail ?? summary.phrase}`}
      accessibilityRole="button"
      accessibilityState={open === null ? { busy: loading } : { expanded: open }}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      style={({ pressed }) => [
        styles.trigger,
        bounded && styles.pillBound,
        pressed && styles.pressed,
      ]}
      testID="task-notification-line"
    >
      <AgentAvatarStack
        badgeOf={(report) => reportOutcome(report).badge}
        keyOf={(report) => report.id}
        subjects={reports}
        surface={colors.surfaceRaised}
      />
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        shimmering={loading || running}
        style={styles.label}
      >
        {summary.label}
      </Text>
      {detail === null ? null : (
        <Text numberOfLines={1} style={styles.phrase}>
          {detail}
        </Text>
      )}
    </Pressable>
  );
}

function ReportRow({
  onNavigate,
  report,
}: {
  readonly onNavigate: () => void;
  readonly report: TaskLineEntry;
}): React.JSX.Element {
  const target = useReportTarget(report, onNavigate);
  const running = report.status === "running";
  const now = useNow(running);
  const details = reportDetails(report, now);
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
        loading={target.loading || running}
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
function useReportTarget(report: TaskLineEntry, onNavigate: () => void) {
  const [opening, setOpening] = useState<OpeningState>(NOT_OPENING);
  const openThread = useContext(SubagentNavigationContext);
  const openTask = useContext(BackgroundTaskContext);
  const openTerminal = useContext(BackgroundTerminalsContext);
  const target = reportTarget(report, { openTask, openTerminal, openThread });
  const kind = target.kind;
  const press = useEvent(() => {
    if (target.kind === "none") {
      return;
    }
    setOpening(OPENING);
    Promise.resolve()
      .then(target.open)
      .then(() => {
        setOpening(NOT_OPENING);
        onNavigate();
      })
      .catch((error: unknown) => {
        setOpening(failedOpening(error));
      });
  });
  return {
    error: opening.status === "failed" ? opening.message : null,
    kind,
    loading: opening.status === "loading",
    press,
  } as const;
}

type ReportTarget =
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly open: () => Promise<void> };
type ReportOpeners = {
  readonly openTask: ContextType<typeof BackgroundTaskContext>;
  readonly openTerminal: ContextType<typeof BackgroundTerminalsContext>;
  readonly openThread: ContextType<typeof SubagentNavigationContext>;
};

function reportTarget(
  report: TaskLineEntry,
  { openTask, openTerminal, openThread }: ReportOpeners,
): ReportTarget {
  if ("terminal" in report) {
    return openTerminal === null
      ? { kind: "none" }
      : { kind: "open", open: async () => openTerminal(report.terminal) };
  }
  const threadId = report.agentThreadId;
  if (threadId !== null && openThread !== null) {
    return {
      kind: "open",
      open: async () => {
        openThread(threadId);
        await Promise.resolve();
      },
    };
  }
  if (report.kind !== "agent" && openTask !== null) {
    return {
      kind: "open",
      open: async () => openTask({ name: reportName(report), taskId: report.taskId }),
    };
  }
  return { kind: "none" };
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

/**
 * The wall clock, advancing every `ELAPSED_TICK_MS` while `ticking` (a
 * running task's elapsed time on screen); a timer is the external system
 * this effect follows.
 */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, ELAPSED_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);
  return now;
}
