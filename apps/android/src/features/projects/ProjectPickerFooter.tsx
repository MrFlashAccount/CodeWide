import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { useEvent } from "../../react/useEvent";
import { Ionicons } from "@expo/vector-icons";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { AppText as Text } from "../../ui/Typography";
import type { ScopedProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { canAddDirectory } from "./projectDirectorySelection";
import { styles } from "./ProjectPickerSheet.styles";

function DirectoryFooter({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const { browseOnly = false, busy } = props;
  const {
    addCurrentDirectory,
    adding,
    directory,
    directoryError,
    directoryPath,
    directoryServer,
    readError,
  } = state;
  const label = browseOnly ? "Add this folder" : "Use this folder";
  return (
    <View style={styles.footer}>
      {directoryError !== null ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {directoryError}
        </Text>
      ) : null}
      <Button
        isDisabled={
          (browseOnly && props.onAddProject === undefined) ||
          !canAddDirectory({
            adding,
            busy,
            directoryPath,
            directoryServer,
            directoryStatus: directory.status,
            readError,
          })
        }
        onPress={addCurrentDirectory}
        variant="primary"
      >
        <Text shimmering={adding} style={styles.primaryActionLabel}>
          {label}
        </Text>
      </Button>
    </View>
  );
}
function ProjectFolderEntry({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element | null {
  const canBrowse = props.onReadDirectory !== undefined;
  const browseSelected = useEvent(() => {
    state.openDirectoryPicker(state.serverFilter);
  });
  if (!canBrowse) {
    return null;
  }
  const entry = (
    <Button
      accessibilityLabel="Choose another folder"
      isDisabled={props.busy || props.servers.length === 0}
      onPress={browseSelected}
      size="sm"
      style={styles.folderEntry}
      variant="secondary"
    >
      <Ionicons color={colors.textMuted} name="folder-open-outline" size={iconSize.inline} />
      <Text style={styles.folderEntryLabel}>Choose another folder</Text>
    </Button>
  );
  return entry;
}

/** Keeps the directory action stable while local or remote selection is pending. */
export function ProjectPickerFooter({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element | null {
  if (state.mode === "directory") {
    return <DirectoryFooter props={props} state={state} />;
  }
  if (state.mode === "servers") {
    return null;
  }
  return (
    <View style={styles.footerStatus}>
      <ProjectFolderEntry props={props} state={state} />
      {props.busy ? (
        <Text shimmering style={styles.stateText}>
          Choose project
        </Text>
      ) : null}
      {state.projectActionError !== null ? (
        <Text style={styles.errorText}>{state.projectActionError}</Text>
      ) : null}
      {props.error !== null ? <Text style={styles.errorText}>{props.error}</Text> : null}
    </View>
  );
}
