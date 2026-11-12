import { useThreadHeaderActions } from "./threadHeaderActions";
import type { ThreadHeaderProps } from "./threadHeaderContract";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import { useState, type ReactElement } from "react";
import { Platform } from "react-native";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { OverflowMenuButton } from "../../ui/OverflowMenuButton";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadActions.styles";

export function ThreadHeaderMenu(props: ThreadHeaderProps) {
  const { onOpenMenu } = props;
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const { actions, handleAction } = useThreadHeaderActions(props);
  if (Platform.OS === "web") {
    return (
      <>
        <OverflowMenuButton
          accessibilityLabel="Thread menu"
          onPress={() => {
            setWebMenuVisible(true);
          }}
        />
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
                // WHY: placeholder glyph for a menu row without an icon, not a menu trigger.
                // oxlint-disable-next-line codewide-v1/overflow-menu-trigger
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
    <OverflowMenu
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
    />
  );
}
