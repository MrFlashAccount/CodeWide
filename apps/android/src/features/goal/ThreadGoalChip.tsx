import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  StyleSheet,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { threadGoalStatusLabel } from "./goalStatus";

interface ThreadGoalChipProps {
  goal: ThreadGoal;
  onPress: () => void;
}

export function ThreadGoalChip(props: ThreadGoalChipProps): React.JSX.Element {
  const { goal, onPress } = props;
  const status = threadGoalStatusLabel(goal.status);
  return (
    <Pressable
      accessibilityHint="Opens the goal editor"
      accessibilityLabel={`Goal, ${status}, ${goal.objective}`}
      accessibilityRole="button"
      onPress={onPress}
      style={goalChipStyle}
      testID="thread-goal-chip"
    >
      <Ionicons color={colors.textMuted} name="flag-outline" size={iconSize.inline} />
      <Text style={styles.title}>Goal</Text>
      <Text style={styles.divider}>·</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.objective}>
        {goal.objective}
      </Text>
      <Text style={styles.divider}>·</Text>
      <Text style={styles.status}>{status}</Text>
    </Pressable>
  );
}

function goalChipStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.trigger, state.pressed && styles.pressed];
}

const styles = StyleSheet.create({
  divider: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.label,
  },
  objective: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.label,
  },
  pressed: { opacity: 0.72 },
  status: {
    color: colors.textMuted,
    flexShrink: 0,
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
    elevation: 4,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xxs,
    maxWidth: "92%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
});
