import Ionicons from "@expo/vector-icons/Ionicons";
import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.147.0/v2";
import { Pressable, StyleSheet, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight, iconSize, controlSize } from "../theme";
import { AppText as Text } from "./Typography";

interface ThreadGoalChipProps {
  goal: ThreadGoal;
  onPress(): void;
}

export function ThreadGoalChip(props: ThreadGoalChipProps): React.JSX.Element {
  const { goal, onPress } = props;
  const status = threadGoalStatusLabel(goal.status);
  const duration = formatThreadGoalDuration(goal.timeUsedSeconds);
  return (
    <Pressable
      accessibilityHint="Opens the goal editor"
      accessibilityLabel={`Goal, ${status}, ${duration}`}
      accessibilityRole="button"
      onPress={onPress}
      style={goalChipStyle}
      testID="thread-goal-chip"
    >
      <Ionicons color={colors.textMuted} name="flag-outline" size={iconSize.inline} />
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.divider}>·</Text>
      <Text style={styles.duration}>{duration}</Text>
    </Pressable>
  );
}

function formatThreadGoalDuration(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m ${String(remainder)}s`;
  return `${String(minutes)}m ${String(remainder)}s`;
}

export function threadGoalStatusLabel(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "usageLimited":
      return "Usage limited";
    case "budgetLimited":
      return "Budget limited";
    case "complete":
      return "Complete";
  }
}

function goalChipStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.trigger, state.pressed && styles.pressed];
}

const styles = StyleSheet.create({
  divider: { color: colors.textDim, flexShrink: 0, ...typeScale.label, },
  duration: { color: colors.textMuted, flexShrink: 0, ...typeScale.label },
  pressed: { opacity: 0.72 },
  status: { color: colors.text, flexShrink: 0, ...typeScale.label, fontWeight: typeWeight.semibold },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: 4,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xxs,
    maxWidth: "92%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
});
