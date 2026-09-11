import { View } from "react-native";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";

import { ProductText } from "../text/ProductText";
import { threadGoalSheetStyles as styles } from "./threadGoalSheetStyles";

interface ThreadGoalSheetHeaderProps {
  goal: V2ThreadGoal | null;
}

/** Stable goal-sheet chrome shared by loading and ready editor states. */
export function ThreadGoalSheetHeader(props: ThreadGoalSheetHeaderProps): React.JSX.Element {
  const { goal } = props;
  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        <ProductText style={styles.title} weight="semibold">
          {goal === null ? "Create goal" : "Edit goal"}
        </ProductText>
        <ProductText style={styles.subtitle} tone="muted">
          {goal === null
            ? "Keep this thread focused on one outcome."
            : "Goal details and controls."}
        </ProductText>
      </View>
    </View>
  );
}
