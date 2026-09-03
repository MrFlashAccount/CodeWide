import { Pressable, StyleSheet, View } from "react-native";

import { ProductText as Text } from "../../presentation/text/ProductText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

interface SavedServerDeleteConfirmationProps {
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
  serverName: string;
}

export function SavedServerDeleteConfirmation(
  props: SavedServerDeleteConfirmationProps,
): React.JSX.Element {
  const { onCancel, onConfirm, pending, serverName } = props;
  return (
    <View style={styles.danger}>
      <Text style={styles.dangerText}>
        Delete {serverName} and all of its local V2 data from this device?
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Cancel delete server"
          disabled={pending}
          onPress={onCancel}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>Keep server</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Confirm delete server"
          disabled={pending}
          onPress={onConfirm}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteText}>Delete server</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    minHeight: touchTarget,
  },
  danger: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.selected,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  dangerText: { color: colors.red, ...typeScale.body },
  deleteButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  deleteText: { color: colors.red, ...typeScale.body },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: colors.text, ...typeScale.body },
});
