import { Pressable } from "react-native";

import type {
  ModelThinkingMenuProps,
  PermissionsMenuProps,
} from "./TurnControlMenus.types";

export function ModelThinkingMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  onFallbackPress,
}: ModelThinkingMenuProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onFallbackPress}
      style={triggerStyle}
    >
      {triggerChildren}
    </Pressable>
  );
}

export function PermissionsMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  onFallbackPress,
}: PermissionsMenuProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onFallbackPress}
      style={triggerStyle}
    >
      {triggerChildren}
    </Pressable>
  );
}
