import Ionicons from "@expo/vector-icons/Ionicons";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { useDownloadManager } from "../../data/downloadManagerContext";
import type { DownloadEntry, DownloadId } from "../../data/downloadRecords";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { AppList } from "../../ui/AppList";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { SheetSearchField } from "../../ui/SheetSearchField";
import { useSheetBackHandler } from "../../ui/sheetNavigation";
import { AppText as Text } from "../../ui/Typography";
import { DownloadRow } from "./DownloadRow";
import { DownloadRenameDialog } from "./DownloadRenameDialog";
import { DownloadSelectionToolbar } from "./DownloadSelectionToolbar";
import { downloadListRows } from "./downloadListRows";
import { styles } from "./DownloadsSheet.styles";

const EMPTY_ICON_SIZE = 56;

/** Browses this device's downloads in a fresh session each time the sheet opens. */
export function DownloadsSheet({
  onClose,
  openedAt,
}: {
  readonly onClose: () => void;
  readonly openedAt: number | null;
}): React.JSX.Element {
  const manager = useDownloadManager();
  const count = useSelector(() => (openedAt === null ? 0 : manager.entries$.get(true).length));
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  return (
    <AppSheet
      contentProps={
        count > 0
          ? {
              dismissLabel: "Close downloads",
              enableDynamicSizing: false,
              index: 0,
              snapPoints: ["90%"],
            }
          : { dismissLabel: "Close downloads", enableDynamicSizing: true, index: 0 }
      }
      isOpen={openedAt !== null}
      onOpenChange={changeOpen}
    >
      {openedAt !== null && <DownloadsList count={count} key={openedAt} openedAt={openedAt} />}
    </AppSheet>
  );
}

function DownloadsList({
  count,
  openedAt,
}: {
  readonly count: number;
  readonly openedAt: number;
}): React.JSX.Element {
  const manager = useDownloadManager();
  const query$ = useConstant(() => observable(""));
  const query = useSelector(() => query$.get().trim().toLowerCase());
  const selection$ = useConstant(() => observable<readonly DownloadId[]>([]));
  const selected = new Set(useSelector(() => selection$.get()));
  const selectedEntries = useSelector(() =>
    selected.size === 0 ? [] : manager.entries$.get().filter((entry) => selected.has(entry.id)),
  );
  const selecting = selectedEntries.length > 0;
  const [renaming, setRenaming] = useState<DownloadEntry | null>(null);
  const rename = useEvent((entry: DownloadEntry) => {
    setRenaming(entry);
  });
  const closeRename = useEvent(() => {
    setRenaming(null);
  });
  const toggle = useEvent((entry: DownloadEntry) => {
    Keyboard.dismiss();
    const ids = selection$.peek();
    selection$.set(
      ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id],
    );
  });
  const clear = useEvent(() => {
    selection$.set([]);
  });
  useSheetBackHandler(selecting, clear);
  const rows = useSelector(() => downloadListRows(manager.entries$, query, openedAt));
  return (
    <>
      {selecting ? (
        <DownloadSelectionToolbar entries={selectedEntries} manager={manager} onClose={clear} />
      ) : (
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            Downloads
          </Text>
        </View>
      )}
      {count > 0 && !selecting && (
        <SheetSearchField
          clearLabel="Clear download search"
          label="Search downloads"
          query$={query$}
        />
      )}
      {rows.length === 0 ? (
        <EmptyDownloads first={count === 0} />
      ) : (
        <AppList
          contentContainerStyle={styles.list}
          data={rows}
          extraData={selected}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => (item.kind === "file" ? `file:${item.key}` : item.key)}
          renderItem={({ index, item }) => {
            if (item.kind === "day") {
              return (
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {item.title}
                </Text>
              );
            }
            const first = rows[index - 1]?.kind === "day";
            const last = rows[index + 1]?.kind !== "file";
            return (
              <DownloadRow
                entry$={item.entry$}
                manager={manager}
                onRename={rename}
                onToggle={toggle}
                position={first ? (last ? "only" : "first") : last ? "last" : "middle"}
                selected={selecting ? selected.has(item.key) : undefined}
              />
            );
          }}
          scrollComponent={AppSheetScrollView}
          virtualized
        />
      )}
      {renaming !== null && (
        <DownloadRenameDialog entry={renaming} manager={manager} onClose={closeRename} />
      )}
    </>
  );
}

function EmptyDownloads({ first }: { readonly first: boolean }) {
  return (
    <View style={styles.empty}>
      <Ionicons
        color={colors.textDim}
        name={first ? "arrow-down-circle-outline" : "search-outline"}
        size={EMPTY_ICON_SIZE}
        style={styles.emptyIcon}
      />
      <Text style={styles.notice}>{first ? "No downloads yet" : "No matching downloads"}</Text>
    </View>
  );
}
