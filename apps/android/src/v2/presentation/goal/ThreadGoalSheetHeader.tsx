import { Pressable, View } from "react-native";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";

import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
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
          {goal === null
            ? "Keep this thread focused on one outcome."
            : "Goal details and controls."}
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
