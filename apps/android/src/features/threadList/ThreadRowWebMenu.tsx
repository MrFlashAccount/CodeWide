import { Platform } from "react-native";
import { AppSheet } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { AppText as Text } from "../../ui/Typography";
import { copySessionId } from "../turnActions/turnActions";
import { styles } from "./ThreadRow.styles";
import type { ThreadRowActions } from "./threadRowActions";
import type { ThreadRowProps } from "./threadRowContract";
export function ThreadRowWebMenu({
  props,
  actions,
}: {
  props: ThreadRowProps;
  actions: ThreadRowActions;
}) {
  const { thread, onTogglePin, onMarkRead } = props;
  const {
    dialog,
    webContextVisible,
    setWebContextVisible,
    archiveAction,
    archiveLabel,
    runThreadAction,
  } = actions;
  return (
    <>
      {Platform.OS === "web" && webContextVisible && (
        <AppSheet
          isOpen={webContextVisible}
          onOpenChange={setWebContextVisible}
          contentProps={{ index: 0, enableDynamicSizing: true }}
        >
          <Text style={styles.sheetTitle}>Thread</Text>
          <MenuAction
            icon="copy-outline"
            title="Copy session ID"
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              void copySessionId(thread.id).catch((cause) =>
                dialog.alert(
                  "Copy failed",
                  cause instanceof Error ? cause.message : "Could not copy session ID",
                ),
              );
            }}
          />
          <MenuAction
            icon="push-pin"
            title={thread.pinned ? "Unpin" : "Pin"}
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
            }}
          />
          <MenuAction
            icon="checkmark-done-outline"
            title="Mark as read"
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onMarkRead, "Mark as read");
            }}
          />
          <MenuAction
            danger={!thread.archived}
            icon={thread.archived ? "archive" : "archive-outline"}
            title={archiveLabel}
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(archiveAction, archiveLabel);
            }}
          />
        </AppSheet>
      )}
    </>
  );
}
