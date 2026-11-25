import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { joinDirectoryPath } from "../../data/remote-projects";
import { colors, iconSize } from "../../theme";
import { AppList } from "../../ui/AppList";
import { useAppListItemState } from "../../ui/appListItemContext";
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
    <AppList
      contentContainerStyle={styles.listContent}
      data={visibleDirectories}
      empty={
        <EmptyState
          icon="folder-open-outline"
          text={normalizedQuery === "" ? "This folder has no subfolders" : "No matching folders"}
        />
      }
      keyboardShouldPersistTaps="handled"
      keyExtractor={(entry) => entry.fileName}
      renderItem={({ item }) => (
        <ProjectDirectoryRow
          adding={adding}
          directoryPath={directoryPath}
          fileName={item.fileName}
          navigate={navigate}
        />
      )}
      scrollComponent={AppSheetScrollView}
      style={styles.projectScroll}
      virtualized
    />
  );
}

function ProjectDirectoryRow({
  adding,
  directoryPath,
  fileName,
  navigate,
}: {
  readonly adding: boolean;
  readonly directoryPath: string;
  readonly fileName: string;
  readonly navigate: (directory: string | null) => void;
}): React.JSX.Element {
  const { position } = useAppListItemState();
  return (
    <PickerRow
      chevron
      disabled={adding}
      icon="folder"
      onPress={() => {
        navigate(joinDirectoryPath(directoryPath, fileName));
      }}
      position={position}
      selected={false}
      title={fileName}
    />
  );
}
