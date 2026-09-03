import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactElement } from "react";
import type {
  AccessibilityRole,
  AccessibilityState,
  GestureResponderEvent,
  ImageSourcePropType,
  StyleProp,
  ViewStyle,
} from "react-native";

export type ActionMenuIconName = ComponentProps<typeof Ionicons>["name"];

type ActionMenuTriggerElement = ReactElement<{
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  onLongPress?(event: GestureResponderEvent): void;
  onPress?(event: GestureResponderEvent): void;
}>;

export interface ActionMenuItem {
  id: string;
  section?: string;
  label: string;
  description?: string;
  icon?: ActionMenuIconName | ImageSourcePropType;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  keepOpen?: boolean;
}

export interface ActionMenuProps {
  accessibilityLabel: string;
  actions: readonly ActionMenuItem[];
  children: ActionMenuTriggerElement;
  trigger?: "press" | "long-press";
  placement?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  menuWidth?: number;
  style?: StyleProp<ViewStyle>;
  onOpenChange?(open: boolean): void;
  onSelect(id: string): void;
}
