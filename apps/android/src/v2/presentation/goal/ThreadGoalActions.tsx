import { Pressable, View } from "react-native";

import { ProductText } from "../text/ProductText";
import {
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  threadGoalSheetStyles as styles,
} from "./threadGoalSheetStyles";

interface ThreadGoalActionsProps {
  confirmClear: boolean;
  disabled: boolean;
  hasGoal: boolean;
  onClear(): void;
  onClose(): void;
  onSave(): void;
  pending: "clear" | "save" | null;
}

/** Goal mutation actions share one pending gate and explicit destructive confirmation. */
export function ThreadGoalActions(props: ThreadGoalActionsProps): React.JSX.Element {
  const { confirmClear, disabled, hasGoal, onClear, onClose, onSave, pending } = props;
  const unavailable = disabled || pending !== null;
  return (
    <View style={styles.actions}>
      {!hasGoal ? null : (
        <Pressable
          accessibilityLabel={confirmClear ? "Confirm clear goal" : "Clear goal"}
          accessibilityRole="button"
          accessibilityState={{ busy: pending === "clear", disabled: unavailable }}
          disabled={unavailable}
          onPress={onClear}
          style={dangerButtonStyle}
        >
          <ProductText tone="danger" weight="semibold">
            {pending === "clear" ? "Removing…" : confirmClear ? "Remove" : "Clear goal"}
          </ProductText>
        </Pressable>
      )}
      <View style={styles.flex} />
      <Pressable
        accessibilityLabel="Cancel goal"
        accessibilityRole="button"
        disabled={pending !== null}
        onPress={onClose}
        style={secondaryButtonStyle}
      >
        <ProductText weight="semibold">Cancel</ProductText>
      </Pressable>
      <Pressable
        accessibilityLabel={hasGoal ? "Save goal" : "Create goal"}
        accessibilityRole="button"
        accessibilityState={{ busy: pending === "save", disabled: unavailable }}
        disabled={unavailable}
        onPress={onSave}
        style={primaryButtonStyle}
      >
        <ProductText style={styles.primaryLabel} weight="semibold">
          {pending === "save" ? "Saving…" : hasGoal ? "Save" : "Create"}
        </ProductText>
      </Pressable>
    </View>
  );
}
