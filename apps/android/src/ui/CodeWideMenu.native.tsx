import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Column,
  DropdownMenu,
  DropdownMenuItem,
  HorizontalDivider,
  Host,
  Icon,
  RNHostView,
  Text,
} from "@expo/ui/jetpack-compose";
import { height, padding, width } from "@expo/ui/jetpack-compose/modifiers";
import { Fragment, type ReactElement } from "react";
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import type { ActionMenuIconName } from "./ActionMenu.types";

export type CodeWideMenuAction = {
  id: string;
  label: string;
  description?: string;
  icon?: ActionMenuIconName | ImageSourcePropType;
  section?: string;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
};

function MenuIcon({
  icon,
  color,
  size,
}: {
  icon: ActionMenuIconName | ImageSourcePropType;
  color: string;
  size: number;
}) {
  if (typeof icon !== "string") {
    return <Icon source={icon} size={size} tint={color} />;
  }

  return (
    <RNHostView matchContents>
      <View pointerEvents="none" style={[styles.iconSlot, { width: size, height: size }]}>
        <Ionicons color={color} name={icon} size={size} />
      </View>
    </RNHostView>
  );
}

type CodeWideMenuProps = {
  actions: readonly CodeWideMenuAction[];
  children: ReactElement;
  expanded: boolean;
  menuWidth?: number;
  style?: StyleProp<ViewStyle>;
  onDismiss(): void;
  onSelect(id: string): void;
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
  menuWidth = 264,
  style,
  onDismiss,
  onSelect,
}: CodeWideMenuProps) {
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={style}>
      <DropdownMenu
        color={colors.surfaceContainer}
        cornerRadius={radii.menu}
        expanded={expanded}
        onDismissRequest={onDismiss}
      >
        <DropdownMenu.Trigger>
          <RNHostView matchContents>{children}</RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {actions.map((action, index) => {
            const startsSection = action.section !== undefined
              && action.section !== actions[index - 1]?.section;
            return (
              <Fragment key={action.id}>
                {startsSection && index > 0 && (
                  <HorizontalDivider
                    color={colors.borderSoft}
                    modifiers={[padding(spacing.sm, spacing.xs, spacing.sm, spacing.xs)]}
                  />
                )}
                {startsSection && (
                  <Text
                    color={colors.textDim}
                    modifiers={[width(menuWidth), padding(spacing.sm, spacing.xs, spacing.sm, spacing.xxs)]}
                    style={styles.sectionText}
                  >
                    {action.section}
                  </Text>
                )}
                <DropdownMenuItem
                  elementColors={{
                    textColor: action.destructive ? colors.red : colors.text,
                    disabledTextColor: colors.textDim,
                    leadingIconColor: action.destructive ? colors.red : colors.textMuted,
                    disabledLeadingIconColor: colors.textDim,
                    trailingIconColor: colors.textMuted,
                    disabledTrailingIconColor: colors.textDim,
                  }}
                  enabled={action.disabled !== true}
                  modifiers={[width(menuWidth), height(action.description === undefined ? 50 : 64)]}
                  onClick={() => onSelect(action.id)}
                >
                  {action.icon !== undefined && (
                    <DropdownMenuItem.LeadingIcon>
                      <MenuIcon
                        icon={action.icon}
                        size={19}
                        color={action.destructive ? colors.red : colors.textMuted}
                      />
                    </DropdownMenuItem.LeadingIcon>
                  )}
                  <DropdownMenuItem.Text>
                    <Column>
                      <Text
                        color={action.destructive ? colors.red : colors.text}
                        maxLines={1}
                        style={styles.itemTitle}
                      >
                        {action.label}
                      </Text>
                      {action.description !== undefined && (
                        <Text
                          color={colors.textMuted}
                          maxLines={2}
                          style={styles.itemDescription}
                        >
                          {action.description}
                        </Text>
                      )}
                    </Column>
                  </DropdownMenuItem.Text>
                  {action.selected === true && (
                    <DropdownMenuItem.TrailingIcon>
                      <MenuIcon icon="checkmark" size={18} color={colors.text} />
                    </DropdownMenuItem.TrailingIcon>
                  )}
                </DropdownMenuItem>
              </Fragment>
            );
          })}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  sectionText: {
    fontFamily: "RobotoFlex-Medium",
    fontSize: typeScale.labelMedium.fontSize,
    fontWeight: typeScale.labelMedium.fontWeight,
    lineHeight: typeScale.labelMedium.lineHeight,
  },
  itemTitle: {
    fontFamily: "RobotoFlex-Medium",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
  },
  itemDescription: {
    fontFamily: "RobotoFlex-Regular",
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 16,
  },
});
