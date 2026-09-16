/** V1 ComposerTerminalContextChip owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import { useInteractiveTerminalWorkspace } from "../../data/interactive-terminal-store";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { styles } from "./ComposerTerminalContextChip.styles";

export function ComposerTerminalContextChip({
  connectionId,
  onOpen,
  threadId,
}: {
  connectionId: string | null;
  onOpen: () => void;
  threadId: string | null;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  if (workspace.tabs.length === 0) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={`Terminals: ${String(workspace.tabs.length)}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        color={
          workspace.tabs.some(({ status }) => status === "open") ? colors.green : colors.textMuted
        }
        name="terminal-outline"
        role="label"
      />
      <ComposerContextCount
        label="Terminals"
        testID="composer-terminals-label"
        value={workspace.tabs.length}
      />
    </Pressable>
  );
}
