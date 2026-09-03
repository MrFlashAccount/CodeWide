import { selectionAsync } from "expo-haptics";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";

import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem, ActionMenuProps } from "./ActionMenu.types";
import { CodeWideMenu, type CodeWideMenuAction } from "./CodeWideMenu.native";

export type { ActionMenuItem } from "./ActionMenu.types";

function nativeActions(actions: readonly ActionMenuItem[]): readonly CodeWideMenuAction[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    ...(action.section === undefined ? {} : { section: action.section }),
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.icon === undefined ? {} : { icon: action.icon }),
    ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
    ...(action.destructive === undefined ? {} : { destructive: action.destructive }),
    ...(action.selected === undefined ? {} : { selected: action.selected }),
  }));
}

export function ActionMenu(props: ActionMenuProps): React.JSX.Element {
  const {
    accessibilityLabel,
    actions,
    children,
    menuWidth = 288,
    onOpenChange,
    onSelect,
    style,
    trigger = "press",
  } = props;
  const [isOpen, setIsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const setOpen = useEvent((open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  });
  const open = useEvent(() => setOpen(true));
  const close = useEvent(() => setOpen(false));
  const press = useEvent((event: GestureResponderEvent) => {
    children.props.onPress?.(event);
    if (trigger === "press") open();
  });
  const longPress = useEvent((event: GestureResponderEvent) => {
    children.props.onLongPress?.(event);
    if (trigger === "long-press") open();
  });
  const select = useEvent((id: string) => {
    const action = actions.find((candidate) => candidate.id === id);
    if (action === undefined || action.disabled === true) return;
    if (action.keepOpen !== true) setOpen(false);
    void selectionAsync().catch(() => undefined);
    onSelect(id);
  });
  return (
    <View style={[styles.root, style]}>
      <CodeWideMenu
        actions={nativeActions(actions)}
        expanded={isOpen}
        menuWidth={Math.min(menuWidth, width - 24)}
        onDismiss={close}
        onSelect={select}
      >
        <Pressable
          accessibilityLabel={children.props.accessibilityLabel ?? accessibilityLabel}
          accessibilityRole={children.props.accessibilityRole}
          accessibilityState={children.props.accessibilityState}
          delayLongPress={350}
          onLongPress={longPress}
          onPress={press}
        >
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            {children}
          </View>
        </Pressable>
      </CodeWideMenu>
    </View>
  );
}

const styles = StyleSheet.create({ root: { minWidth: 0 } });
