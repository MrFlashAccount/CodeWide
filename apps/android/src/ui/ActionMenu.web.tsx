import Ionicons from "@expo/vector-icons/Ionicons";
import { cloneElement, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale, iconSize, layoutSize, radii } from "../theme";
import type { ActionMenuProps } from "./ActionMenu.types";
import { AppSheet } from "./AppSheet";
import { AppText as Text } from "./Typography";

export type { ActionMenuItem } from "./ActionMenu.types";

export function ActionMenu({
  accessibilityLabel,
  actions,
  children,
  onOpenChange,
  onSelect,
  style,
  trigger = "press",
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const triggerAccessibilityLabel = children.props.accessibilityLabel ?? accessibilityLabel;
  const triggerElement = cloneElement(
    children,
    trigger === "long-press"
      ? {
          accessibilityLabel: triggerAccessibilityLabel,
          onLongPress: () => {
            setOpen(true);
          },
        }
      : {
          accessibilityLabel: triggerAccessibilityLabel,
          onPress: () => {
            setOpen(true);
          },
        },
  );

  return (
    <View style={style}>
      {triggerElement}
      <AppSheet
        contentProps={{ enableDynamicSizing: true, index: 0 }}
        isOpen={isOpen}
        onOpenChange={setOpen}
      >
        <View style={styles.content}>
          {actions.map((action, index) => (
            <View key={action.id}>
              {action.section !== undefined && action.section !== actions[index - 1]?.section && (
                <Text style={styles.section}>{action.section}</Text>
              )}
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: action.disabled, selected: action.selected }}
                disabled={action.disabled}
                onPress={() => {
                  setOpen(false);
                  onSelect(action.id);
                }}
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.pressed,
                  action.disabled === true && styles.disabled,
                ]}
              >
                {typeof action.icon === "string" && (
                  <Ionicons
                    color={action.destructive === true ? colors.red : colors.textMuted}
                    name={action.icon}
                    size={iconSize.action}
                  />
                )}
                {action.icon !== undefined && typeof action.icon !== "string" && (
                  <Image
                    source={action.icon}
                    style={[styles.icon, action.destructive === true && styles.dangerIcon]}
                  />
                )}
                <View style={styles.text}>
                  <Text style={[styles.label, action.destructive === true && styles.danger]}>
                    {action.label}
                  </Text>
                  {action.description !== undefined && (
                    <Text style={styles.description}>{action.description}</Text>
                  )}
                </View>
                {action.selected === true && (
                  <Ionicons color={colors.accent} name="checkmark" size={iconSize.action} />
                )}
              </Pressable>
            </View>
          ))}
        </View>
      </AppSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.optical },
  danger: { color: colors.red },
  dangerIcon: { tintColor: colors.red },
  description: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  disabled: { opacity: 0.42 },
  icon: {
    height: 19,
    tintColor: colors.textMuted,
    width: 19,
  },
  item: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.sm,
  },
  label: {
    color: colors.text,
    ...typeScale.body,
    fontFamily: "RobotoFlex-Medium",
  },
  pressed: { backgroundColor: colors.surfaceContainerHigh },
  section: {
    color: colors.textDim,
    ...typeScale.label,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
