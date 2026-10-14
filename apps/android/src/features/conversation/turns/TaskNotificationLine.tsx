import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { ContentMenu } from "../../../ui/ContentMenu";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import {
  reportDetails,
  reportLineSummary,
  reportName,
  reportOutcome,
} from "./taskNotificationPresentation";
import { SubagentNavigationContext } from "./turnContexts";

const MENU_MAX_WIDTH = 400;
const MENU_WIDTH_GUTTER = 24;
const MENU_MAX_HEIGHT = 440;
const MENU_HEIGHT_GUTTER = 96;

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
  const { height, width } = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  if (reports.length === 0) {
    return null;
  }
  const summary = reportLineSummary(reports);
  const trigger = createElement(TaskNotificationTrigger, {
    onPress: toggleOpen,
    open,
    reports,
    summary,
  });
  return (
    <View style={styles.lineRow}>
      <ContentMenu
        align="center"
        onOpenChange={setOpen}
        open={open}
        placement="bottom"
        trigger={trigger}
        width={Math.max(1, Math.min(MENU_MAX_WIDTH, width - MENU_WIDTH_GUTTER))}
      >
        <ReportList
          maxHeight={Math.max(1, Math.min(MENU_MAX_HEIGHT, height - MENU_HEIGHT_GUTTER))}
          onNavigate={() => {
            setOpen(false);
          }}
          reports={reports}
        />
      </ContentMenu>
    </View>
  );
}

function TaskNotificationTrigger({
  onPress,
  open,
  reports,
  summary,
}: {
  readonly onPress: () => void;
  readonly open: boolean;
  readonly reports: readonly TaskNotificationReport[];
  readonly summary: ReturnType<typeof reportLineSummary>;
}): React.JSX.Element {
  const single = reports.length === 1;
  return (
    <Pressable
      accessibilityLabel={`${summary.label} ${summary.phrase}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="task-notification-line"
    >
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
    </Pressable>
  );
}

function ReportList({
  maxHeight,
  onNavigate,
  reports,
}: {
  readonly maxHeight: number;
  readonly onNavigate: () => void;
  readonly reports: readonly TaskNotificationReport[];
}): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.list}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={{ maxHeight }}
      testID="task-notification-list"
    >
      <Text accessibilityRole="header" style={styles.listTitle}>
        {reports.length === 1 ? "Background task" : `${String(reports.length)} reports`}
      </Text>
      {reports.map((report) => (
        <ReportRow key={report.id} onNavigate={onNavigate} report={report} />
      ))}
    </ScrollView>
  );
}

function ReportRow({
  onNavigate,
  report,
}: {
  readonly onNavigate: () => void;
  readonly report: TaskNotificationReport;
}): React.JSX.Element {
  const openThread = useContext(SubagentNavigationContext);
  const [expanded, setExpanded] = useRecyclingState(false);
  const outcome = reportOutcome(report);
  const agentThreadId = report.agentThreadId;
  const navigates = agentThreadId !== null && openThread !== null;
  const press = useEvent(() => {
    if (agentThreadId !== null && openThread !== null) {
      onNavigate();
      openThread(agentThreadId);
      return;
    }
    setExpanded((current) => !current);
  });
  const details = reportDetails(report);
  return (
    <View>
      <Pressable
        accessibilityLabel={`${reportName(report)}, ${details}`}
        accessibilityRole="button"
        disabled={!navigates && report.result === null}
        onPress={press}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID="task-notification-row"
      >
        <AgentAvatar badge={outcome.badge} subject={report} />
        <ReportRowText details={details} name={reportName(report)} />
        {navigates ? (
          <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
        ) : null}
      </Pressable>
      {expanded ? <ReportResult result={report.result} /> : null}
    </View>
  );
}

function ReportRowText({
  details,
  name,
}: {
  readonly details: string;
  readonly name: string;
}): React.JSX.Element {
  return (
    <View style={styles.rowText}>
      <Text numberOfLines={1} style={styles.rowName}>
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
