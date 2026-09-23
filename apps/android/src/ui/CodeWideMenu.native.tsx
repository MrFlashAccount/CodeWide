import Ionicons from "@expo/vector-icons/Ionicons";
import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { width } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactElement } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, typeScale, iconSize, typeWeight } from "../theme";
import type { ActionMenuIconName } from "./ActionMenu.types";
import { AppText } from "./Typography";

export type CodeWideMenuAction = {
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ActionMenuIconName | ImageSourcePropType;
  id: string;
  label: string;
  section?: string;
  selected?: boolean;
};

const DEFAULT_MENU_WIDTH = 264;
const MENU_ICON_SLOT_WIDTH = 26;
const MENU_MIN_ROW_HEIGHT = 50;
const DISABLED_OPACITY = 0.4;

type CodeWideMenuProps = {
  actions: readonly CodeWideMenuAction[];
  children: ReactElement;
  expanded: boolean;
  menuWidth?: number;
  onDismiss: () => void;
  onSelect: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * CodeWide's visual skin over Expo UI's native Compose DropdownMenu.
 *
 * The React Native trigger is hosted inside Compose exactly as prescribed by
 * Expo UI. That makes the real trigger bounds the source of truth for popup
 * placement instead of attempting to reconstruct an anchor from touch coordinates.
 */
export function CodeWideMenu({
  actions,
  children,
  expanded,
  menuWidth = DEFAULT_MENU_WIDTH,
  onDismiss,
  onSelect,
  style,
}: CodeWideMenuProps): ReactElement {
  const dismiss = useEvent(onDismiss);
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={style}>
      <MenuPopup
        actions={actions}
        expanded={expanded}
        menuWidth={menuWidth}
        onDismiss={dismiss}
        onSelect={onSelect}
        trigger={children}
      />
    </Host>
  );
}

function MenuPopup({
  actions,
  expanded,
  menuWidth,
  onDismiss,
  onSelect,
  trigger,
}: {
  readonly actions: readonly CodeWideMenuAction[];
  readonly expanded: boolean;
  readonly menuWidth: number;
  readonly onDismiss: () => void;
  readonly onSelect: (id: string) => void;
  readonly trigger: ReactElement;
}): ReactElement {
  return (
    <DropdownMenu
      color={colors.menuSurface}
      cornerRadius={radii.menu}
      expanded={expanded}
      onDismissRequest={onDismiss}
    >
      <DropdownMenu.Trigger>
        <RNHostView matchContents>{trigger}</RNHostView>
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        <MenuBody actions={actions} menuWidth={menuWidth} onSelect={onSelect} />
      </DropdownMenu.Items>
    </DropdownMenu>
  );
}

function MenuBody({
  actions,
  menuWidth,
  onSelect,
}: {
  readonly actions: readonly CodeWideMenuAction[];
  readonly menuWidth: number;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    <RNHostView matchContents modifiers={[width(menuWidth)]}>
      <MenuRows actions={actions} menuWidth={menuWidth} onSelect={onSelect} />
    </RNHostView>
  );
}

function MenuRows({
  actions,
  menuWidth,
  onSelect,
}: {
  readonly actions: readonly CodeWideMenuAction[];
  readonly menuWidth: number;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    <View style={[styles.menuBody, { width: menuWidth }]}>
      {actions.map((action, index) => (
        <MenuEntry
          action={action}
          key={action.id}
          onSelect={onSelect}
          showSection={
            action.section !== undefined && action.section !== actions[index - 1]?.section
          }
          showSeparator={
            index > 0 &&
            action.section !== undefined &&
            action.section !== actions[index - 1]?.section
          }
        />
      ))}
    </View>
  );
}

function MenuEntry({
  action,
  onSelect,
  showSection,
  showSeparator,
}: {
  readonly action: CodeWideMenuAction;
  readonly onSelect: (id: string) => void;
  readonly showSection: boolean;
  readonly showSeparator: boolean;
}): ReactElement {
  return (
    <View>
      {showSeparator && <View style={styles.separator} />}
      {showSection && <AppText style={styles.sectionText}>{action.section}</AppText>}
      <MenuRow action={action} onSelect={onSelect} />
    </View>
  );
}

function MenuRow({
  action,
  onSelect,
}: {
  readonly action: CodeWideMenuAction;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  const select = useEvent(() => {
    onSelect(action.id);
  });
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: action.disabled, selected: action.selected }}
      disabled={action.disabled}
      onPress={select}
      style={({ pressed }) => [
        styles.item,
        pressed && styles.itemPressed,
        action.disabled === true && styles.itemDisabled,
      ]}
    >
      {action.icon !== undefined && <MenuIcon action={action} />}
      <MenuLabel action={action} />
      {action.selected === true && (
        <Ionicons color={colors.text} name="checkmark" size={iconSize.action} />
      )}
    </Pressable>
  );
}

function MenuIcon({ action }: { readonly action: CodeWideMenuAction }): ReactElement | null {
  if (action.icon === undefined) {
    return null;
  }
  const color = action.destructive === true ? colors.red : colors.textMuted;
  return (
    <View style={styles.iconSlot}>
      <MenuGlyph color={color} icon={action.icon} />
    </View>
  );
}

function MenuGlyph({
  color,
  icon,
}: {
  readonly color: string;
  readonly icon: ActionMenuIconName | ImageSourcePropType;
}): ReactElement {
  if (typeof icon === "string") {
    return <Ionicons color={color} name={icon} size={iconSize.action} />;
  }
  return <Image source={icon} style={[styles.iconImage, { tintColor: color }]} />;
}

function MenuLabel({ action }: { readonly action: CodeWideMenuAction }): ReactElement {
  return (
    <View style={styles.itemText}>
      <AppText
        numberOfLines={1}
        style={[styles.itemTitle, action.destructive === true && styles.destructive]}
      >
        {action.label}
      </AppText>
      {action.description !== undefined && (
        <AppText numberOfLines={2} style={styles.itemDescription}>
          {action.description}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  destructive: { color: colors.red },
  iconImage: {
    height: iconSize.action,
    width: iconSize.action,
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
    width: MENU_ICON_SLOT_WIDTH,
  },
  item: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: spacing.xs,
    minHeight: MENU_MIN_ROW_HEIGHT,
    paddingHorizontal: spacing.inputInset,
    paddingVertical: spacing.xs,
  },
  itemDescription: {
    color: colors.textMuted,
    fontFamily: "RobotoFlex-Regular",
    ...typeScale.label,
    fontWeight: typeWeight.regular,
    marginTop: spacing.optical,
  },
  itemDisabled: { opacity: DISABLED_OPACITY },
  itemPressed: { backgroundColor: colors.menuHighlight },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: colors.text,
    fontFamily: "RobotoFlex-Medium",
    ...typeScale.title,
    fontWeight: typeWeight.medium,
  },
  menuBody: { paddingVertical: spacing.xxs },
  sectionText: {
    color: colors.textDim,
    ...typeScale.label,
    fontFamily: "RobotoFlex-Medium",
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  separator: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
  },
});
