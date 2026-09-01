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

export function TopBarActionView(props: TopBarActionViewProps): React.JSX.Element {
  const { active = false, disabled = false, icon, label, onPress } = props;
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

function actionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
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
