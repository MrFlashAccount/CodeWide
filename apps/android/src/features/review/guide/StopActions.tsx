import { StyleSheet, View } from "react-native";

import type { StopProgressState } from "../../../data/reviewGuideContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { spacing } from "../../../theme";

/**
 * Stop actions: Comment, Send to agent, Accept. Accept marks only the guide
 * stop and moves on; it never marks a file viewed and never writes to a forge.
 */
export function StopActions({
  onAccept,
  onComment,
  onSendToAgent,
  pending,
  progress,
}: {
  readonly onAccept: () => void;
  readonly onComment: () => void;
  readonly onSendToAgent: () => void;
  readonly pending: boolean;
  readonly progress: StopProgressState;
}): React.JSX.Element {
  return (
    <View style={styles.row} testID="review-guide-stop-actions">
      <AppButton onPress={onComment} size="sm" style={styles.compact} variant="outline">
        Comment
      </AppButton>
      <AppButton onPress={onSendToAgent} size="sm" style={styles.compact} variant="outline">
        Send to agent
      </AppButton>
      <AppButton
        accessibilityState={{ busy: pending, checked: progress === "accepted" }}
        isDisabled={pending}
        onPress={onAccept}
        size="sm"
        style={styles.accept}
        variant={progress === "accepted" ? "secondary" : "primary"}
      >
        {progress === "accepted" ? "Accepted ✓" : "Accept ✓"}
      </AppButton>
    </View>
  );
}

const styles = StyleSheet.create({
  accept: {
    marginLeft: "auto",
    paddingHorizontal: spacing.sm,
  },
  // Compact insets keep the three actions on one row at 360dp.
  compact: {
    paddingHorizontal: spacing.sm,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    // Below 360dp Accept moves to its own line, still right-aligned, instead of being clipped (N-06).
    flexWrap: "wrap",
    paddingHorizontal: spacing.md,
    rowGap: spacing.xs,
  },
});
