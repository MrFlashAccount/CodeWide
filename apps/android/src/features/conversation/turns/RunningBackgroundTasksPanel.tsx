import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useContext, type ReactElement } from "react";
import { Pressable, View } from "react-native";

import type { RunningBackgroundTasksQuery } from "../../../data/runningBackgroundTaskResource";
import type { RunningBackgroundTask } from "../../../data/runningBackgroundTasks";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import { backgroundLaunchEntry, commandTitle } from "./backgroundLaunches";
import { TaskNotificationLine } from "./TaskNotificationLine";
import { BackgroundTerminalsContext, RunningBackgroundTasksContext } from "./turnContexts";

type RunningTerminal = Extract<RunningBackgroundTask, { readonly kind: "terminal" }>;

/**
 * Quick access to the thread's background commands that still run, as the
 * last element of the conversation: the same pills their launching turns
 * show, and one pill for the provider's open terminals; gone once a command
 * ends. Not floating: it scrolls with the conversation, below every message.
 */
export function RunningBackgroundTasksPanel(): ReactElement | null {
  const query = useContext(RunningBackgroundTasksContext);
  return query === null ? null : <RunningBackgroundTasks query={query} />;
}

function RunningBackgroundTasks({
  query,
}: {
  readonly query: RunningBackgroundTasksQuery;
}): ReactElement | null {
  const { data } = useQuery(query);
  if (data === undefined || data.length === 0) {
    return null;
  }
  const launches = data.flatMap((task) =>
    task.kind === "task" ? [backgroundLaunchEntry(task.itemId, task.command, task.task)] : [],
  );
  const terminals = data.filter((task): task is RunningTerminal => task.kind === "terminal");
  return (
    <>
      <TaskNotificationLine reports={launches} />
      <RunningTerminalsPill terminals={terminals} />
    </>
  );
}

/**
 * The provider's open terminals as one pill: the command of a single one,
 * else their count; it opens the terminals sheet, where each can be stopped.
 */
function RunningTerminalsPill({
  terminals,
}: {
  readonly terminals: readonly RunningTerminal[];
}): ReactElement | null {
  const open = useContext(BackgroundTerminalsContext);
  const [only] = terminals;
  if (only === undefined) {
    return null;
  }
  const label =
    terminals.length === 1 ? commandTitle(only.command) : `${String(terminals.length)} terminals`;
  return (
    <View style={styles.lineRow} testID="running-terminals-row">
      <Pressable
        accessibilityLabel={`${label} running`}
        accessibilityRole="button"
        disabled={open === null}
        onPress={open ?? undefined}
        style={({ pressed }) => [styles.trigger, styles.pillBound, pressed && styles.pressed]}
        testID="running-terminals-pill"
      >
        <Ionicons color={colors.textDim} name="terminal-outline" size={iconSize.inline} />
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.phrase}>
          running
        </Text>
      </Pressable>
    </View>
  );
}
