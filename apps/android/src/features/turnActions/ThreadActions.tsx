import { useThreadHeaderActions } from "./threadHeaderActions";
import type { ThreadHeaderProps } from "./threadHeaderContract";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Platform, Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadActions.styles";

export function ThreadHeaderMenu(props: ThreadHeaderProps) {
  const {
    archived,
    onArchive,
    onCompact,
    onFork,
    onOpenMenu,
    onRenameRequest,
    onTogglePin,
    onUnarchive,
    pinned,
  } = props;
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const { actions, handleAction, run } = useThreadHeaderActions(props);
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
            <MenuAction
              icon="copy-outline"
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("copy-session-id");
              }}
              subtitle=""
              title="Copy session ID"
            />
            <MenuAction
              icon="pencil-outline"
              onPress={() => {
                setWebMenuVisible(false);
                onRenameRequest();
              }}
              subtitle=""
              title="Rename"
            />
            <MenuAction
              icon="push-pin"
              onPress={() => {
                setWebMenuVisible(false);
                run(onTogglePin, pinned ? "Unpin" : "Pin");
              }}
              subtitle=""
              title={pinned ? "Unpin thread" : "Pin thread"}
            />
            <MenuAction
              icon="git-branch-outline"
              onPress={() => {
                setWebMenuVisible(false);
                if (onFork !== undefined) {
                  run(async () => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
                }
              }}
              subtitle=""
              title="Fork thread"
            />
            <MenuAction
              icon="contract-outline"
              onPress={() => {
                setWebMenuVisible(false);
                run(onCompact, "Compact");
              }}
              subtitle=""
              title="Compact context"
            />
            <MenuAction
              icon={archived ? "archive" : "archive-outline"}
              onPress={() => {
                setWebMenuVisible(false);
                run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
              }}
              subtitle=""
              title={archived ? "Unarchive thread" : "Archive thread"}
            />
            <MenuAction
              danger
              icon="trash-outline"
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("delete");
              }}
              subtitle=""
              title="Delete thread"
            />
          </AppSheet>
        )}
      </>
    );
  }
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
      onSelect={handleAction}
      style={styles.headerMenuAnchor}
    >
      <Pressable accessibilityLabel="Thread menu" style={styles.headerIcon}>
        <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.action} />
      </Pressable>
    </ActionMenu>
  );
}
