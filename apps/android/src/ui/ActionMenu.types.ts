import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { GestureResponderEvent, StyleProp, ViewStyle } from "react-native";

type ActionMenuTriggerElement = ReactElement<{
  accessibilityLabel?: string;
  onLongPress?(event: GestureResponderEvent): void;
  onPress?(event: GestureResponderEvent): void;
}>;

export type ActionMenuItem = {
  id: string;
  section?: string;
  label: string;
  description?: string;
  icon?: ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
};

export type ActionMenuProps = {
  accessibilityLabel: string;
  actions: readonly ActionMenuItem[];
  controls?: ReactNode;
  children: ActionMenuTriggerElement;
  trigger?: "press" | "long-press";
  placement?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  style?: StyleProp<ViewStyle>;
  onOpenChange?(open: boolean): void;
  onSelect(id: string): void;
};
