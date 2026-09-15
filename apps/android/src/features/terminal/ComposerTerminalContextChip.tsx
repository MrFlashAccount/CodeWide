/** V1 ComposerTerminalContextChip owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import { useInteractiveTerminalWorkspace } from "../../data/interactive-terminal-store";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { styles } from "./ComposerTerminalContextChip.styles";

export function ComposerTerminalContextChip({
  connectionId,
  threadId,
  onOpen,
}: {
  connectionId: string | null;
  threadId: string | null;
  onOpen(): void;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  if (workspace.tabs.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Terminals: ${workspace.tabs.length}`}
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="terminal-outline"
        role="label"
        color={
          workspace.tabs.some(({ status }) => status === "open") ? colors.green : colors.textMuted
        }
      />
      <ComposerContextCount
        label="Terminals"
        value={workspace.tabs.length}
        testID="composer-terminals-label"
      />
    </Pressable>
  );
}
