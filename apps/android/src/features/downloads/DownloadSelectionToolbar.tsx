import { View } from "react-native";

import type { DownloadManager } from "../../data/downloadManager";
import type { DownloadEntry } from "../../data/downloadRecords";
import { shareDownloads } from "../../native/downloadActions";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText } from "../../ui/Typography";
import { DownloadIconButton } from "./DownloadIconButton";
import { styles } from "./DownloadsSheet.styles";

/** Actions target the checked entries, including when a filter is active. */
export function DownloadSelectionToolbar({
  entries,
  manager,
  onClose,
}: {
  readonly entries: readonly DownloadEntry[];
  readonly manager: DownloadManager;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const shareable = entries.every((entry) => entry.state.status === "completed");
  const share = useEvent(() => {
    const files = entries.flatMap((entry) =>
      entry.state.status === "completed" ? [entry.state] : [],
    );
    const mimeType = files.every((file) => file.mimeType === files[0]?.mimeType)
      ? (files[0]?.mimeType ?? null)
      : null;
    shareDownloads(
      files.map((file) => file.uri),
      mimeType,
    ).catch((error: unknown) => {
      dialog.error("Could not share downloads", error);
    });
  });
  const remove = useEvent(() => {
    const targets = entries;
    dialog.alert(
      "Delete selected downloads?",
      "Saved files will be deleted from this device. Unfinished downloads will be removed.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            const failed = deleteSelected(manager, targets);
            if (failed.length === 0) {
              onClose();
            } else {
              dialog.alert("Could not delete downloads", failed.join("\n"));
            }
          },
          style: "destructive",
          text: "Delete",
        },
      ],
    );
  });
  return (
    <View style={styles.selectionBar}>
      <DownloadIconButton icon="close" label="Cancel selection" onPress={onClose} />
      <AppText accessibilityRole="header" style={styles.selectionTitle}>
        {entries.length} selected
      </AppText>
      {shareable && (
        <DownloadIconButton
          icon="share-social-outline"
          label="Share selected downloads"
          onPress={share}
        />
      )}
      <DownloadIconButton icon="trash-outline" label="Delete selected downloads" onPress={remove} />
    </View>
  );
}

function deleteSelected(manager: DownloadManager, targets: readonly DownloadEntry[]): string[] {
  const failed: string[] = [];
  for (const entry of targets) {
    try {
      // A transfer may have finished while the confirmation was open.
      const current = manager.entries$.peek().find((item) => item.id === entry.id);
      if (current?.state.status === "completed") {
        manager.deleteFile(entry.id);
      } else {
        manager.remove(entry.id);
      }
    } catch (error) {
      failed.push(entry.name + (error instanceof Error ? ` — ${error.message}` : ""));
    }
  }
  return failed;
}
