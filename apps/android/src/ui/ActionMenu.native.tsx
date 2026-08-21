import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Menu, type MenuTriggerRef } from "heroui-native/menu";
import { Fragment, cloneElement, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { colors } from "../theme";
import type { ActionMenuProps } from "./ActionMenu.types";
import { useOverlaySurface } from "./OverlaySurfaceContext";

export type { ActionMenuItem } from "./ActionMenu.types";

export function ActionMenu(props: ActionMenuProps) {
  return <HeroActionMenu {...props} />;
}

function HeroActionMenu({
  accessibilityLabel,
  actions,
  controls,
  children,
  trigger = "press",
  placement = "bottom",
  align = "end",
  style,
  onOpenChange,
  onSelect,
}: ActionMenuProps) {
  const { portalHostName } = useOverlaySurface();
  const [triggerHandle, setTriggerHandle] = useState<MenuTriggerRef | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [longPressAnchor, setLongPressAnchor] = useState({ left: 0, top: 0 });
  const { width } = useWindowDimensions();
  const menuWidth = Math.min(288, width - 24);
  const triggerAccessibilityLabel = children.props.accessibilityLabel ?? accessibilityLabel;
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const content = (
    <>
      {controls}
      {actions.map((action, index) => (
        <Fragment key={action.id}>
        {action.section !== undefined && action.section !== actions[index - 1]?.section && (
          <Menu.Label className="px-3 pb-1 pt-2 text-xs text-muted">{action.section}</Menu.Label>
        )}
        <Menu.Item
          id={action.id}
          {...(action.description === undefined ? {} : { className: "items-start" })}
          {...(action.disabled === undefined ? {} : { isDisabled: action.disabled })}
          {...(action.selected === undefined ? {} : { isSelected: action.selected })}
          variant={action.destructive ? "danger" : "default"}
          onPress={() => {
            if (action.disabled) return;
            void Haptics.selectionAsync().catch(() => undefined);
            onSelect(action.id);
          }}
        >
          {action.icon !== undefined && (
            <View style={styles.iconSlot}>
              <Ionicons
                name={action.icon}
                size={18}
                color={action.destructive ? colors.red : colors.textMuted}
              />
            </View>
          )}
          <View style={styles.text}>
            <Menu.ItemTitle className="flex-none">{action.label}</Menu.ItemTitle>
            {action.description !== undefined && (
              <Menu.ItemDescription className="flex-none" numberOfLines={2}>{action.description}</Menu.ItemDescription>
            )}
          </View>
          {action.selected === true && <Menu.ItemIndicator />}
        </Menu.Item>
        </Fragment>
      ))}
    </>
  );

  return (
    <Menu
      presentation="popover"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
    >
      {trigger === "press" ? (
        <Menu.Trigger
          asChild
          ref={setTriggerHandle}
          accessibilityLabel={triggerAccessibilityLabel}
          style={style}
        >
          {cloneElement(children, {
            accessibilityLabel: triggerAccessibilityLabel,
            onPress: (event) => {
              children.props.onPress?.(event);
              // Keep a real handler on the native Pressable too. Relying only
              // on Slot's injected handler made compact header triggers lose
              // the press on some Android layouts.
              triggerHandle?.open();
            },
          })}
        </Menu.Trigger>
      ) : (
        <View style={[styles.longPressRoot, style]}>
          {cloneElement(children, {
            accessibilityLabel: triggerAccessibilityLabel,
            onLongPress: (event) => {
              children.props.onLongPress?.(event);
              setLongPressAnchor({
                left: event.nativeEvent.locationX,
                top: event.nativeEvent.locationY,
              });
              // Menu.Trigger measures its native child when open() runs. Give
              // React Native one frame to move the 1px anchor under the finger
              // instead of measuring the whole row as the popover anchor.
              requestAnimationFrame(() => triggerHandle?.open());
            },
          })}
          <Menu.Trigger ref={setTriggerHandle} asChild>
            <Pressable
              accessible={false}
              pointerEvents="none"
              style={[styles.longPressAnchor, longPressAnchor]}
            />
          </Menu.Trigger>
        </View>
      )}
      <Menu.Portal {...(portalHostName === undefined ? {} : { hostName: portalHostName })}>
        <Menu.Overlay className="bg-backdrop" />
        <Menu.Content
          presentation="popover"
          placement={placement}
          align={align}
          width={menuWidth}
          offset={8}
          className="border border-border"
        >
          {content}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  longPressRoot: {
    minWidth: 0,
    position: "relative",
  },
  longPressAnchor: {
    position: "absolute",
    width: 1,
    height: 1,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
});
