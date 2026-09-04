import Ionicons from "@expo/vector-icons/Ionicons";
import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.147.0/v2";
import { Pressable, StyleSheet, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing } from "../theme";
import { AppText as Text } from "./Typography";

interface ThreadGoalChipProps {
  goal: ThreadGoal;
  onPress(): void;
}

export function ThreadGoalChip(props: ThreadGoalChipProps): React.JSX.Element {
  const { goal, onPress } = props;
  return (
    <Pressable
      accessibilityHint="Shows goal details"
      accessibilityLabel={`Goal, ${threadGoalStatusLabel(goal.status)}, ${goal.objective}`}
      accessibilityRole="button"
      onPress={onPress}
      style={goalChipStyle}
      testID="thread-goal-chip"
    >
      <Ionicons color={colors.textMuted} name="flag-outline" size={15} />
      <Text style={styles.title}>Goal</Text>
      <Text style={styles.divider}>·</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.objective}>
        {goal.objective}
      </Text>
    </Pressable>
  );
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
  divider: { color: colors.textDim, flexShrink: 0, fontSize: 11, lineHeight: 15 },
  objective: { color: colors.textMuted, flexShrink: 1, fontSize: 11, lineHeight: 15, minWidth: 0 },
  pressed: { opacity: 0.72 },
  title: { color: colors.text, flexShrink: 0, fontSize: 11, fontWeight: "700", lineHeight: 15 },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: 4,
    flexDirection: "row",
    flexShrink: 1,
    gap: 5,
    maxWidth: "92%",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
});
