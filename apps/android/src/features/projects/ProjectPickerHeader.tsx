import { Ionicons } from "@expo/vector-icons";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { ScopedProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { ProjectFolderServerControl } from "./ProjectFolderServerControl";
import { ProjectServerFilters } from "./ProjectServerFilters";
import { styles } from "./ProjectPickerSheet.styles";
import { useEvent } from "../../react/useEvent";

function ManageProjectsButton({
  onManage,
  serverFilter,
}: {
  readonly onManage: (connectionId: string | null) => void;
  readonly serverFilter: string | null;
}): React.JSX.Element {
  const manageProjects = useEvent(() => {
    onManage(serverFilter);
  });
  return (
    <Button accessibilityLabel="Manage Projects" onPress={manageProjects} size="sm" variant="ghost">
      Manage Projects
    </Button>
  );
}

/** Project selection owns server filters; folder browsing owns hierarchical navigation. */
export function ProjectPickerHeader({
  onBack,
  props,
  state,
}: {
  onBack: () => void;
  props: ScopedProjectPickerProps;
  state: ProjectPickerSession;
}): React.JSX.Element {
  const { browseOnly = false, busy, onManageProjects, servers } = props;
  const {
    adding,
    directoryServer,
    filteredChoices,
    mode,
    parentPath,
    serverFilter,
    unpinnedProjects,
  } = state;
  const backLabel =
    mode === "directory"
      ? parentPath === null
        ? "Back to servers"
        : "Parent directory"
      : browseOnly
        ? "Back to Manage Projects"
        : "Back to projects";
  return (
    <>
      <View style={styles.header}>
        {mode !== "projects" ? (
          <Button
            accessibilityLabel={backLabel}
            isDisabled={busy || adding}
            isIconOnly
            onPress={onBack}
            size="sm"
            variant="ghost"
          >
            <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
          </Button>
        ) : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>
            {mode === "projects" ? "Choose project" : browseOnly ? "Add project" : "Choose folder"}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {mode === "projects"
              ? `${String(filteredChoices.filter((choice) => choice.project.pinned).length)} pinned · ${String(unpinnedProjects.length)} from history`
              : mode === "servers"
                ? "Choose a server"
                : `Folders on ${directoryServer?.name ?? "Server"}`}
          </Text>
        </View>
        {mode === "projects" && onManageProjects !== undefined ? (
          <ManageProjectsButton onManage={onManageProjects} serverFilter={serverFilter} />
        ) : null}
      </View>
      {mode === "projects" && servers.length > 1 ? (
        <ProjectServerFilters
          busy={busy || adding}
          onSelect={state.selectServer}
          selected={serverFilter}
          servers={servers}
        />
      ) : null}
      {mode === "directory" ? <ProjectFolderServerControl props={props} state={state} /> : null}
    </>
  );
}
