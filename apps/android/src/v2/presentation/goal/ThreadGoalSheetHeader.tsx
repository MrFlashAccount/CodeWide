import { Pressable, View } from "react-native";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";

import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { TOKEN_SYMBOL } from "../../ui/tokenDisplay";
import { iconButtonStyle, threadGoalSheetStyles as styles } from "./threadGoalSheetStyles";

interface ThreadGoalSheetHeaderProps {
  disabled: boolean;
  goal: V2ThreadGoal | null;
  onClose(): void;
}

/** Stable goal-sheet chrome shared by loading and ready editor states. */
export function ThreadGoalSheetHeader(props: ThreadGoalSheetHeaderProps): React.JSX.Element {
  const { disabled, goal, onClose } = props;
  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        <ProductText style={styles.title} weight="semibold">
          {goal === null ? "Create goal" : "Edit goal"}
        </ProductText>
        <ProductText style={styles.subtitle} tone="muted">
          {goal === null ? "Keep this thread focused on one outcome." : goalUsageLabel(goal)}
        </ProductText>
      </View>
      <Pressable
        accessibilityLabel="Close goal"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onClose}
        style={iconButtonStyle}
      >
        <PresentationIcon color={colors.text} name="close" size={22} />
      </Pressable>
    </View>
  );
}

function goalUsageLabel(goal: V2ThreadGoal): string {
  const budget =
    goal.tokenBudget === null || goal.tokenBudget === 0
      ? ""
      : ` · ${goalUsagePercent(goal)}% of budget`;
  return `${TOKEN_SYMBOL}${goal.tokensUsed.toLocaleString()} · ${formatGoalDuration(goal.timeUsedSeconds)}${budget}`;
}

function goalUsagePercent(goal: V2ThreadGoal): number {
  if (goal.tokenBudget === null) return 0;
  return Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100));
}

function formatGoalDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
