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
import type { ReactElement } from "react";
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuIconName } from "./ActionMenu.types";
import { productFonts } from "./productFonts";

export interface CodeWideMenuAction {
  id: string;
  label: string;
  description?: string;
  icon?: ActionMenuIconName | ImageSourcePropType;
  section?: string;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
}

interface MenuIconProps {
  icon: ActionMenuIconName | ImageSourcePropType;
  color: string;
  size: number;
}

function MenuIcon(props: MenuIconProps): React.JSX.Element {
  const { color, icon, size } = props;
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

interface CodeWideMenuProps {
  actions: readonly CodeWideMenuAction[];
  children: ReactElement;
  expanded: boolean;
  menuWidth?: number;
  style?: StyleProp<ViewStyle>;
  onDismiss(): void;
  onSelect(id: string): void;
}

interface CodeWideMenuItemProps {
  action: CodeWideMenuAction;
  menuWidth: number;
  onSelect(id: string): void;
  showDivider: boolean;
  startsSection: boolean;
}

/**
 * CodeWide's visual skin over Expo UI's native Compose DropdownMenu.
 *
 * The React Native trigger is hosted inside Compose exactly as prescribed by
 * Expo UI. That makes the real trigger bounds the source of truth for popup
 * placement instead of attempting to reconstruct an anchor from touch coordinates.
 */
export function CodeWideMenu(props: CodeWideMenuProps): React.JSX.Element {
  const { actions, children, expanded, menuWidth = 264, onDismiss, onSelect, style } = props;
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
            const startsSection =
              action.section !== undefined && action.section !== actions[index - 1]?.section;
            return (
              <CodeWideMenuItem
                key={action.id}
                action={action}
                menuWidth={menuWidth}
                onSelect={onSelect}
                showDivider={startsSection && index > 0}
                startsSection={startsSection}
              />
            );
          })}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

function CodeWideMenuItem(props: CodeWideMenuItemProps): React.JSX.Element {
  const { action, menuWidth, onSelect, showDivider, startsSection } = props;
  const select = useEvent(() => onSelect(action.id));
  const destructive = action.destructive === true;
  return (
    <>
      {showDivider ? (
        <HorizontalDivider
          color={colors.borderSoft}
          modifiers={[padding(spacing.sm, spacing.xs, spacing.sm, spacing.xs)]}
        />
      ) : null}
      {startsSection ? (
        <Text
          color={colors.textDim}
          modifiers={[width(menuWidth), padding(spacing.sm, spacing.xs, spacing.sm, spacing.xxs)]}
          style={styles.sectionText}
        >
          {action.section}
        </Text>
      ) : null}
      <DropdownMenuItem
        elementColors={{
          disabledLeadingIconColor: colors.textDim,
          disabledTextColor: colors.textDim,
          disabledTrailingIconColor: colors.textDim,
          leadingIconColor: destructive ? colors.red : colors.textMuted,
          textColor: destructive ? colors.red : colors.text,
          trailingIconColor: colors.textMuted,
        }}
        enabled={action.disabled !== true}
        modifiers={[width(menuWidth), height(action.description === undefined ? 50 : 64)]}
        onClick={select}
      >
        {action.icon === undefined ? null : (
          <DropdownMenuItem.LeadingIcon>
            <MenuIcon
              color={destructive ? colors.red : colors.textMuted}
              icon={action.icon}
              size={19}
            />
          </DropdownMenuItem.LeadingIcon>
        )}
        <DropdownMenuItem.Text>
          <Column>
            <Text
              color={destructive ? colors.red : colors.text}
              maxLines={1}
              style={styles.itemTitle}
            >
              {action.label}
            </Text>
            {action.description === undefined ? null : (
              <Text color={colors.textMuted} maxLines={2} style={styles.itemDescription}>
                {action.description}
              </Text>
            )}
          </Column>
        </DropdownMenuItem.Text>
        {action.selected === true ? (
          <DropdownMenuItem.TrailingIcon>
            <MenuIcon color={colors.text} icon="checkmark" size={18} />
          </DropdownMenuItem.TrailingIcon>
        ) : null}
      </DropdownMenuItem>
    </>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  sectionText: {
    fontFamily: productFonts.medium,
    ...typeScale.label,
  },
  itemTitle: {
    fontFamily: productFonts.medium,
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  itemDescription: {
    fontFamily: productFonts.regular,
    ...typeScale.label,
    fontWeight: typeWeight.regular,
  },
});
