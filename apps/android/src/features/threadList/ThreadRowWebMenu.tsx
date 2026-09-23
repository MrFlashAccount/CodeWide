import { Platform } from "react-native";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { AppText as Text } from "../../ui/Typography";
import { copySessionId } from "../turnActions/turnActions";
import { useAppNotice } from "../../ui/useAppNotice";
import { styles } from "./ThreadRow.styles";
import type { ThreadRowActions } from "./threadRowActions";
import type { ThreadRowProps } from "./threadRowContract";

export function ThreadRowWebMenu({
  actions,
  props,
}: {
  actions: ThreadRowActions;
  props: ThreadRowProps;
}) {
  const showNotice = useAppNotice().show;
  const { onMarkRead, onTogglePin, thread } = props;
  const {
    archiveAction,
    archiveLabel,
    dialog,
    runThreadAction,
    setWebContextVisible,
    webContextVisible,
  } = actions;
  return (
    <>
      {Platform.OS === "web" && webContextVisible && (
        <AppSheet
          contentProps={{ enableDynamicSizing: true, index: 0 }}
          isOpen={webContextVisible}
          onOpenChange={setWebContextVisible}
        >
          <Text style={styles.sheetTitle}>Thread</Text>
          <MenuAction
            icon="copy-outline"
            onPress={() => {
              setWebContextVisible(false);
              void copySessionId(thread.id, showNotice).catch((error: unknown) => {
                dialog.alert(
                  "Copy failed",
                  error instanceof Error ? error.message : "Could not copy session ID",
                );
              });
            }}
            subtitle=""
            title="Copy session ID"
          />
          <MenuAction
            icon="push-pin"
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
            }}
            subtitle=""
            title={thread.pinned ? "Unpin" : "Pin"}
          />
          <MenuAction
            icon="checkmark-done-outline"
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onMarkRead, "Mark as read");
            }}
            subtitle=""
            title="Mark as read"
          />
          <MenuAction
            danger={thread.archived !== true}
            icon={thread.archived === true ? "archive" : "archive-outline"}
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(archiveAction, archiveLabel);
            }}
            subtitle=""
            title={archiveLabel}
          />
        </AppSheet>
      )}
    </>
  );
}
