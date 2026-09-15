/** V1 ComposerPortContextChip owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import { useNativePortForwarding } from "../../data/native-port-forwarding-store";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { styles } from "./ComposerPortContextChip.styles";

export function ComposerPortContextChip({
  connectionId,
  onOpen,
}: {
  connectionId: string | null;
  onOpen(): void;
}) {
  if (connectionId === null) return null;
  return <ComposerPortContextChipLoaded connectionId={connectionId} onOpen={onOpen} />;
}

export function ComposerPortContextChipLoaded({
  connectionId,
  onOpen,
}: {
  connectionId: string;
  onOpen(): void;
}) {
  const snapshot = useNativePortForwarding(connectionId);
  if (snapshot.profiles.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ports: ${snapshot.profiles.length}`}
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="git-network-outline"
        role="label"
        color={
          snapshot.profiles.some(({ status }) => status === "live")
            ? colors.green
            : colors.textMuted
        }
      />
      <ComposerContextCount
        label="Ports"
        value={snapshot.profiles.length}
        testID="composer-ports-label"
      />
    </Pressable>
  );
}
