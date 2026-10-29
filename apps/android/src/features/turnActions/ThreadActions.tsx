import { useThreadHeaderActions } from "./threadHeaderActions";
import type { ThreadHeaderProps } from "./threadHeaderContract";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactElement } from "react";
import { Platform, Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadActions.styles";

export function ThreadHeaderMenu(props: ThreadHeaderProps) {
  const { onOpenMenu } = props;
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const { actions, handleAction } = useThreadHeaderActions(props);
  if (Platform.OS === "web") {
    return (
      <>
        <Pressable
          accessibilityLabel="Thread menu"
          onPress={() => {
            setWebMenuVisible(true);
          }}
          style={styles.headerIcon}
        >
          <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.action} />
        </Pressable>
        {webMenuVisible && (
          <AppSheet
            contentProps={{ enableDynamicSizing: true, index: 0 }}
            isOpen
            onOpenChange={setWebMenuVisible}
          >
            <Text style={styles.sheetTitle}>Thread</Text>
            {actions.map((action) => (
              <MenuAction
                danger={action.destructive === true}
                icon={typeof action.icon === "string" ? action.icon : "ellipsis-horizontal"}
                key={action.id}
                {...(action.disabled === true
                  ? {}
                  : {
                      onPress: () => {
                        setWebMenuVisible(false);
                        handleAction(action.id);
                      },
                    })}
                subtitle={action.description ?? ""}
                title={action.label}
              />
            ))}
          </AppSheet>
        )}
      </>
    );
  }
  return (
    <NativeThreadMenu
      actions={actions}
      onSelect={handleAction}
      {...(onOpenMenu === undefined ? {} : { onOpenMenu })}
    />
  );
}

/** The native thread menu anchored to the header's overflow button. */
function NativeThreadMenu({
  actions,
  onOpenMenu,
  onSelect,
}: {
  readonly actions: readonly ActionMenuItem[];
  readonly onOpenMenu?: () => void;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    <ActionMenu
      accessibilityLabel="Thread menu"
      actions={actions}
      {...(onOpenMenu === undefined
        ? {}
        : {
            onOpenChange: (open: boolean) => {
              if (open) {
                onOpenMenu();
              }
            },
          })}
      onSelect={onSelect}
      style={styles.headerMenuAnchor}
    >
      <Pressable accessibilityLabel="Thread menu" style={styles.headerIcon}>
        <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.action} />
      </Pressable>
    </ActionMenu>
  );
}
