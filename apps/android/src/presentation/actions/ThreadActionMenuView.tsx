import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { colors, radii, touchTarget } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";

interface ThreadActionMenuViewProps {
  actions: readonly ActionMenuItem[];
  onSelect(id: string): void;
}

export function ThreadActionMenuView({
  actions,
  onSelect,
}: ThreadActionMenuViewProps): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Thread menu"
      actions={actions}
      align="end"
      onSelect={onSelect}
      placement="bottom"
    >
      <Pressable accessibilityLabel="Thread menu" style={triggerStyle}>
        <PresentationIcon color={colors.text} name="more" size={22} />
      </Pressable>
    </ActionMenu>
  );
}

function triggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  trigger: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
