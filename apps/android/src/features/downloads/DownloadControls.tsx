import { View } from "react-native";
import type { DownloadManager } from "../../data/downloadManager";
import type { DownloadEntry } from "../../data/downloadRecords";
import { shareDownloads } from "../../native/downloadActions";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { RowOverflowMenu } from "../../ui/RowOverflowMenu";
import { DownloadIconButton } from "./DownloadIconButton";
import { styles } from "./DownloadsSheet.styles";

const COMPLETED_ACTIONS: readonly ActionMenuItem[] = [
  { icon: "open-outline", id: "open", label: "Open" },
  { icon: "share-social-outline", id: "share", label: "Share" },
  { icon: "pencil-outline", id: "rename", label: "Rename" },
  { icon: "checkbox-outline", id: "select", label: "Select" },
  { icon: "close-circle-outline", id: "remove", label: "Remove from list" },
  { destructive: true, icon: "trash-outline", id: "delete", label: "Delete" },
];
const REMOVE_ACTIONS: readonly ActionMenuItem[] = [
  { icon: "checkbox-outline", id: "select", label: "Select" },
  { icon: "close-circle-outline", id: "remove", label: "Remove from list" },
];
/** Actions available for the current transfer state. */
export function DownloadControls({
  entry,
  manager,
  onOpen,
  onRename,
  onSelect,
}: {
  readonly entry: DownloadEntry;
  readonly manager: DownloadManager;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const restart = useEvent((): void => {
    const run =
      entry.state.status === "paused" ? manager.resume(entry.id) : manager.retry(entry.id);
    run.then(
      (settlement) => {
        if (settlement.status === "failed") {
          dialog.error("Download failed", settlement.error);
        }
      },
      (error: unknown) => {
        dialog.error("Download failed", error);
      },
    );
  });
  const pause = useEvent((): void => {
    manager.pause(entry.id);
  });
  const cancel = useEvent((): void => {
    manager.cancel(entry.id);
  });
  const deleteFile = useEvent(() => {
    try {
      manager.deleteFile(entry.id);
    } catch (error) {
      dialog.error("Could not delete file", error);
    }
  });
  const share = useEvent(() => {
    if (entry.state.status === "completed") {
      shareDownloads([entry.state.uri], entry.state.mimeType).catch((error: unknown) => {
        dialog.error("Could not share file", error);
      });
    }
  });
  const selectAction = useEvent((id: string): void => {
    if (id === "open") {
      onOpen();
    } else if (id === "share") {
      share();
    } else if (id === "rename") {
      onRename();
    } else if (id === "select") {
      onSelect();
    } else if (id === "remove") {
      try {
        manager.remove(entry.id);
      } catch (error) {
        dialog.error("Could not remove download", error);
      }
    } else if (id === "delete") {
      deleteFile();
    }
  });
  const { status } = entry.state;
  if (status === "running" || status === "paused") {
    return (
      <View style={styles.trailing}>
        {status === "running" ? (
          <DownloadIconButton icon="pause" label={`Pause ${entry.name}`} onPress={pause} />
        ) : (
          <DownloadIconButton icon="play" label={`Resume ${entry.name}`} onPress={restart} />
        )}
        <DownloadIconButton icon="close" label={`Cancel ${entry.name}`} onPress={cancel} />
      </View>
    );
  }
  const restartable =
    (status === "failed" || status === "cancelled") && manager.canRestart(entry.id);
  return (
    <View style={styles.trailing}>
      {restartable ? (
        <DownloadIconButton icon="refresh" label={`Retry ${entry.name}`} onPress={restart} />
      ) : null}
      <RowOverflowMenu
        accessibilityLabel={`Download actions, ${entry.name}`}
        actions={status === "completed" ? COMPLETED_ACTIONS : REMOVE_ACTIONS}
        onSelect={selectAction}
        rowKey={entry.id}
        tone="dim"
      />
    </View>
  );
}
