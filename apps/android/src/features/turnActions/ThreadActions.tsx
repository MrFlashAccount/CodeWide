import { useThreadHeaderActions } from "./threadHeaderActions";
import { ThreadPullRequestPickerContext, type ThreadHeaderProps } from "./threadHeaderContract";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import { useContext, useState, type ReactElement } from "react";
import { AttachPullRequestSheet } from "../pullRequests/AttachPullRequestSheet";
import { Platform } from "react-native";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { OverflowMenuButton } from "../../ui/OverflowMenuButton";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadActions.styles";

export function ThreadHeaderMenu(props: ThreadHeaderProps): ReactElement {
  const { onOpenMenu } = props;
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const [picking, setPicking] = useState(false);
  const picker = useContext(ThreadPullRequestPickerContext);
  const open = useEvent(() => {
    setPicking(true);
  });
  const close = useEvent(() => {
    setPicking(false);
  });
  const available = picker?.threadId === props.threadId;
  const { actions, handleAction } = useThreadHeaderActions(props, available ? open : null);
  const sheet =
    picking && available ? (
      <AttachPullRequestSheet
        badges={picker.badges}
        connectionId={picker.connectionId}
        forge={picker.forge}
        key={picker.connectionId}
        onAttach={picker.onAttach}
        onClose={close}
      />
    ) : null;
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
        {sheet}
      </>
    );
  }
  return (
    <>
      <NativeThreadMenu
        actions={actions}
        onSelect={handleAction}
        {...(onOpenMenu === undefined ? {} : { onOpenMenu })}
      />
      {sheet}
    </>
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
