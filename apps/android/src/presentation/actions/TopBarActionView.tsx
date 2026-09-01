import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { colors, radii, touchTarget } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";

interface TopBarActionViewProps {
  active?: boolean;
  disabled?: boolean;
  icon: PresentationIconName;
  label: string;
  onPress(): void;
}

export function TopBarActionView({
  active = false,
  disabled = false,
  icon,
  label,
  onPress,
}: TopBarActionViewProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={actionStyle}
    >
      <PresentationIcon color={active ? colors.primary : colors.text} name={icon} size={22} />
    </Pressable>
  );
}

function actionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.68 },
});
