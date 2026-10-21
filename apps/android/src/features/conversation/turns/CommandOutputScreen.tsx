import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactElement } from "react";
import { Pressable, View } from "react-native";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { styles as viewerStyles } from "../content/FullContentViewer.styles";
import { styles } from "./CommandOutputScreen.styles";
import { CopyButton } from "./MessageActionRail";
import { TaskOutputTerminal } from "./TaskOutputTerminal";
import type { TaskOutputTerminalProps } from "./TaskOutputTerminal.types";

/** Where a command stands, whether it ran in the foreground or as a background task. */
export type CommandOutputStatus =
  | "declined"
  | "failed"
  | "finished"
  | "lost"
  | "running"
  | "stopped"
  | "unknown";

const STATUS_LABEL: Record<CommandOutputStatus, string> = {
  declined: "Declined",
  failed: "Failed",
  finished: "Finished",
  lost: "Lost on restart",
  running: "Running",
  stopped: "Stopped",
  unknown: "Status unknown",
};

/** Green done, red for any failure, grey while it works or nobody knows. */
const STATUS_DOT: Record<CommandOutputStatus, string> = {
  declined: colors.red,
  failed: colors.red,
  finished: colors.green,
  lost: colors.red,
  running: colors.textMuted,
  stopped: colors.red,
  unknown: colors.textMuted,
};

/** The prompt glyph before the command, on screen and in the whole copy. */
const PROMPT = "❯";

/**
 * Every command an agent ran in a shell, on one screen: a header with a short
 * title and a copy of the prompt line with the output, the complete command as
 * a wrapping prompt line, its output in a read-only terminal and a footer with
 * its status. Owners differ only in where the output comes from.
 */
export function CommandOutputScreen({
  command,
  details,
  error,
  loading,
  onClose,
  output,
  outputSource,
  status,
  title,
}: {
  /** The command as launched; null when the Companion does not know it. */
  readonly command: string | null;
  /** Exit code, size and similar facts after the status word. */
  readonly details: readonly string[];
  readonly error: string | null;
  /** True while the output is still being read for the first time. */
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly output: TaskOutputTerminalProps["output"];
  /**
   * Names where the output text comes from. The terminal appends what it has
   * not seen, so a text that replaces rather than extends the previous one
   * must come with a new source.
   */
  readonly outputSource: string;
  readonly status: CommandOutputStatus;
  readonly title: string;
}): ReactElement {
  const plain = stripTerminalControlSequences(output.text);
  // The whole copy reads like the terminal: the prompt line, then the output.
  const whole = command === null ? plain : `${PROMPT} ${command}\n${plain}`;
  return (
    <View style={viewerStyles.fullContentViewer} testID="command-output-screen">
      <CommandOutputHeader onClose={onClose} title={title} whole={whole} />
      {error === null ? null : <Text style={styles.error}>Could not read the output: {error}</Text>}
      <View style={viewerStyles.fullContentViewport}>
        {command === null ? null : <CommandPromptLine command={command} />}
        {loading ? (
          <WaveText
            containerStyle={styles.loading}
            style={viewerStyles.menuNotice}
            text="Loading output…"
          />
        ) : (
          <TaskOutputTerminal key={outputSource} output={output} />
        )}
      </View>
      <CommandOutputFooter details={details} status={status} />
    </View>
  );
}

/** Close, the title and copying the command with its output. */
function CommandOutputHeader({
  onClose,
  title,
  whole,
}: {
  readonly onClose: () => void;
  readonly title: string;
  readonly whole: string;
}): ReactElement {
  return (
    <View style={viewerStyles.fullContentHeader} testID="command-output-header">
      <Pressable
        accessibilityLabel="Close command output"
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
        {title}
      </Text>
      {whole === "" ? null : <CopyButton text={whole} />}
    </View>
  );
}

/**
 * The complete command as a prompt line on the terminal's surface, wrapped
 * rather than cut, pinned while the output scrolls under it, with its own copy.
 */
function CommandPromptLine({ command }: { readonly command: string }): ReactElement {
  return (
    <View style={styles.command} testID="command-output-command">
      <Text style={styles.commandPrompt}>{PROMPT}</Text>
      <Text selectable style={styles.commandText}>
        {command}
      </Text>
      <CopyButton compact text={command} />
    </View>
  );
}

/** The status dot and word, then the facts the owner knows. */
function CommandOutputFooter({
  details,
  status,
}: {
  readonly details: readonly string[];
  readonly status: CommandOutputStatus;
}): ReactElement {
  return (
    <View style={viewerStyles.fullContentFooter}>
      <View style={[styles.dot, { backgroundColor: STATUS_DOT[status] }]} />
      <Text shimmering={status === "running"} style={styles.status}>
        {STATUS_LABEL[status]}
      </Text>
      {details.length === 0 ? null : (
        <Text numberOfLines={1} style={styles.details}>
          · {details.join(" · ")}
        </Text>
      )}
    </View>
  );
}
