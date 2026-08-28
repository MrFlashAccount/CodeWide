import Ionicons from "@expo/vector-icons/Ionicons";
import { cloneElement, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { colors, spacing } from "../theme";
import type { ActionMenuProps } from "./ActionMenu.types";
import { AppSheet } from "./AppSheet";
import { AppText as Text } from "./Typography";

export type { ActionMenuItem } from "./ActionMenu.types";

export function ActionMenu({
  accessibilityLabel,
  actions,
  children,
  trigger = "press",
  style,
  onOpenChange,
  onSelect,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const triggerAccessibilityLabel = children.props.accessibilityLabel ?? accessibilityLabel;
  const triggerElement = cloneElement(children, trigger === "long-press"
    ? { onLongPress: () => setOpen(true), accessibilityLabel: triggerAccessibilityLabel }
    : { onPress: () => setOpen(true), accessibilityLabel: triggerAccessibilityLabel });

  return (
    <View style={style}>
      {triggerElement}
      <AppSheet isOpen={isOpen} onOpenChange={setOpen} contentProps={{ index: 0, enableDynamicSizing: true }}>
        <View style={styles.content}>
          {actions.map((action, index) => (
            <View key={action.id}>
            {action.section !== undefined && action.section !== actions[index - 1]?.section && <Text style={styles.section}>{action.section}</Text>}
            <Pressable
              accessibilityRole="menuitem"
              accessibilityState={{ disabled: action.disabled, selected: action.selected }}
              disabled={action.disabled}
              onPress={() => {
                setOpen(false);
                onSelect(action.id);
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed, action.disabled && styles.disabled]}
            >
              {typeof action.icon === "string" && (
                <Ionicons name={action.icon} size={19} color={action.destructive ? colors.red : colors.textMuted} />
              )}
              {action.icon !== undefined && typeof action.icon !== "string" && (
                <Image source={action.icon} style={[styles.icon, action.destructive && styles.dangerIcon]} />
              )}
              <View style={styles.text}>
                <Text style={[styles.label, action.destructive && styles.danger]}>{action.label}</Text>
                {action.description !== undefined && <Text style={styles.description}>{action.description}</Text>}
              </View>
              {action.selected === true && <Ionicons name="checkmark" size={18} color={colors.accent} />}
            </Pressable>
            </View>
          ))}
        </View>
      </AppSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 2 },
  section: { color: colors.textDim, fontSize: 12, lineHeight: 16, paddingHorizontal: spacing.sm, paddingBottom: 3, paddingTop: spacing.sm },
  item: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 14 },
  pressed: { backgroundColor: colors.surfaceContainerHigh },
  disabled: { opacity: 0.42 },
  text: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 15, lineHeight: 20, fontFamily: "RobotoFlex-Medium" },
  description: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  danger: { color: colors.red },
  icon: { width: 19, height: 19, tintColor: colors.textMuted },
  dangerIcon: { tintColor: colors.red },
});
