import Ionicons from "@expo/vector-icons/Ionicons";
import type { RenderBlock } from "@codewide/renderers";
import { useContext, useState, type ReactElement } from "react";
import { Pressable } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { BackgroundTaskContext } from "../turns/turnContexts";
import { styles } from "./CommandOutput.styles";

/**
 * Opens the output of a command Claude runs in the background. The command
 * item carries the task id; the output loads on press, running or finished.
 */
export function BackgroundTaskOutputButton({
  block,
  name,
}: {
  readonly block: RenderBlock;
  readonly name: string;
}): ReactElement | null {
  const openTask = useContext(BackgroundTaskContext);
  const [state, setState] = useState<OpenState>(IDLE);
  const taskId = backgroundTaskId(block.raw);
  const open = useEvent(() => {
    if (openTask === null || taskId === null) {
      return;
    }
    setState(LOADING);
    openTask({ name, taskId }).then(
      () => {
        setState(IDLE);
      },
      (error: unknown) => {
        setState(failedOpen(error));
      },
    );
  });
  if (openTask === null || taskId === null) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel="Open background output"
      accessibilityRole="button"
      disabled={state.status === "loading"}
      onPress={open}
      style={({ pressed }) => [styles.backgroundTaskButton, pressed && styles.pressed]}
      testID="background-task-output-open"
    >
      <Ionicons color={colors.textMuted} name="reader-outline" size={iconSize.inline} />
      <Text shimmering={state.status === "loading"} style={styles.backgroundTaskLabel}>
        {state.status === "failed" ? state.message : "Background output"}
      </Text>
    </Pressable>
  );
}

/** Opening a task: idle, its output loading, or a failure to show in place. */
type OpenState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "failed" };

const IDLE: OpenState = { status: "idle" };
const LOADING: OpenState = { status: "loading" };

function failedOpen(error: unknown): OpenState {
  return {
    message: error instanceof Error ? error.message : "Could not read the output",
    status: "failed",
  };
}

function backgroundTaskId(raw: Record<string, unknown>): string | null {
  const id = raw.codewideBackgroundTaskId;
  return typeof id === "string" && id !== "" ? id : null;
}
