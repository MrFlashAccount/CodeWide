import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { colors, radii, touchTarget } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";

export interface QueueRowActionViewProps {
  destructive?: boolean;
  disabled: boolean;
  icon: PresentationIconName;
  label: string;
  onPress(): void;
}

/** A touch-sized icon action shared by authoritative queue rows. */
export function QueueRowActionView(props: QueueRowActionViewProps): React.JSX.Element {
  const { destructive = false, disabled, icon, label, onPress } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={actionStyle}
    >
      <PresentationIcon color={destructive ? colors.red : colors.textMuted} name={icon} size={18} />
    </Pressable>
  );
}

function actionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { backgroundColor: colors.surfaceHover },
});
