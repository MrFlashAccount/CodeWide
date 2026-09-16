import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactElement } from "react";
import type {
  GestureResponderEvent,
  ImageSourcePropType,
  StyleProp,
  ViewStyle,
} from "react-native";

export type ActionMenuIconName = ComponentProps<typeof Ionicons>["name"];

type ActionMenuTriggerElement = ReactElement<{
  accessibilityLabel?: string;
  onLongPress?: (event: GestureResponderEvent) => void;
  onPress?: (event: GestureResponderEvent) => void;
}>;

export type ActionMenuItem = {
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ActionMenuIconName | ImageSourcePropType;
  id: string;
  keepOpen?: boolean;
  label: string;
  section?: string;
  selected?: boolean;
};

export type ActionMenuProps = {
  accessibilityLabel: string;
  actions: readonly ActionMenuItem[];
  align?: "start" | "center" | "end";
  children: ActionMenuTriggerElement;
  menuWidth?: number;
  onOpenChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
  placement?: "top" | "bottom" | "left" | "right";
  style?: StyleProp<ViewStyle>;
  trigger?: "press" | "long-press";
};
