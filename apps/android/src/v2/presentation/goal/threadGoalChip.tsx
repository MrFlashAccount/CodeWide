import type { V2ThreadGoal } from "@codewide/sync-client/v2";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { threadGoalStatusLabel } from "./threadGoalPresentation";

interface ThreadGoalChipProps {
  goal: V2ThreadGoal;
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
      style={styles.pressable}
      testID="thread-goal-chip"
    >
      <ThreadGoalChipContent goal={goal} />
    </Pressable>
  );
}

interface ThreadGoalChipContentProps {
  goal: V2ThreadGoal;
}

function ThreadGoalChipContent(props: ThreadGoalChipContentProps): React.JSX.Element {
  const { goal } = props;
  return (
    <View style={styles.trigger}>
      <PresentationIcon color={colors.textMuted} name="flag" size={typeScale.label.fontSize} />
      <ProductText style={styles.title} weight="semibold">
        Goal
      </ProductText>
      <ProductText style={styles.fixed} tone="dim">
        ·
      </ProductText>
      <ProductText ellipsizeMode="tail" numberOfLines={1} style={styles.objective} tone="muted">
        {goal.objective}
      </ProductText>
    </View>
  );
}

const styles = StyleSheet.create({
  fixed: { flexShrink: 0, ...typeScale.label },
  objective: { flexShrink: 1, minWidth: 0, ...typeScale.label },
  pressable: { flexShrink: 1, maxWidth: "92%" },
  title: { flexShrink: 0, ...typeScale.label },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xxs,
    maxWidth: "100%",
    minHeight: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
});
