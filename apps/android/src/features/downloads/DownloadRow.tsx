import Ionicons from "@expo/vector-icons/Ionicons";
import type { Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { createElement } from "react";
import { View } from "react-native";
import type { DownloadManager } from "../../data/downloadManager";
import type { DownloadEntry } from "../../data/downloadRecords";
import { openDownloadedFile } from "../../native/file-transfer";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { ProgressRing } from "../../ui/ProgressRing";
import { DownloadControls } from "./DownloadControls";
import { downloadDescription, downloadIcon, downloadProgress } from "./downloadPresentation";
import { styles } from "./DownloadsSheet.styles";

const LEADING_RING_STROKE = 2;
/** One saved file or active transfer, with selection taking precedence over opening. */
export function DownloadRow({
  entry$,
  manager,
  onRename,
  onToggle,
  position,
  selected,
}: {
  readonly entry$: Observable<DownloadEntry>;
  readonly manager: DownloadManager;
  readonly onRename: (entry: DownloadEntry) => void;
  readonly onToggle: (entry: DownloadEntry) => void;
  readonly position: "only" | "first" | "middle" | "last";
  readonly selected: boolean | undefined;
}): React.JSX.Element {
  const entry = useSelector(() => entry$.get());
  const dialog = useAppDialog();
  const open = useEvent((): void => {
    if (entry.state.status !== "completed") {
      return;
    }
    openDownloadedFile(entry.state.uri, entry.state.mimeType ?? undefined).catch(
      (error: unknown) => {
        dialog.alert(
          "Could not open file",
          error instanceof Error ? error.message : "No installed app can open this file",
        );
      },
    );
  });
  const toggle = useEvent(() => {
    onToggle(entry);
  });
  const rename = useEvent(() => {
    onRename(entry);
  });
  const description = downloadDescription(entry);
  const completed = entry.state.status === "completed";
  return (
    <AppListRow
      accessibilityLabel={`${entry.name}, ${description}`}
      description={description}
      fixedHeight={listRowHeight.double}
      leading={createElement(DownloadLeading, { entry })}
      onLongPress={toggle}
      position={position}
      testID={`download:${entry.id}`}
      title={entry.name}
      {...(selected === undefined
        ? {
            trailing: createElement(DownloadControls, {
              entry,
              manager,
              onOpen: open,
              onRename: rename,
              onSelect: toggle,
            }),
            ...(completed ? { onPress: open } : {}),
          }
        : { onPress: toggle, selected, selectionRole: "checkbox" })}
    />
  );
}

/** Unfinished downloads draw their progress around the file icon. */
function DownloadLeading({ entry }: { readonly entry: DownloadEntry }): React.JSX.Element {
  const unfinished = entry.state.status === "running" || entry.state.status === "paused";
  return (
    <View style={styles.leading}>
      {unfinished ? (
        <ProgressRing
          color={entry.state.status === "paused" ? colors.textMuted : colors.accent}
          progress={downloadProgress(entry)}
          size={controlSize.compact}
          strokeWidth={LEADING_RING_STROKE}
          testID={`download-progress:${entry.id}`}
        />
      ) : null}
      <Ionicons
        color={entry.state.status === "failed" ? colors.red : colors.textMuted}
        name={downloadIcon(entry.name)}
        size={iconSize.action}
        style={styles.leadingIcon}
      />
    </View>
  );
}
