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
    pinned,
    onOpenMenu,
    onRenameRequest,
    onArchive,
    onUnarchive,
    onCompact,
    onFork,
    onTogglePin,
  } = props;
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const { actions, run, handleAction } = useThreadHeaderActions(props);
  if (Platform.OS === "web") {
    return (
      <>
        <Pressable
          accessibilityLabel="Thread menu"
          onPress={() => setWebMenuVisible(true)}
          style={styles.headerIcon}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />
        </Pressable>
        {webMenuVisible && (
          <AppSheet
            isOpen
            onOpenChange={setWebMenuVisible}
            contentProps={{ index: 0, enableDynamicSizing: true }}
          >
            <Text style={styles.sheetTitle}>Thread</Text>
            <MenuAction
              icon="copy-outline"
              title="Copy session ID"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("copy-session-id");
              }}
            />
            <MenuAction
              icon="pencil-outline"
              title="Rename"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                onRenameRequest();
              }}
            />
            <MenuAction
              icon="push-pin"
              title={pinned ? "Unpin thread" : "Pin thread"}
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(onTogglePin, pinned ? "Unpin" : "Pin");
              }}
            />
            <MenuAction
              icon="git-branch-outline"
              title="Fork thread"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                if (onFork !== undefined)
                  run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
              }}
            />
            <MenuAction
              icon="contract-outline"
              title="Compact context"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(onCompact, "Compact");
              }}
            />
            <MenuAction
              icon={archived ? "archive" : "archive-outline"}
              title={archived ? "Unarchive thread" : "Archive thread"}
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
              }}
            />
            <MenuAction
              danger
              icon="trash-outline"
              title="Delete thread"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("delete");
              }}
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
              if (open) onOpenMenu();
            },
          })}
      onSelect={handleAction}
      style={styles.headerMenuAnchor}
    >
      <Pressable style={styles.headerIcon} accessibilityLabel="Thread menu">
        <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />
      </Pressable>
    </ActionMenu>
  );
}
