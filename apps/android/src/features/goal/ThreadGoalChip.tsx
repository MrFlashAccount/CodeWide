import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";

import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { threadGoalStatusLabel } from "./goalStatus";

interface ThreadGoalChipProps {
  expanded?: boolean;
  goal: ThreadGoal;
  maxWidth?: number;
  onPress: () => void;
}

const PRESSED_OPACITY = 0.72;

export function ThreadGoalChip(props: ThreadGoalChipProps): React.JSX.Element {
  const { expanded = false, goal, maxWidth, onPress } = props;
  const status = threadGoalStatusLabel(goal.status);
  return (
    <Pressable
      accessibilityHint="Shows goal details and actions"
      accessibilityLabel={`Goal, ${status}, ${goal.objective}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.trigger,
        maxWidth === undefined ? null : { maxWidth },
        pressed && styles.pressed,
      ]}
      testID="thread-goal-chip"
    >
      <Ionicons color={colors.textMuted} name="flag-outline" size={iconSize.inline} />
      <Text style={styles.title}>Goal</Text>
      <Text style={styles.divider}>·</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.status}>
        {status}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  divider: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.label,
  },
  pressed: { opacity: PRESSED_OPACITY },
  status: {
    color: colors.textMuted,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xxs,
    minHeight: controlSize.compact,
    minWidth: 0,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
  },
});
