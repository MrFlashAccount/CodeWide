import { cloneElement, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { AccessibilityRole, AccessibilityState } from "react-native";

interface MockAction {
  disabled?: boolean;
  id: string;
  label: string;
}

interface MockActionMenuProps {
  accessibilityLabel: string;
  actions: readonly MockAction[];
  children: ReactElement<{
    accessibilityLabel?: string;
    accessibilityRole?: AccessibilityRole;
    accessibilityState?: AccessibilityState;
    onLongPress?(): void;
    onPress?(): void;
  }>;
  onSelect(id: string): void;
  trigger?: "long-press" | "press";
}

export function ActionMenu(props: MockActionMenuProps): React.JSX.Element {
  const { accessibilityLabel, actions, children, onSelect, trigger = "press" } = props;
  const triggerLabel = children.props.accessibilityLabel ?? accessibilityLabel;
  const [open, setOpen] = useState(false);
  function openMenu(): void {
    setOpen(true);
  }
  function press(): void {
    children.props.onPress?.();
    if (trigger === "press") openMenu();
  }
  function longPress(): void {
    children.props.onLongPress?.();
    if (trigger === "long-press") openMenu();
  }
  const triggerElement = cloneElement(children, {
    accessibilityLabel: triggerLabel,
    onLongPress: longPress,
    onPress: press,
  });
  return (
    <View>
      {triggerElement}
      {open
        ? actions.map((action) => (
            <Pressable
              accessibilityLabel={`${accessibilityLabel}: ${action.label}`}
              disabled={action.disabled}
              key={action.id}
              onPress={() => onSelect(action.id)}
            >
              <Text>{action.label}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}
