import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { View } from "react-native";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { joinDirectoryPath } from "../../data/remote-projects";
import { colors, iconSize } from "../../theme";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import type { ScopedProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { EmptyState, PickerRow } from "./ProjectPickerRowViews";
import { styles } from "./ProjectPickerSheet.styles";

function unavailableDirectoryMessage(
  server: ScopedProjectPickerProps["servers"][number] | null,
): string {
  return server === null
    ? "Choose a server above to browse its folders"
    : `${server.name} is offline. Choose another server.`;
}

function DirectoryReadError({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const { onReadHomeDirectory } = props;
  const { navigate, readError, requestedDirectory } = state;
  return (
    <View style={styles.centerState}>
      <Ionicons color={colors.textDim} name="folder-open-outline" size={iconSize.illustration} />
      <Text style={styles.stateText}>Could not open this folder</Text>
      <Text accessibilityRole="alert" style={styles.errorText}>
        {readError}
      </Text>
      {onReadHomeDirectory !== undefined && requestedDirectory !== null ? (
        <Button
          onPress={() => {
            navigate(null);
          }}
          variant="secondary"
        >
          Go to server root
        </Button>
      ) : null}
    </View>
  );
}

/** Directory states require a concrete available server and retain its qualified resource errors. */
export function ProjectDirectoryContent({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const {
    adding,
    directory,
    directoryLoading,
    directoryPath,
    directoryServer,
    navigate,
    normalizedQuery,
    readError,
    visibleDirectories,
  } = state;
  return directoryServer === null || !directoryServer.available ? (
    <EmptyState icon="server-outline" text={unavailableDirectoryMessage(directoryServer)} />
  ) : readError !== null ? (
    <DirectoryReadError props={props} state={state} />
  ) : directoryLoading || directory.status !== "ready" ? (
    <View style={styles.centerState}>
      <Text shimmering style={styles.stateText}>
        {directoryPath === "" ? "Home" : directoryPath}
      </Text>
    </View>
  ) : (
    <LegendList
      contentContainerStyle={styles.listContent}
      data={visibleDirectories}
      drawDistance={360}
      getFixedItemSize={() => listRowHeight.single}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(entry) => entry.fileName}
      ListEmptyComponent={
        <EmptyState
          icon="folder-open-outline"
          text={normalizedQuery === "" ? "This folder has no subfolders" : "No matching folders"}
        />
      }
      recycleItems
      renderItem={({ index, item }) => (
        <PickerRow
          chevron
          disabled={adding}
          icon="folder"
          onPress={() => {
            navigate(joinDirectoryPath(directoryPath, item.fileName));
          }}
          position={listRowPosition(index, visibleDirectories.length)}
          selected={false}
          title={item.fileName}
        />
      )}
      renderScrollComponent={AppSheetScrollView}
      style={styles.projectScroll}
    />
  );
}
