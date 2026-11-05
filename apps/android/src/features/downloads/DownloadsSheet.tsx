import Ionicons from "@expo/vector-icons/Ionicons";
import { useSelector } from "@legendapp/state/react";
import { createElement } from "react";
import { Pressable, View } from "react-native";

import { useDownloadManager } from "../../data/downloadManagerContext";
import type { DownloadManager } from "../../data/downloadManager";
import type { DownloadEntry } from "../../data/downloadRecords";
import { openDownloadedFile } from "../../native/file-transfer";
import { useEvent } from "../../react/useEvent";
import { colors, controlHitSlop, controlSize, iconSize } from "../../theme";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { ProgressRing } from "../../ui/ProgressRing";
import { AppText as Text } from "../../ui/Typography";
import {
  downloadDescription,
  downloadIcon,
  downloadProgress,
  downloadSections,
  type DownloadSection,
} from "./downloadPresentation";
import { styles } from "./DownloadsSheet.styles";

const COMPLETED_ACTIONS: readonly ActionMenuItem[] = [
  { icon: "open-outline", id: "open", label: "Open" },
  { icon: "close-circle-outline", id: "remove", label: "Remove from list" },
  { destructive: true, icon: "trash-outline", id: "delete", label: "Delete" },
];
const REMOVE_ACTIONS: readonly ActionMenuItem[] = [
  { icon: "close-circle-outline", id: "remove", label: "Remove from list" },
];
const LEADING_RING_STROKE = 2;

/** Lists this device's downloads, newest first, with Chrome-style per-file controls.
 * `openedAt` is when the user opened the sheet, or `null` while it is closed; day
 * sections are relative to it. */
export function DownloadsSheet({
  onClose,
  openedAt,
}: {
  readonly onClose: () => void;
  readonly openedAt: number | null;
}): React.JSX.Element {
  const manager = useDownloadManager();
  const entries = useSelector(() => manager.entries$.get());
  const changeOpen = useEvent((open: boolean): void => {
    if (!open) {
      onClose();
    }
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close downloads", enableDynamicSizing: true, index: 0 }}
      isOpen={openedAt !== null}
      onOpenChange={changeOpen}
    >
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          Downloads
        </Text>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.notice}>No downloads yet</Text>
      ) : (
        <AppSheetScrollView contentContainerStyle={styles.list}>
          {downloadSections(entries, openedAt ?? 0).map((section) => (
            <DownloadSectionView key={section.title} manager={manager} section={section} />
          ))}
        </AppSheetScrollView>
      )}
    </AppSheet>
  );
}

function DownloadSectionView({
  manager,
  section,
}: {
  readonly manager: DownloadManager;
  readonly section: DownloadSection;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {section.title}
      </Text>
      {section.entries.map((entry, index) => (
        <DownloadRow
          entry={entry}
          key={entry.id}
          manager={manager}
          position={listRowPosition(index, section.entries.length)}
        />
      ))}
    </View>
  );
}

function DownloadRow({
  entry,
  manager,
  position,
}: {
  readonly entry: DownloadEntry;
  readonly manager: DownloadManager;
  readonly position: "only" | "first" | "middle" | "last";
}): React.JSX.Element {
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
  const description = downloadDescription(entry);
  const completed = entry.state.status === "completed";
  return (
    <AppListRow
      accessibilityLabel={`${entry.name}, ${description}`}
      description={description}
      fixedHeight={listRowHeight.double}
      leading={createElement(DownloadLeading, { entry })}
      position={position}
      testID={`download:${entry.id}`}
      title={entry.name}
      trailing={createElement(DownloadControls, { entry, manager, onOpen: open })}
      {...(completed ? { onPress: open } : {})}
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

function DownloadControls({
  entry,
  manager,
  onOpen,
}: {
  readonly entry: DownloadEntry;
  readonly manager: DownloadManager;
  readonly onOpen: () => void;
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
  const selectAction = useEvent((id: string): void => {
    if (id === "open") {
      onOpen();
    } else if (id === "remove") {
      manager.remove(entry.id);
    } else if (id === "delete") {
      try {
        manager.deleteFile(entry.id);
      } catch (error) {
        dialog.error("Could not delete file", error);
      }
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
      <OverflowMenu
        accessibilityLabel={`Download actions, ${entry.name}`}
        actions={status === "completed" ? COMPLETED_ACTIONS : REMOVE_ACTIONS}
        onSelect={selectAction}
        tone="dim"
      />
    </View>
  );
}

function DownloadIconButton({
  icon,
  label,
  onPress,
}: {
  readonly icon: "close" | "pause" | "play" | "refresh";
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
    </Pressable>
  );
}
