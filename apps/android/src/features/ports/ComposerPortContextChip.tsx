/** V1 ComposerPortContextChip owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import { useNativePortForwarding } from "../../data/native-port-forwarding-store";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount, ComposerContextLabel } from "../../ui/ResourceContextChip";
import { styles } from "./ComposerPortContextChip.styles";

export function ComposerPortContextChip({
  connectionId,
  onOpen,
}: {
  connectionId: string | null;
  onOpen: () => void;
}) {
  if (connectionId === null) {
    return null;
  }
  return <ComposerPortContextChipLoaded connectionId={connectionId} onOpen={onOpen} />;
}

export function ComposerPortContextChipLoaded({
  connectionId,
  onOpen,
}: {
  connectionId: string;
  onOpen: () => void;
}) {
  const snapshot = useNativePortForwarding(connectionId);
  return <ComposerPortContextChipView onOpen={onOpen} snapshot={snapshot} />;
}

export function ComposerPortContextChipView({
  onOpen,
  snapshot,
}: {
  onOpen: () => void;
  snapshot: ReturnType<typeof useNativePortForwarding>;
}): React.JSX.Element | null {
  const initialLoading = snapshot.profilesStatus === "loading" && snapshot.profiles.length === 0;
  if (!initialLoading && snapshot.profiles.length === 0) {
    return null;
  }
  const label = initialLoading ? "Loading ports…" : `Ports: ${String(snapshot.profiles.length)}`;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: initialLoading }}
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        color={
          !initialLoading && snapshot.profiles.some(({ status }) => status === "live")
            ? colors.green
            : colors.textMuted
        }
        name="git-network-outline"
        role="label"
      />
      {initialLoading ? (
        <ComposerContextLabel loading testID="composer-ports-label" text={label} />
      ) : (
        <ComposerContextCount
          label="Ports"
          testID="composer-ports-label"
          value={snapshot.profiles.length}
        />
      )}
    </Pressable>
  );
}
