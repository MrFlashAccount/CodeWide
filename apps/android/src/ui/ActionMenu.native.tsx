import * as Haptics from "expo-haptics";
import { cloneElement, useState } from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import type {
  ActionMenuItem,
  ActionMenuProps,
} from "./ActionMenu.types";
import {
  CodeWideMenu,
  type CodeWideMenuAction,
} from "./CodeWideMenu.native";

export type { ActionMenuItem } from "./ActionMenu.types";

function nativeActions(actions: readonly ActionMenuItem[]): readonly CodeWideMenuAction[] {
  return actions.map((action) => {
    return {
      id: action.id,
      label: action.label,
      ...(action.section === undefined ? {} : { section: action.section }),
      ...(action.description === undefined ? {} : { description: action.description }),
      ...(action.icon === undefined ? {} : { icon: action.icon }),
      ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
      ...(action.destructive === undefined ? {} : { destructive: action.destructive }),
      ...(action.selected === undefined ? {} : { selected: action.selected }),
    };
  });
}

export function ActionMenu({
  accessibilityLabel,
  actions,
  children,
  trigger = "press",
  menuWidth = 288,
  style,
  onOpenChange,
  onSelect,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const triggerAccessibilityLabel = children.props.accessibilityLabel ?? accessibilityLabel;
  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const open = () => setOpen(true);
  const triggerElement = cloneElement(children, trigger === "long-press"
    ? {
        accessibilityLabel: triggerAccessibilityLabel,
        onLongPress: (event) => {
          children.props.onLongPress?.(event);
          open();
        },
      }
    : {
        accessibilityLabel: triggerAccessibilityLabel,
        onPress: (event) => {
          children.props.onPress?.(event);
          open();
        },
      });
  const select = (id: string) => {
    const action = actions.find((candidate) => candidate.id === id);
    if (action === undefined || action.disabled === true) return;
    if (action.keepOpen !== true) setOpen(false);
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(id);
  };

  return (
    <View style={[styles.root, style]}>
      <CodeWideMenu
        actions={nativeActions(actions)}
        expanded={isOpen}
        menuWidth={Math.min(menuWidth, width - 24)}
        onDismiss={() => setOpen(false)}
        onSelect={select}
      >
        {triggerElement}
      </CodeWideMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
  },
});
