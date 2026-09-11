import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { colors, radii, touchTarget, iconSize, controlSize, controlHitSlop } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";

interface TopBarActionViewProps {
  compact?: boolean;
  active?: boolean;
  disabled?: boolean;
  icon: PresentationIconName;
  label: string;
  onPress(): void;
}

export function TopBarActionView(props: TopBarActionViewProps): React.JSX.Element {
  const { active = false, compact = false, disabled = false, icon, label, onPress } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? controlHitSlop.regular : 0}
      style={compact ? compactActionStyle : actionStyle}
    >
      <PresentationIcon
        color={active ? colors.primary : colors.text}
        name={icon}
        size={compact ? iconSize.action : iconSize.navigation}
      />
    </Pressable>
  );
}

function actionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, pressed && styles.pressed];
}

function compactActionStyle(state: PressableStateCallbackType) {
  return [actionStyle(state), styles.compact];
}

const styles = StyleSheet.create({
  compact: { width: controlSize.regular, height: controlSize.regular },
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.68 },
});
