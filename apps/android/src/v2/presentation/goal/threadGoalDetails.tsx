import type { V2ThreadGoal } from "@codewide/sync-client/v2";
import { View } from "react-native";

import { ProductText } from "../text/ProductText";
import { TOKEN_SYMBOL } from "../../ui/tokenDisplay";
import { threadGoalSheetStyles as styles } from "./threadGoalSheetStyles";
import { formatThreadGoalDuration, threadGoalStatusLabel } from "./threadGoalPresentation";

interface ThreadGoalDetailsProps {
  goal: V2ThreadGoal;
}

export function ThreadGoalDetails(props: ThreadGoalDetailsProps): React.JSX.Element {
  const { goal } = props;
  const budgetUsage = goalBudgetUsage(goal);
  return (
    <View accessibilityLabel="Goal details" style={styles.details} testID="thread-goal-details">
      <GoalDetail label="Status" value={threadGoalStatusLabel(goal.status)} />
      <GoalDetail label="Duration" value={formatThreadGoalDuration(goal.timeUsedSeconds)} />
      <GoalDetail
        label="Tokens spent"
        value={`${TOKEN_SYMBOL}${goal.tokensUsed.toLocaleString()}${budgetUsage}`}
      />
      <GoalDetail label="Cost" value="Not reported" />
    </View>
  );
}

function goalBudgetUsage(goal: V2ThreadGoal): string {
  if (goal.tokenBudget === null || goal.tokenBudget === 0) return "";
  const percent = Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100));
  return ` · ${String(percent)}% of budget`;
}

interface GoalDetailProps {
  label: string;
  value: string;
}

function GoalDetail(props: GoalDetailProps): React.JSX.Element {
  const { label, value } = props;
  return (
    <View style={styles.detailItem}>
      <ProductText style={styles.detailLabel} tone="dim">
        {label}
      </ProductText>
      <ProductText style={styles.detailValue} weight="medium">
        {value}
      </ProductText>
    </View>
  );
}
