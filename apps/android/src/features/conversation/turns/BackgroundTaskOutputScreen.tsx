import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactElement } from "react";
import { Pressable, View } from "react-native";
import {
  followBackgroundTaskOutput,
  type BackgroundTaskOutput,
  type BackgroundTaskOutputPage,
} from "../../../data/backgroundTaskOutput";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import type { TaskOutputRouteRequest } from "../../../services/backgroundTasks/taskOutputRouteSession";
import { colors, iconSize } from "../../../theme";
import { formatByteSize } from "../../../ui/number-format";
import { AppText as Text } from "../../../ui/Typography";
import { styles as viewerStyles } from "../content/FullContentViewer.styles";
import { styles } from "./BackgroundTaskOutputScreen.styles";
import { CopyButton } from "./MessageActionRail";
import { TaskOutputTerminal } from "./TaskOutputTerminal";

type Status = BackgroundTaskOutputPage["status"];

const STATUS_LABEL: Record<Status, string> = {
  completed: "Finished",
  failed: "Failed",
  killed: "Stopped",
  lost: "Lost on restart",
  running: "Running",
  stopped: "Stopped",
  unknown: "Status unknown",
};

/** Green done, red for any failure, grey while it works or nobody knows. */
const STATUS_DOT: Record<Status, string> = {
  completed: colors.green,
  failed: colors.red,
  killed: colors.red,
  lost: colors.red,
  running: colors.textMuted,
  stopped: colors.red,
  unknown: colors.textMuted,
};

/** The exit line Claude appends to a finished background command's output. */
const EXIT_LINE = /\[exited with code (-?\d+)\]\s*$/u;
/** A text's resident weight: two bytes per UTF-16 unit. */
const BYTES_PER_UNIT = 2;

/** The screen's title; the command itself is pinned above its output. */
const TITLE = "Background command";
/** A long command shows this many lines above the output. */
const COMMAND_LINES = 3;

/**
 * A background task's output on its own screen, framed like the full command
 * output: a header, the task's command pinned above its output in the
 * terminal, and a footer with its status. The screen reads the output by itself and follows
 * a running task until it closes.
 */
export function BackgroundTaskOutputScreen({
  onClose,
  opening,
  request,
}: {
  readonly onClose: () => void;
  /** Names this opening, so reopening the same task reads it afresh. */
  readonly opening: string;
  readonly request: TaskOutputRouteRequest;
}): ReactElement {
  // The screen owns the reading: it stops when the screen closes.
  const resource = useEphemeralAsyncResource<BackgroundTaskOutput>(
    `background-task-output:${opening}`,
    0,
    async (publish, signal) =>
      followBackgroundTaskOutput({ first: request.first, publish, read: request.read, signal }),
    (output) => output.text.length * BYTES_PER_UNIT,
  );
  // The first page shows until the reader publishes; it always does at once.
  const output = resource.value ?? firstOutput(request.first);
  const plain = stripTerminalControlSequences(output.text);
  return (
    <View style={viewerStyles.fullContentViewer} testID="background-task-output-screen">
      <TaskOutputHeader onClose={onClose} plain={plain} />
      {resource.error === null ? null : (
        <Text style={styles.error}>Could not read the output: {resource.error}</Text>
      )}
      <View style={viewerStyles.fullContentViewport}>
        <TaskCommandLine command={request.name} />
        <TaskOutputTerminal output={output} />
      </View>
      <TaskOutputFooter output={output} plain={plain} />
    </View>
  );
}

/** Close, the title and copying the whole output. */
function TaskOutputHeader({
  onClose,
  plain,
}: {
  readonly onClose: () => void;
  readonly plain: string;
}): ReactElement {
  return (
    <View style={viewerStyles.fullContentHeader}>
      <Pressable
        accessibilityLabel="Close task output"
        accessibilityRole="button"
        onPress={onClose}
        style={viewerStyles.headerIcon}
      >
        <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
      </Pressable>
      <View style={viewerStyles.fullContentHeaderIcon}>
        <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.inline} />
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {TITLE}
      </Text>
      {plain === "" ? null : <CopyButton text={plain} />}
    </View>
  );
}

/**
 * The command (or Claude's description of it) as a prompt line on the
 * terminal's surface, pinned while the output scrolls under it.
 */
function TaskCommandLine({ command }: { readonly command: string }): ReactElement {
  return (
    <View style={styles.command} testID="background-task-command">
      <Text style={styles.commandPrompt}>$</Text>
      <Text
        ellipsizeMode="tail"
        numberOfLines={COMMAND_LINES}
        selectable
        style={styles.commandText}
      >
        {command}
      </Text>
    </View>
  );
}

/** The status dot and word, then the exit code and the output's size when known. */
function TaskOutputFooter({
  output,
  plain,
}: {
  readonly output: BackgroundTaskOutput;
  readonly plain: string;
}): ReactElement {
  const exit = EXIT_LINE.exec(plain)?.[1];
  const details = [
    ...(exit === undefined ? [] : [`exit ${exit}`]),
    ...(output.sizeBytes > 0 ? [formatByteSize(output.sizeBytes)] : []),
  ];
  return (
    <View style={viewerStyles.fullContentFooter}>
      <View style={[styles.dot, { backgroundColor: STATUS_DOT[output.status] }]} />
      <Text shimmering={output.status === "running"} style={styles.status}>
        {STATUS_LABEL[output.status]}
      </Text>
      {details.length === 0 ? null : (
        <Text numberOfLines={1} style={styles.details}>
          · {details.join(" · ")}
        </Text>
      )}
    </View>
  );
}

function firstOutput(first: BackgroundTaskOutputPage): BackgroundTaskOutput {
  return {
    headOmitted: false,
    nextOffset: first.nextOffset ?? first.sizeBytes,
    sizeBytes: first.sizeBytes,
    status: first.status,
    text: first.text,
    totalChars: first.text.length,
  };
}
