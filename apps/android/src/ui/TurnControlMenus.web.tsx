import { Pressable } from "react-native";

import type { ModelThinkingMenuProps, PermissionsMenuProps } from "./TurnControlMenus.types";

export function ModelThinkingMenu({
  accessibilityLabel,
  onFallbackPress,
  triggerChildren,
  triggerStyle,
}: ModelThinkingMenuProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onFallbackPress}
      style={triggerStyle}
    >
      {triggerChildren}
    </Pressable>
  );
}

export function PermissionsMenu({
  accessibilityLabel,
  onFallbackPress,
  triggerChildren,
  triggerStyle,
}: PermissionsMenuProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onFallbackPress}
      style={triggerStyle}
    >
      {triggerChildren}
    </Pressable>
  );
}
